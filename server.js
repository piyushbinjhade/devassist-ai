import dotenv from "dotenv";
dotenv.config();

import express from "express";
import axios from "axios";
import cors from "cors";
import { Pinecone } from "@pinecone-database/pinecone";
import { getEmbedding, fetchGitHubRepo } from "./rag/ingest.js";

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

let cachedModels = null;

const cache = new Map();
const CACHE_TTL = 1000 * 60 * 5;
const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL_CACHE_TTL = 1000 * 60 * 15;
const GROQ_MODEL_PREFERENCES = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
];

function getGroqErrorMessage(error) {
  const providerMessage =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    "Unknown provider error";
  const status = error?.response?.status;
  return `Groq API${status ? ` (${status})` : ""}: ${providerMessage}`;
}

function createGroqError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function groqHeaders() {
  return {
    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  };
}

async function getGroqModels(forceRefresh = false) {
  if (!process.env.GROQ_API_KEY) {
    throw createGroqError(
      "GROQ_API_KEY is not configured on the server.",
      "GROQ_NOT_CONFIGURED",
      503,
    );
  }

  if (
    !forceRefresh &&
    cachedModels &&
    Date.now() - cachedModels.fetchedAt < GROQ_MODEL_CACHE_TTL
  ) {
    return cachedModels.ids;
  }

  try {
    const response = await axios.get(GROQ_MODELS_URL, {
      headers: groqHeaders(),
      timeout: 15000,
    });
    const ids = response.data?.data
      ?.map((model) => model.id)
      .filter((id) => typeof id === "string" && id.length > 0);

    if (!ids?.length) {
      throw createGroqError(
        "Groq returned no available models. Check the API account and model access.",
        "GROQ_NO_MODELS",
      );
    }

    cachedModels = { ids, fetchedAt: Date.now() };
    return ids;
  } catch (error) {
    if (error.code?.startsWith("GROQ_")) throw error;
    throw createGroqError(
      `Could not retrieve available Groq models. ${getGroqErrorMessage(error)}`,
      "GROQ_MODELS_FAILURE",
    );
  }
}

function selectGroqModels(modelIds) {
  const configuredModel = process.env.GROQ_MODEL?.trim();
  if (configuredModel) {
    if (!modelIds.includes(configuredModel)) {
      throw createGroqError(
        `GROQ_MODEL "${configuredModel}" is not available to this Groq API key. Check GROQ_MODEL or model access.`,
        "GROQ_MODEL_UNAVAILABLE",
        503,
      );
    }
    return [configuredModel];
  }

  const chatModels = modelIds.filter((id) =>
    /llama|mixtral|gemma|qwen|deepseek|gpt-oss|kimi|compound/i.test(id),
  );
  return chatModels.sort((left, right) => {
    const leftRank = GROQ_MODEL_PREFERENCES.indexOf(left);
    const rightRank = GROQ_MODEL_PREFERENCES.indexOf(right);
    return (
      (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) -
      (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank)
    );
  });
}

async function generateGroqAnswer(messages) {
  let candidates = selectGroqModels(await getGroqModels());
  if (candidates.length === 0) {
    throw createGroqError(
      "Groq did not report any supported chat models. Set GROQ_MODEL to an available chat model.",
      "GROQ_NO_CHAT_MODELS",
      503,
    );
  }

  const attemptedModels = new Set();
  let lastError;

  for (let refresh = 0; refresh < 2; refresh += 1) {
    for (const model of candidates) {
      attemptedModels.add(model);
      try {
        const response = await axios.post(
          GROQ_CHAT_URL,
          {
            model,
            messages,
            max_completion_tokens: 2048,
          },
          {
            headers: groqHeaders(),
            timeout: 60000,
          },
        );
        const answer = response.data?.choices?.[0]?.message?.content;
        if (typeof answer !== "string" || !answer.trim()) {
          throw new Error("Groq returned an empty answer.");
        }
        return answer;
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const providerMessage = getGroqErrorMessage(error);
        console.error(`Groq model ${model} failed: ${providerMessage}`);
        if (status === 401 || status === 403 || status === 429) {
          throw createGroqError(
            providerMessage,
            status === 429 ? "GROQ_RATE_LIMITED" : "GROQ_AUTH_FAILURE",
            status === 429 ? 429 : 502,
          );
        }
      }
    }

    if (refresh === 0 && !process.env.GROQ_MODEL) {
      const refreshedModels = selectGroqModels(await getGroqModels(true));
      candidates = refreshedModels.filter((model) => !attemptedModels.has(model));
      if (candidates.length > 0) continue;
    }
    break;
  }

  const detail = lastError
    ? getGroqErrorMessage(lastError)
    : "No available model could be selected.";
  throw createGroqError(
    `Groq could not complete the request with the available chat models. ${detail}`,
    "GROQ_FAILURE",
  );
}

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

