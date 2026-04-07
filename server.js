import express from "express";
import dotenv from "dotenv";
import { getEmbedding } from "./rag/ingest.js";
import { getTopKMatches } from "./rag/query.js";
import axios from "axios";
import { fetchGitHubRepo } from "./rag/ingest.js";

dotenv.config();

const app = express();
app.use(express.json());

// temporary storage
let dataStore = [];

app.post("/add", async (req, res) => {
  const { text } = req.body;

  const embedding = await getEmbedding(text);

  dataStore.push({ text, embedding });

  res.json({ message: "Text added" });
});

app.post("/query", async (req, res) => {
  const { question } = req.body;

  // 1. Get embedding
  const queryEmbedding = await getEmbedding(question);

  // 2. Get top-k results
  const results = getTopKMatches(queryEmbedding, dataStore, 2);

  const context = results
  .map(r => r.text.slice(0, 500)) // limit each chunk
  .join("\n");

  // 3. Build prompt
  const prompt = `
You are a helpful developer assistant.

Use ONLY the provided context to answer the question.
Do NOT copy the context directly.
Explain in your own words in a clear and structured way.
Context:
${context}

Question:
${question}

Answer clearly:
`;

  // 4. Call Ollama
  const response = await axios.post("http://localhost:11434/api/generate", {
    model: "phi3",
    prompt: prompt,
    stream: false,
  });

  // 5. Send final answer
  res.json({ answer: response.data.response });
});

app.post("/ingest/github", async (req, res) => {
  const { repoUrl } = req.body;

  const files = await fetchGitHubRepo(repoUrl);

  for (let file of files) {
    const embedding = await getEmbedding(file.text);

    dataStore.push({
      text: file.text,
      source: file.file,
      embedding,
    });
  }

  res.json({ message: "GitHub repo ingested" });
});

app.listen(3000, () => console.log("Server running"));