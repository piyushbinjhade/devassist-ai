import { pipeline } from "@xenova/transformers";
import axios from "axios";

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

// extract owner + repo
function parseGitHubUrl(url) {
  const cleaned = url.replace(".git", "").replace(/\/$/, "");
  const parts = cleaned.split("/");
  return {
    owner: parts[3],
    repo: parts[4],
  };
}

export async function fetchGitHubRepo(repoUrl) {
  const cleaned = repoUrl.replace(".git", "").replace(/\/$/, "");
  const parts = cleaned.split("/");

  const owner = parts[3];
  const repo = parts[4];

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;

  console.log("Fetching:", apiUrl);

  const response = await axios.get(apiUrl);

  const files = response.data.filter(file =>
    file.type === "file" &&
    file.download_url &&
    (
      file.name.endsWith(".md") ||
      file.name.endsWith(".js") ||
      file.name.endsWith(".py")
    )
  );

  const selectedFiles = files.slice(0, 5);

  let contents = [];

  for (let file of selectedFiles) {
    const fileData = await axios.get(file.download_url);

    contents.push({
      file: file.name,
      text: fileData.data,
    });
  }

  return contents;
}