app.post("/query", async (req, res) => {
  const startTime = Date.now();
  const { question, repo } = req.body;

  let namespace = "devassist";
  if (repo) {
    try {
      const cleaned = repo.replace(".git", "").replace(/\/$/, "").trim();
      if (cleaned.includes("github.com")) {
        const parts = cleaned.split("/");
        namespace = `${parts[3]}/${parts[4]}`;
      } else {
        const parts = cleaned.split("/");
        if (parts.length === 2) namespace = `${parts[0]}/${parts[1]}`;
      }
    } catch (e) { }
  }

  if (!question) {
    return res.json({ answer: "Invalid question" });
  }

  const cacheKey = `${repo || "default"}|${question.toLowerCase().trim()}`;

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      return res.json(cached.data);
    } else {
      cache.delete(cacheKey);
    }
  }

  try {
    const queryEmbeddingArr = await getEmbedding([question]);
    const queryEmbedding = queryEmbeddingArr[0];
    console.log("Query embedding length:", queryEmbedding.length);

    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: 15,
      includeMetadata: true,
      namespace: namespace,
    });

    const results = queryResponse.matches || [];
    const topScore = results[0]?.score || 0;
    const resultCount = results.length;

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
    let usedWeb = false;

    if (process.env.USE_API !== "true") {
      throw createGroqError(
        "AI answers are disabled. Set USE_API=true and configure GROQ_API_KEY on the server.",
        "GROQ_DISABLED",
        503,
      );
    }

    answer = await generateGroqAnswer([
      {
        role: "system",
        content: `
                          You are an expert developer assistant specialized in codebase analysis.
                          
                          Your responsibilities based on the user's question:
                          1. Explain how specific code works in the provided repository context.
                          2. Identify and check for potential errors or bugs in the provided code.
                          3. Clearly explain architectural or structural patterns if asked.
                          
                          Rules:
                          - Use the provided context as your source of truth.
                          - Provide accurate, highly detailed, and technical explanations.
                          - If the question asks to check for errors, carefully analyze the context code to point out potential issues or logical flaws.
                          - Use markdown formatting, including code blocks, bullet points, and bold text for readability.
                          - Do not hallucinate code that is not present in the context, but feel free to suggest fixes for errors.
                          `,
      },
      { role: "user", content: prompt },
    ]);

    let sources = results.map((r) => ({
      name: r.metadata.source,
      url: r.metadata.url,
    }));

    const isLowConfidence = topScore < 0.30;

    const isBadAnswer =
      answer.includes("Not enough information") ||
      answer.includes("no relevant context") ||
      answer.trim().length < 40;

    const noResults = results.length === 0;

    if (noResults || isLowConfidence || isBadAnswer) {
      usedWeb = true;
      const webResults = await tavilySearch(question);

      const webContext = webResults.map((r) => r.content).join("\n\n");

      const newPrompt = `
Use this web context AND the repository context to answer clearly and comprehensively based on the repository code where possible:

Web Context:
${webContext}

Repository Context:
${context || "No relevant repo context found"}

Question: ${question}

Provide a detailed explanation with paragraphs and lists where appropriate.
`;

      answer = await generateGroqAnswer([
        {
          role: "system",
          content:
            "Answer using repository evidence first. Clearly label external information and never present web context as proof of repository implementation.",
        },
        { role: "user", content: newPrompt },
      ]);

      sources = [
        ...sources,
        ...webResults.map((r) => ({
          name: r.title,
          url: r.url,
        })),
      ];
    }

    cache.set(cacheKey, {
      data: { answer, sources, usedWeb },
      timestamp: Date.now(),
    });

    const endTime = Date.now();

    const metrics = {
      queryTime: `${endTime - startTime}ms`,
      topScore: topScore.toFixed(3),
      resultCount,
      usedWeb,
    };

    console.log("📊 QUERY METRICS:", metrics);

    res.json({ answer, sources, usedWeb, metrics });
  } catch (err) {
    console.error("QUERY ERROR:", err?.message || err);
    res.status(err.statusCode || 500).json({
      error: err.message || "Something went wrong",
      ...(err.code && { code: err.code }),
    });
  }
});

