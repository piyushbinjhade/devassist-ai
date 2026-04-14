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

export const index = pc.index(process.env.PINECONE_INDEX);

const app = express();
app.use(cors({
  origin: "*"
}));
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

    const isLowConfidence = topScore < 0.75;

    const isBadAnswer =
      answer.includes("Not enough information") || answer.trim().length < 30;

    // detect no results
    const noResults = results.length === 0;

    // better control over web search (only when truly needed)
    if (noResults || isLowConfidence || isBadAnswer) {
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
    res.status(500).json({ error: "Something went wrong" });
  }
});

// GITHUB INGEST
app.post("/ingest/github", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) return res.json({ message: "No repo URL provided" });

  try {
    const files = (await fetchGitHubRepo(repoUrl)).slice(0, 20);

    if (!files.length) {
      return res.status(400).json({ error: "No files fetched" });
    }

    for (let file of files) {
      try {
        if (!file?.text || file.text.trim().length === 0) {
          continue;
        }

        // skip useless files
        if (
          file.file.includes("config") ||
          file.file.includes(".json") ||
          file.file.includes("lock") ||
          file.file.includes("package")
        ) {
          continue;
        }

        const safeText = file.text.slice(0, 1000); // 🔥 FIX

        // skip too small text
        if (safeText.length < 50) {
          continue;
        }

        const embedding = await getEmbedding(safeText);

        // VALIDATION  
        if (
          !embedding ||
          !Array.isArray(embedding) ||
          embedding.length !== 384 ||
          embedding.some(
            (v) => typeof v !== "number" || isNaN(v) || !isFinite(v),
          )
        ) {
          continue;
        }

        // BUILD RECORD FIRST 
        const record = {
          id: `${file.file}-${Date.now()}`,
          values: embedding,
          metadata: {
            text: safeText,
            source: file.file,
            url: file.url,
            type: "code",
          },
        };

        // FINAL SAFETY CHECK BEFORE UPSERT
        if (
          !record.values ||
          record.values.length !== 384 ||
          !record.values.every((v) => typeof v === "number" && isFinite(v))
        ) {
          continue;
        }

        // SAFE UPSERT (ERROR ELIMINATION)
        try {
          await index.upsert([record], {
            namespace: "devassist",
          });
        } catch (err) {
          continue;
        }
      } catch (err) {
        continue;
      }
    }

    res.json({ message: "Ingestion complete" });
  } catch (err) {
    res.status(500).json({ error: "Ingestion failed" });
  }
});

// (Render compatible)

app.get("/", (req, res) => {
  res.send("BACKEND WORKING");
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});