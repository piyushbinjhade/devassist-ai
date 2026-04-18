import { pipeline } from "@xenova/transformers";
import axios from "axios";

let extractor;

// Load the embedding model locally
async function loadModel() {
  if (!extractor) {
    try {
      extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
    } catch (err) {
      console.error("Failed to load embedding model:", err.message);
      throw err;
    }
  }
}

// EMBEDDING - Using Local Transformers
export async function getEmbedding(text) {
  try {
    await loadModel();

    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    if (Array.isArray(text)) {
      return output.tolist();
    }

    let embedding = Array.from(output.data);
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
    // STEP 1: URL PARSING
    const cleaned = repoUrl.replace(".git", "").replace(/\/$/, "").trim();

    // Better URL validation - support multiple formats
    let owner, repo;

    if (cleaned.includes("github.com")) {
      const parts = cleaned.split("/");
      owner = parts[3];
      repo = parts[4];
    } else {
      // Handle shorthand format "owner/repo"
      const parts = cleaned.split("/");
      if (parts.length === 2) {
        owner = parts[0];
        repo = parts[1];
      }
    }

    if (!owner || !repo) {
      throw new Error(
        `Invalid GitHub URL. Expected: https://github.com/owner/repo or owner/repo. Got: ${repoUrl}`,
      );
    }

    console.log(`Ingesting: ${owner}/${repo}`);

    // STEP 2: GITHUB API HEADERS WITH RETRY
    const getHeaders = () => ({
      Authorization: process.env.GITHUB_TOKEN
        ? `token ${process.env.GITHUB_TOKEN}`
        : "",
      "User-Agent": "devassist-ai",
      Accept: "application/vnd.github.v3+json",
    });

    if (!process.env.GITHUB_TOKEN) {
      console.warn("No GITHUB_TOKEN configured (60 req/hr limit)");
    }

    const allowedExtensions = [".js", ".ts", ".jsx", ".tsx", ".md"];
    const MAX_FILES = 20;
    const MAX_DEPTH = 3;

    function isAllowedFile(name) {
      return allowedExtensions.some((ext) => name.toLowerCase().endsWith(ext));
    }

    // STEP 3: RECURSIVE DIRECTORY FETCH WITH ERROR HANDLING
    async function fetchDirectory(path = "", depth = 0, collected = []) {
      if (collected.length >= MAX_FILES || depth >= MAX_DEPTH) {
        return collected;
      }

      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${path}`;

      try {
        const response = await axios.get(apiUrl, {
          headers: getHeaders(),
          timeout: 5000, // 5 second timeout
        });

        if (!response.data || !Array.isArray(response.data)) {
          return collected;
        }

        for (let item of response.data) {
          if (collected.length >= MAX_FILES) break;

          if (
            item.type === "file" &&
            item.download_url &&
            isAllowedFile(item.name)
          ) {
            collected.push(item);
            continue;
          }

          if (item.type === "dir" && depth < MAX_DEPTH) {
            await fetchDirectory(`${path}/${item.name}`, depth + 1, collected);
          }
        }

        return collected;
      } catch (err) {
        // Check for rate limit
        if (err.response?.status === 403) {
          console.error(`Rate limited (403) - Add GITHUB_TOKEN to .env`);
        } else if (err.response?.status === 404) {
          console.error(`Repository not found (404): ${owner}/${repo}`);
        } else if (err.code === "ECONNABORTED") {
          console.error(`Request timeout (5s) - GitHub API slow`);
        } else {
          console.error(`GitHub API error for ${path}:`, err.message);
        }
        // Return what we've collected so far instead of crashing
        return collected;
      }
    }

    const files = await fetchDirectory();

    if (!files || files.length === 0) {
      throw new Error(
        "No JavaScript/TypeScript files found in repository. " +
          "Ensure repo is public and contains .js, .ts, .jsx, .tsx, or .md files.",
      );
    }

    console.log(`Found ${files.length} files, downloading...`);

    const selectedFiles = files.slice(0, MAX_FILES);

    let contents = [];
    let downloadedCount = 0;
    let failedCount = 0;

    const downloadPromises = selectedFiles.map(async (file) => {
      try {
        const fileHeaders = getHeaders();
        fileHeaders.Accept = "application/vnd.github.v3.raw";

        const fileData = await axios.get(file.download_url, {
          headers: fileHeaders,
          timeout: 5000,
        });

        const rawText =
          typeof fileData.data === "string"
            ? fileData.data
            : JSON.stringify(fileData.data);

        // Skip empty files
        if (!rawText || rawText.trim().length === 0) {
          return { success: false };
        }

        const chunks = chunkText(rawText, 300);
        const mappedChunks = chunks.map((chunk) => ({
          file: file.path || file.name,
          text: chunk,
          url: file.html_url,
        }));

        return { success: true, chunks: mappedChunks };
      } catch (fileErr) {
        return { success: false };
      }
    });

    const results = await Promise.all(downloadPromises);

    for (const res of results) {
      if (res.success) {
        downloadedCount++;
        contents.push(...res.chunks);
      } else {
        failedCount++;
      }
    }

    if (contents.length === 0) {
      throw new Error(
        `Failed to download any files. Checked ${selectedFiles.length} files, ` +
          `downloaded ${downloadedCount}, got ${failedCount} errors. ` +
          `Check GITHUB_TOKEN in .env`,
      );
    }

    return contents;
  } catch (err) {
    console.error("Ingestion error:", err.message);
    throw err;
  }
}
