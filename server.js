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
          `[Source: ${r.metadata.source}]\n${r.metadata.text.slice(0, 200)}`,
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

// JOBS Tracker
const jobs = new Map();

app.get("/ingest/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

// GITHUB INGEST - BACKGROUND PROCESSING
app.post("/ingest/github", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({
      error: "No repo URL provided",
      expected_format: "https://github.com/owner/repo or owner/repo",
    });
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  jobs.set(jobId, { status: "processing", progress: "Starting ingestion...", stored: 0 });

  // Acknowledge immediately
  res.status(202).json({
    message: "Ingestion started in the background",
    jobId,
  });

  // Run in background
  (async () => {
    try {
      console.log(`📨 [${jobId}] Starting async ingestion for: ${repoUrl}`);

      // FETCH REPO - Error messages
      let files;
      try {
        files = await fetchGitHubRepo(repoUrl);
      } catch (fetchErr) {
        console.error(`[${jobId}] Failed to fetch repository: ${fetchErr.message}`);
        jobs.set(jobId, {
          status: "failed",
          error: fetchErr.message,
          hint: "Ensure the repo exists, is public, and is formatted correctly.",
        });
        return;
      }

      if (!files || files.length === 0) {
        jobs.set(jobId, { status: "failed", error: "No files to ingest" });
        return;
      }

      jobs.set(jobId, {
        status: "processing",
        progress: `Generating embeddings...`,
        totalChunks: files.length,
        stored: 0
      });

      console.log(`[${jobId}] Fetched ${files.length} file chunks, starting embedding & storage...`);

      let validRecords = 0;
      let skippedEmpty = 0; let skippedUseless = 0; let skippedSmall = 0;
      let embeddingFailed = 0; let invalidEmbedding = 0; let upsertFailed = 0;

      const recordsToUpsert = [];

      // Filter out useless files early
      const validFiles = files.filter((f) => {
        if (!f?.text || f.text.trim().length === 0) { skippedEmpty++; return false; }
        if (f.file.includes("node_modules") || f.file.includes(".lock")) { skippedUseless++; return false; }
        if (f.text.trim().length < 20) { skippedSmall++; return false; }
        return true;
      });

      const EMBED_BATCH_SIZE = 25; // process 25 chunks per model call
      for (let i = 0; i < validFiles.length; i += EMBED_BATCH_SIZE) {
        await new Promise(r => setTimeout(r, 5)); // yield event loop

        const batchFiles = validFiles.slice(i, i + EMBED_BATCH_SIZE);
        const texts = batchFiles.map(f => f.text);

        try {
          const embeddingsArray = await getEmbedding(texts);
          
          for (let j = 0; j < batchFiles.length; j++) {
            const file = batchFiles[j];
            const embedding = embeddingsArray[j];

            if (!embedding || !Array.isArray(embedding) || embedding.length !== 384 ||
                embedding.some((v) => typeof v !== "number" || isNaN(v) || !isFinite(v))) {
              invalidEmbedding++;
              continue;
            }

            recordsToUpsert.push({
              id: `${file.file}-${Date.now()}-${Math.random()}`,
              values: embedding,
              metadata: {
                text: file.text,
                source: file.file,
                url: file.url,
                type: "code",
              },
            });
          }
        } catch (err) {
           console.error(`[${jobId}] Embedding batch failed:`, err.message);
           embeddingFailed += batchFiles.length;
        }
      }

      console.log(`[${jobId}] Ready to upsert: ${recordsToUpsert.length} records`);
      jobs.set(jobId, {
        status: "processing",
        progress: `Saving to database...`,
        totalChunks: files.length,
        stored: 0
      });

      const BATCH_SIZE = 50;
      for (let i = 0; i < recordsToUpsert.length; i += BATCH_SIZE) {
        // YIELD again during batching just in case
        await new Promise(r => setTimeout(r, 5));

        const batch = recordsToUpsert.slice(i, i + BATCH_SIZE);
        try {
          await index.upsert({
            records: batch,
            namespace: "devassist",
          });
          validRecords += batch.length;
          jobs.set(jobId, {
            status: "processing",
            progress: `Synchronizing records...`,
            totalChunks: files.length,
            stored: validRecords
          });
        } catch (err) {
          upsertFailed += batch.length;
          console.error(`\n[${jobId}] BATCH UPSERT FAILED (${batch.length} records):`, err.message);
        }
      }

      if (validRecords === 0) {
        jobs.set(jobId, { status: "failed", error: "Failed to store valid code chunks. Check Pinecone index.", stored: 0 });
        return;
      }

      console.log(`\n[${jobId}] Ingestion complete: ${validRecords} chunks stored`);
      jobs.set(jobId, {
        status: "completed",
        message: "Ingestion successful",
        stored: validRecords,
        stats: {
          totalChunks: files.length, processedRecords: recordsToUpsert.length, validRecords,
          skipped: { empty: skippedEmpty, useless: skippedUseless, small: skippedSmall, embeddingFailed, invalidEmbedding },
          upsertFailed,
        },
      });

    } catch (err) {
      console.error(`\n[${jobId}] CRITICAL INGESTION ERROR:`, err.message);
      jobs.set(jobId, {
        status: "failed",
        error: "Critical ingestion failure",
        message: err.message,
      });
    }
  })();
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
