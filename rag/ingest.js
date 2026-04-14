import { pipeline } from "@xenova/transformers";
import axios from "axios";

let extractor;

async function loadModel() {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
}

export async function getEmbedding(text) {
  try {
    await loadModel();
    console.log("Model loaded, generating embedding for text length:", text.length);

    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    const embedding = Array.from(output.data);
    console.log("Generated embedding, length:", embedding.length);
    return embedding;
  } catch (err) {
    console.error("Embedding generation failed:", err.message);
    throw err;
  }
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

    const headers = {};
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    }

    const response = await axios.get(apiUrl, { headers });

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
        console.log(`Downloading: ${file.name}, size: ${file.size} bytes`);
        const fileHeaders = {};
        if (process.env.GITHUB_TOKEN) {
          fileHeaders.Authorization = `token ${process.env.GITHUB_TOKEN}`;
        }
        const fileData = await axios.get(file.download_url, { headers: fileHeaders });

        console.log(`Downloaded ${file.name}, content length: ${fileData.data.length}`);
        const chunks = chunkText(fileData.data, 300);
        console.log(`Created ${chunks.length} chunks for ${file.name}`);

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
