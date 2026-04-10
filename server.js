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
app.use(cors());
app.use(express.json());

// cache models
let cachedModels = null;
let selectedModel = null;

/* -------------------- QUERY -------------------- */
app.post("/query", async (req, res) => {
  const { question } = req.body;

  if (!question) {
    return res.json({ answer: "Invalid question" });
  }

  try {
    // 1. embedding
    const queryEmbedding = await getEmbedding(question);

    // 2. retrieve
    const queryResponse = await index.query({
      vector: queryEmbedding,
      topK: 2,
      includeMetadata: true,
    });

    //  define results
    const results = queryResponse.matches || [];

    const context = results
      .map(
        (r) =>
          `[Source: ${r.metadata.source}]\n${r.metadata.text.slice(0, 200)}`,
      )
      .join("\n\n");

    // 3. prompt
    const prompt = `
Context:
${context}

Question:
${question}

Answer clearly:
`;

    let answer = "";

    /* -------------------- GROQ API -------------------- */
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

      // FAST PATH
      if (selectedModel) {
        try {
          const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: selectedModel,
              messages: [
                {
                  role: "system",
                  content: `You are a RAG-based Developer Assistant AI.

Goal:
Give fast, concise, developer-focused answers using ONLY provided context.

Response Rules:
- Max 60 words
- Start with 1-line direct answer
- Use compact phrasing (no long sentences)
- If needed, add 2–3 short bullet points
- Prefer clarity over completeness
- No repetition, no filler, no generic explanations
- If context is insufficient, say: "Not enough information in context"

Style:
- Technical, SDE-level
- Direct and confident
- Optimize for speed (low tokens)

Strictly follow this format:
Answer: <1-line>
Key Points: <optional bullets or inline phrases>`,
                },
                {
                  role: "user",
                  content: prompt,
                },
              ],
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                "Content-Type": "application/json",
              },
              timeout: 10000,
            },
          );

          answer = response.data.choices[0].message.content;
        } catch {
          selectedModel = null;
        }
      }

      // FIND MODEL
      if (!selectedModel) {
        for (let model of models) {
          try {
            const response = await axios.post(
              "https://api.groq.com/openai/v1/chat/completions",
              {
                model,
                messages: [
                  { role: "system", content: `
You are a senior software engineer.

Answer ONLY using the given context.

Rules:
- Do NOT use outside knowledge
- If context is insufficient, say: "Not enough information in context"
- Be concise (4-6 lines)
- Focus on explaining code logic, purpose, and flow
- If code is present, explain what it does step-by-step
- Mention important functions, variables, or patterns if relevant
- If code is present, format it using triple backticks with language
` },
                  { role: "user", content: prompt },
                ],
              },
              {
                headers: {
                  Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                  "Content-Type": "application/json",
                },
                timeout: 10000,
              },
            );

            selectedModel = model;
            answer = response.data.choices[0].message.content;
            break;
          } catch {
            continue;
          }
        }
      }

      if (!answer) throw new Error("No working model found");
    } else {
      /* -------------------- OLLAMA -------------------- */
      const response = await axios.post("http://localhost:11434/api/generate", {
        model: "tinyllama",
        prompt: prompt,
        stream: false,
      });

      answer = response.data.response;
    }

    const sources = results.map((r) => ({
      name: r.metadata.source,
      url: r.metadata.url,
    }));

    //  only one response
    res.json({ answer, sources });
  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

/* -------------------- GITHUB INGEST -------------------- */
app.post("/ingest/github", async (req, res) => {
  const { repoUrl } = req.body;

  if (!repoUrl) return res.json({ message: "No repo URL provided" });

  try {
    const files = (await fetchGitHubRepo(repoUrl)).slice(0, 20);

    for (let file of files) {
      const embedding = await getEmbedding(file.text);

      await index.upsert([
        {
          id: `${file.file}-${Date.now()}`,
          values: embedding,
          metadata: {
            text: file.text,
            source: file.file,
            url: file.url,
          },
        },
      ]);
    }

    res.json({ message: "GitHub repo ingested" });
  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: "GitHub ingestion failed" });
  }
});

app.listen(3000, () => console.log("Server running"));
