import { pipeline } from "@xenova/transformers";

let extractor;

// load model once
async function loadModel() {
  if (!extractor) {
    extractor = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
  }
}

export async function getEmbedding(text) {
  await loadModel();

  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });

  return Array.from(output.data);
}