const jobs = new Map();

app.get("/ingest/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }
  res.json(job);
});

app.post("/ingest/github", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) {
    return res.status(400).json({
      error: "No repo URL provided",
      expected_format: "https://github.com/owner/repo or owner/repo",
    });
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  jobs.set(jobId, {
    status: "processing",
    progress: "Starting ingestion...",
    stored: 0,
  });

  res.status(202).json({
    message: "Ingestion started in the background",
    jobId,
  });

  let namespace = "devassist";
  try {
    const cleaned = repoUrl.replace(".git", "").replace(/\/$/, "").trim();
    if (cleaned.includes("github.com")) {
      const parts = cleaned.split("/");
      namespace = `${parts[3]}/${parts[4]}`;
    } else {
      const parts = cleaned.split("/");
      if (parts.length === 2) namespace = `${parts[0]}/${parts[1]}`;
    }
  } catch (e) { }

  (async () => {
    try {
      console.log(`📨 [${jobId}] Starting async ingestion for: ${repoUrl}`);

      let files;
      try {
        files = await fetchGitHubRepo(repoUrl);
      } catch (fetchErr) {
        console.error(
          `[${jobId}] Failed to fetch repository: ${fetchErr.message}`,
        );
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
        stored: 0,
      });

      console.log(
        `[${jobId}] Fetched ${files.length} file chunks, starting embedding & storage...`,
      );

      let validRecords = 0;
      let skippedEmpty = 0;
      let skippedUseless = 0;
      let skippedSmall = 0;
      let embeddingFailed = 0;
      let invalidEmbedding = 0;
      let upsertFailed = 0;

      const recordsToUpsert = [];

      const validFiles = files.filter((f) => {
        if (!f?.text || f.text.trim().length === 0) {
          skippedEmpty++;
          return false;
        }
        if (f.file.includes("node_modules") || f.file.includes(".lock")) {
          skippedUseless++;
          return false;
        }
        if (f.text.trim().length < 20) {
          skippedSmall++;
          return false;
        }
        return true;
      });

      const EMBED_BATCH_SIZE = 25;
      for (let i = 0; i < validFiles.length; i += EMBED_BATCH_SIZE) {
        await new Promise((r) => setTimeout(r, 5));

        const batchFiles = validFiles.slice(i, i + EMBED_BATCH_SIZE);
        const texts = batchFiles.map((f) => f.text);

        try {
          const embeddingsArray = await getEmbedding(texts);

          for (let j = 0; j < batchFiles.length; j++) {
            const file = batchFiles[j];
            const embedding = embeddingsArray[j];

            if (
              !embedding ||
              !Array.isArray(embedding) ||
              embedding.length !== 384 ||
              embedding.some(
                (v) => typeof v !== "number" || isNaN(v) || !isFinite(v),
              )
            ) {
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

      console.log(
        `[${jobId}] Ready to upsert: ${recordsToUpsert.length} records`,
      );
      jobs.set(jobId, {
        status: "processing",
        progress: `Saving to database...`,
        totalChunks: files.length,
        stored: 0,
      });

      const BATCH_SIZE = 50;
      for (let i = 0; i < recordsToUpsert.length; i += BATCH_SIZE) {
        await new Promise((r) => setTimeout(r, 5));

        const batch = recordsToUpsert.slice(i, i + BATCH_SIZE);
        try {
          await index.upsert({
            records: batch,
            namespace: namespace,
          });
          validRecords += batch.length;
          jobs.set(jobId, {
            status: "processing",
            progress: `Synchronizing records...`,
            totalChunks: files.length,
            stored: validRecords,
          });
        } catch (err) {
          upsertFailed += batch.length;
          console.error(
            `\n[${jobId}] BATCH UPSERT FAILED (${batch.length} records):`,
            err.message,
          );
        }
      }

      if (validRecords === 0) {
        jobs.set(jobId, {
          status: "failed",
          error: "Failed to store valid code chunks. Check Pinecone index.",
          stored: 0,
        });
        return;
      }

      console.log(
        `\n[${jobId}] Ingestion complete: ${validRecords} chunks stored`,
      );
      jobs.set(jobId, {
        status: "completed",
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
      console.error(`\n[${jobId}] CRITICAL INGESTION ERROR:`, err.message);
      jobs.set(jobId, {
        status: "failed",
        error: "Critical ingestion failure",
        message: err.message,
      });
    }
  })();
});

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
