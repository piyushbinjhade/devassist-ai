import express from "express";
import dotenv from "dotenv";
import { getEmbedding } from "./rag/ingest.js";
import { getTopMatch } from "./rag/query.js";
import { getTopKMatches } from "./rag/query.js";

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

  const queryEmbedding = await getEmbedding(question);

  const results = getTopKMatches(queryEmbedding, dataStore, 3);

  const combinedText = results.map(r => r.text).join("\n");

  res.json({ answer: combinedText });
});

app.listen(3000, () => console.log("Server running"));