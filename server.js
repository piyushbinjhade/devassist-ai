import express from "express";
import dotenv from "dotenv";
import axios from "axios";
import { getEmbedding, fetchGitHubRepo } from "./rag/ingest.js";
import { getTopKMatches } from "./rag/query.js";
import fs from "fs";
import cors from "cors";

const DATA_PATH = "data/store.json";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// in-memory vector store
let dataStore = [];

// load existing data
if (fs.existsSync(DATA_PATH)) {
  dataStore = JSON.parse(fs.readFileSync(DATA_PATH));
  console.log("Loaded existing data:", dataStore.length);
}

// save function
function saveData() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(dataStore, null, 2));
}

// cache models
let cachedModels = null;

// cache selected working model
let selectedModel = null;

/* -------------------- ADD TEXT -------------------- */
app.post("/add", async (req, res) => {
  const { text } = req.body;

  if (!text) return res.json({ message: "No text provided" });

  const embedding = await getEmbedding(text);

  dataStore.push({ text, embedding });
  saveData();

  res.json({ message: "Text added" });
});

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
    const results = getTopKMatches(queryEmbedding, dataStore, 2);

    const context = results
      .map((r) => `[Source: ${r.source}]\n${r.text.slice(0, 200)}`)
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
      // cache models once
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

      // USE SAVED MODEL (FAST PATH)
      if (selectedModel) {
        try {
          const response = await axios.post(
            "https://api.groq.com/openai/v1/chat/completions",
            {
              model: selectedModel,
              messages: [
                {
                  role: "system",
                  content: `
You are a senior software engineer.

Answer ONLY using the given context.

Rules:
- Do NOT use outside knowledge
- Do NOT make assumptions
- If unsure, say: "Not enough information in context"
- Keep answers concise (4-6 lines)
- Focus on correctness over completeness
- If code is present, format it using triple backticks with language
`,
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
        } catch (err) {
          console.log("Saved model failed, retrying...");
          selectedModel = null; // reset
        }
      }

      // FIND MODEL (ONLY ONCE)
      if (!selectedModel) {
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
`,
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

            selectedModel = model; // cache model
            console.log("Selected model:", model);

            answer = response.data.choices[0].message.content;
            break;
          } catch (err) {
            console.log("Skipping model:", model);
            continue;
          }
        }
      }

      if (!answer) {
        throw new Error("No working model found");
      }
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
      name: r.source,
      url: r.url,
    }));

    res.json({ answer, sources });

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

      dataStore.push({
        text: file.text,
        source: file.file,
        url: file.url,
        embedding,
      });
    }

    saveData();

    res.json({ message: "GitHub repo ingested" });
  } catch (err) {
    console.error("ERROR:", err.message);
    res.status(500).json({ error: "GitHub ingestion failed" });
  }
});

app.listen(3000, () => console.log("Server running"));
