import { pipeline } from "@xenova/transformers";
import axios from "axios";

let extractor;

async function loadModel() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
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

function chunkText(text, size = 300) {
  let chunks = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

export async function fetchGitHubRepo(repoUrl) {
  try {
    const cleaned = repoUrl.replace(".git", "").replace(/\/$/, "");
    const parts = cleaned.split("/");

    if (parts.length < 5 || parts[2] !== "github.com") {
      throw new Error(
        "Invalid GitHub URL format. Expected: https://github.com/owner/repo",
      );
    }

    const owner = parts[3];
    const repo = parts[4];

    if (!owner || !repo) {
      throw new Error("Could not extract owner and repo from URL");
    }

    console.log(`Fetching repo: ${owner}/${repo}`);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents`;

    const response = await axios.get(apiUrl);

    const files = response.data.filter(
      (file) =>
        file.type === "file" &&
        file.download_url &&
        (file.name === "README.md" ||
          file.name.endsWith(".js") ||
          file.name.endsWith(".ts")),
    );

    console.log(`Found ${files.length} matching files`);
    const selectedFiles = files.slice(0, 5);

    let contents = [];

    for (let file of selectedFiles) {
      try {
        console.log(`Downloading: ${file.name}`);
        const fileData = await axios.get(file.download_url);

        const chunks = chunkText(fileData.data, 300);

        for (let chunk of chunks) {
          contents.push({
            file: file.name,
            text: chunk,
            url: file.html_url,
          });
        }
      } catch (fileErr) {
        console.error(`Failed to download ${file.name}:`, fileErr.message);
        continue;
      }
    }

    console.log(`Processed ${contents.length} chunks`);
    return contents;
  } catch (err) {
    console.error("Error in fetchGitHubRepo:", err.message);
    throw err;
  }
}
