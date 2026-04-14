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

    const headers = {};
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `token ${process.env.GITHUB_TOKEN}`;
    }

    const allowedExtensions = [".js", ".ts", ".jsx", ".tsx"];
    const MAX_FILES = 20;
    const MAX_DEPTH = 3;

    function isAllowedFile(name) {
      return (
        name === "README.md" ||
        allowedExtensions.some((ext) => name.toLowerCase().endsWith(ext))
      );
    }

    async function fetchDirectory(path = "", depth = 0, collected = []) {
      if (collected.length >= MAX_FILES || depth > MAX_DEPTH) {
        return collected;
      }

      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${path}`;
      const response = await axios.get(apiUrl, { headers });

      for (let item of response.data) {
        if (collected.length >= MAX_FILES) break;

        if (item.type === "file" && item.download_url && isAllowedFile(item.name)) {
          collected.push(item);
          continue;
        }

        if (item.type === "dir" && depth < MAX_DEPTH) {
          await fetchDirectory(`${path}/${item.name}`, depth + 1, collected);
        }
      }

      return collected;
    }

    const files = await fetchDirectory();
    console.log(`Found ${files.length} matching files`);

    const selectedFiles = files.slice(0, MAX_FILES);
    console.log(`Selected ${selectedFiles.length} files for download`);

    let contents = [];

    for (let file of selectedFiles) {
      try {
        console.log(`Downloading: ${file.path || file.name}, size: ${file.size} bytes`);
        const fileHeaders = {};
        if (process.env.GITHUB_TOKEN) {
          fileHeaders.Authorization = `token ${process.env.GITHUB_TOKEN}`;
        }
        const fileData = await axios.get(file.download_url, { headers: fileHeaders });

        const rawText =
          typeof fileData.data === "string"
            ? fileData.data
            : JSON.stringify(fileData.data);

        console.log(`Downloaded ${file.path || file.name}, content length: ${rawText.length}`);
        const chunks = chunkText(rawText, 300);
        console.log(`Created ${chunks.length} chunks for ${file.path || file.name}`);

        for (let chunk of chunks) {
          contents.push({
            file: file.path || file.name,
            text: chunk,
            url: file.html_url,
          });
        }
      } catch (fileErr) {
        console.error(`Failed to download ${file.path || file.name}:`, fileErr.message);
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
