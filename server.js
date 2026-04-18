import dotenv from "dotenv";
dotenv.config();

import express from "express";
import axios from "axios";
import cors from "cors";
import { Pinecone } from "@pinecone-database/pinecone";
import { getEmbedding, fetchGitHubRepo } from "./rag/ingest.js";

// Pinecone init
const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pc.index(process.env.PINECONE_INDEX);

const app = express();
app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

// cache models
let cachedModels = null;
let selectedModel = null;

// CACHE
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

// Tavily helper
async function tavilySearch(query) {
  const res = await axios.post("https://api.tavily.com/search", {
    api_key: process.env.TAVILY_API_KEY,
    query,
    search_depth: "basic",
    max_results: 3,
  });

  return res.data.results.map((r) => ({
    content: r.content,
    title: r.title,
    url: r.url,
  }));
}

//  QUERY HANDLER
app.post("/query", async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.json({ answer: "Invalid question" });
  }

  // CACHE CHECK
  if (cache.has(question)) {
    const cached = cache.get(question);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    } else {
      cache.delete(question);
    }
  }

  try {
    const queryEmbedding = await getEmbedding(question);

    // faster retrieval
    const queryResponse = await index.query(
      {
        vector: queryEmbedding,
        topK: 2,
        includeMetadata: true,
      },
      {
        namespace: "devassist",
      },
    );

    const results = queryResponse.matches || [];
    const topScore = results[0]?.score || 0;

    const context = results
      .map(
        (r) =>
          `[Source: ${r.metadata.source}]\n${r.metadata.text.slice(0, 200)}`, // 🔥 reduced size
      )
      .join("\n\n");

    const prompt = `
Context:
${context || "No relevant context found"}

Question:
${question}

Answer clearly and precisely:
`;

    let answer = "";
    // track if web search used
    let usedWeb = false;

    if (process.env.USE_API === "true") {
      if (!cachedModels) {
        const modelRes = await axios.get(
          "https://api.groq.com/openai/v1/models",
          {
            headers: {
              Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            },
          },
        );

        cachedModels = modelRes.data.data.map((m) => m.id);
      }

      const models = cachedModels.filter(
        (m) => m.includes("llama") || m.includes("mixtral"),
      );

      for (let model of models) {
        try {
          const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model,
              messages: [
                {
                  role: "system",
                  content: `
                          You are a RAG-based Developer Assistant AI.

                          Rules:
                          - Answer ONLY using provided context
                          - If insufficient → say: "Not enough information"
                          - Keep answers concise (max 4 lines)
                          - Use bullet points if helpful
                          - Explain simply (junior dev level)
                          - Avoid repetition
                          `,
                },
                { role: "user", content: prompt },
              ],
              max_tokens: 200,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
              },
            },
          );

          answer = response.data.choices[0].message.content;
          selectedModel = model;
          break;
        } catch {
          continue;
        }
      }

      if (!answer) throw new Error("No working model found");
    }

    let sources = results.map((r) => ({
      name: r.metadata.source,
      url: r.metadata.url,
    }));

    if (!selectedModel && cachedModels?.length > 0) {
      selectedModel = cachedModels[0];
    }

    const isLowConfidence = topScore < 0.5;

    const isBadAnswer =
      answer.includes("Not enough information") || answer.trim().length < 30;

    // detect no results
    const noResults = results.length === 0;

    // better control over web search (only when truly needed)
    if (noResults || (isLowConfidence && isBadAnswer && topScore < 0.4)) {
      usedWeb = true;
      const webResults = await tavilySearch(question);

      const webContext = webResults.map((r) => r.content).join("\n\n");

      const newPrompt = `
Use this web context to answer clearly:

${webContext}

Question:
${question}
`;

      const response = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: selectedModel || cachedModels[0],
          messages: [{ role: "user", content: newPrompt }],
          max_tokens: 200,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json",
          },
        },
      );

      answer = response.data.choices[0].message.content;

      sources = [
        ...sources,
        ...webResults.map((r) => ({
          name: r.title,
          url: r.url,
        })),
      ];
    }

    cache.set(question, {
      // data: { answer, sources },
      data: { answer, sources, usedWeb },
      timestamp: Date.now(),
    });

    res.json({ answer, sources, usedWeb });
  } catch (err) {
    console.error("QUERY ERROR:", err?.message || err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// GITHUB INGEST - ERROR HANDLING
app.post("/ingest/github", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({
      error: "No repo URL provided",
      expected_format: "https://github.com/owner/repo or owner/repo",
    });
  }

  try {
    console.log(`📨 Starting ingestion for: ${repoUrl}`);

    // FETCH REPO - Error messages
    let files;
    try {
      files = await fetchGitHubRepo(repoUrl);
    } catch (fetchErr) {
      console.error(`❌ Failed to fetch repository: ${fetchErr.message}`);

      // Return helpful error messages based on the type of failure
      if (fetchErr.message.includes("Invalid GitHub URL")) {
        return res.status(400).json({
          error: "Invalid GitHub URL format",
          message: fetchErr.message,
          expected_format: "https://github.com/owner/repo or owner/repo",
        });
      } else if (fetchErr.message.includes("not found")) {
        return res.status(404).json({
          error: "Repository not found",
          message: fetchErr.message,
          hint: "Ensure the repo exists and is public",
        });
      } else if (
        fetchErr.message.includes("RATE LIMITED") ||
        fetchErr.message.includes("403")
      ) {
        return res.status(429).json({
          error: "GitHub API rate limited",
          message: fetchErr.message,
          hint: "Add GITHUB_TOKEN=ghp_... to your .env file for higher rate limits",
        });
      } else if (fetchErr.message.includes("No JavaScript")) {
        return res.status(400).json({
          error: "No supported files found",
          message: fetchErr.message,
          hint: "Repository must contain .js, .ts, .jsx, .tsx, or .md files",
        });
      } else {
        return res.status(500).json({
          error: "Failed to fetch repository",
          message: fetchErr.message,
          debug: fetchErr.stack,
        });
      }
    }

    if (!files || files.length === 0) {
      return res.status(400).json({
        error: "No files to ingest",
        message: "fetchGitHubRepo returned empty array",
      });
    }

    console.log(
      `Fetched ${files.length} file chunks, starting embedding & storage...`,
    );

    let validRecords = 0;
    let skippedEmpty = 0;
    let skippedUseless = 0;
    let skippedSmall = 0;
    let embeddingFailed = 0;
    let invalidEmbedding = 0;
    let upsertFailed = 0;

    // Collect all records first
    const recordsToUpsert = [];

    for (let file of files) {
      try {
        if (!file?.text || file.text.trim().length === 0) {
          skippedEmpty++;
          continue;
        }

        // skip useless files (node_modules, lock files)
        if (file.file.includes("node_modules") || file.file.includes(".lock")) {
          skippedUseless++;
          continue;
        }

        const safeText = file.text;
        // skip too small text
        if (!safeText || safeText.trim().length < 20) {
          skippedSmall++;
          continue;
        }

        // Get embedding with error handling
        let embedding;
        try {
          embedding = await getEmbedding(safeText);
        } catch (err) {
          embeddingFailed++;
          console.error(`Embedding failed for ${file.file}: ${err.message}`);
          continue;
        }

        // VALIDATION: Check embedding is 384-dimensional with valid numbers
        if (
          !embedding ||
          !Array.isArray(embedding) ||
          embedding.length !== 384 ||
          embedding.some(
            (v) => typeof v !== "number" || isNaN(v) || !isFinite(v),
          )
        ) {
          invalidEmbedding++;
          console.warn(
            `Invalid embedding for ${file.file} (length: ${embedding?.length})`,
          );
          continue;
        }

        // BUILD RECORD
        const record = {
          id: `${file.file}-${Date.now()}-${Math.random()}`,
          values: embedding,
          metadata: {
            text: safeText,
            source: file.file,
            url: file.url,
            type: "code",
          },
        };

        recordsToUpsert.push(record);
      } catch (err) {
        console.error(
          `Unexpected error processing ${file.file}:`,
          err.message,
        );
        continue;
      }
    }

    console.log(`Ready to upsert: ${recordsToUpsert.length} records`);

    // BATCH UPSERT - Process in chunks of 50
    const BATCH_SIZE = 50;
    for (let i = 0; i < recordsToUpsert.length; i += BATCH_SIZE) {
      const batch = recordsToUpsert.slice(i, i + BATCH_SIZE);
      try {
        console.log(
          `Upserting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(recordsToUpsert.length / BATCH_SIZE)} (${batch.length} records)...`,
        );

        // Debug: Log first record structure
        if (i === 0) {
          const firstRecord = batch[0];
          console.log(`First record in batch:`, {
            idType: typeof firstRecord.id,
            idLength: firstRecord.id?.length,
            valuesArrayType: Array.isArray(firstRecord.values),
            valuesLength: firstRecord.values?.length,
            first3Values: firstRecord.values?.slice(0, 3),
            metadataKeys: Object.keys(firstRecord.metadata || {}),
          });
        }

        const upsertResult = await index.upsert({
          records: batch,
          namespace: "devassist",
        });

        console.log(`Batch upsert succeeded:`, upsertResult);
        validRecords += batch.length;
        console.log(
          `Total stored so far: ${validRecords}/${recordsToUpsert.length}`,
        );
      } catch (err) {
        upsertFailed += batch.length;
        console.error(`\n BATCH UPSERT FAILED (${batch.length} records):`);
        console.error(`   Message: ${err.message}`);
        console.error(`   Code: ${err.code}`);
        console.error(`   Status: ${err.status}`);
        console.error(`   Full Error: ${err.toString()}`);
        if (err.response?.data) {
          console.error(
            `   Response Data: ${JSON.stringify(err.response.data)}`,
          );
        }
      }
    }

    // FINAL RESPONSE
    if (validRecords === 0) {
      return res.status(400).json({
        error: "No valid code chunks stored",
        message: `Failed to store any of the ${recordsToUpsert.length} processed records to Pinecone. Check your API key and index configuration.`,
        details: {
          totalChunks: files.length,
          processedRecords: recordsToUpsert.length,
          skippedEmpty,
          skippedUseless,
          skippedSmall,
          embeddingFailed,
          invalidEmbedding,
          upsertFailed,
        },
        hint: "Verify PINECONE_API_KEY and PINECONE_INDEX in .env",
      });
    }

    console.log(`\n Ingestion complete: ${validRecords} chunks stored`);

    res.status(200).json({
      message: "Ingestion successful",
      stored: validRecords,
      stats: {
        totalChunks: files.length,
        processedRecords: recordsToUpsert.length,
        validRecords,
        skipped: {
          empty: skippedEmpty,
          useless: skippedUseless,
          small: skippedSmall,
          embeddingFailed,
          invalidEmbedding,
        },
        upsertFailed,
      },
    });
  } catch (err) {
    console.error("\n CRITICAL INGESTION ERROR:", err.message);
    console.error(err.stack);
    res.status(500).json({
      error: "Ingestion failed",
      message: err.message,
      debug: process.env.NODE_ENV === "development" ? err.stack : undefined,
    });
  }
});

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "BACKEND WORKING",
    services: {
      pinecone: process.env.PINECONE_API_KEY ? "✓" : "✗",
      groq: process.env.GROQ_API_KEY ? "✓" : "✗",
      tavily: process.env.TAVILY_API_KEY ? "✓" : "✗",
      github_token: process.env.GITHUB_TOKEN
        ? "✓ (authenticated)"
        : "✗ (unauthenticated - 60 req/hr limit)",
    },
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n Server running on port ${PORT}`);
  console.log(`Environment check:`);
  console.log(
    `   PINECONE_API_KEY: ${process.env.PINECONE_API_KEY ? "✓" : "✗"}`,
  );
  console.log(`   PINECONE_INDEX: ${process.env.PINECONE_INDEX ? "✓" : "✗"}`);
  console.log(`   GROQ_API_KEY: ${process.env.GROQ_API_KEY ? "✓" : "✗"}`);
  console.log(`   TAVILY_API_KEY: ${process.env.TAVILY_API_KEY ? "✓" : "✗"}`);
  console.log(
    `   GITHUB_TOKEN: ${process.env.GITHUB_TOKEN ? "✓ (auth enabled)" : "missing (60 req/hr limit)"}`,
  );
});
