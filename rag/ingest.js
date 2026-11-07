import { pipeline } from "@xenova/transformers";
import axios from "axios";

// The transformer pipeline is loaded lazily because model initialization is
// expensive. Once loaded, every ingestion and query reuses this instance.
let extractor;

// Create the local sentence-embedding model on first use. Keeping this local
// avoids a hosted embedding dependency, but uses CPU/memory in this process.
async function loadModel() {
  // Only initialize the model when the first embedding is requested.
  if (!extractor) {
    try {
      // Create a feature-extraction pipeline using the selected sentence model.
      extractor = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
    } catch (err) {
      // Log the model-loading failure while preserving the original exception.
      console.error("Failed to load embedding model:", err.message);
      // Let the API route decide how to report the failed embedding operation.
      throw err;
    }
  }
}

// Convert text into vectors using all-MiniLM-L6-v2. With mean pooling and
// normalization, each input becomes a normalized 384-number vector, which is
// the dimensionality required by the Pinecone dense index.
export async function getEmbedding(text) {
  try {
    // Ensure the shared model exists before attempting inference.
    await loadModel();

    // Convert one string or an array of strings into model output tensors.
    const output = await extractor(text, {
      // Average token representations into one vector for each input.
      pooling: "mean",
      // Scale vectors to unit length for stable similarity comparisons.
      normalize: true,
    });

    // Batched input returns a two-dimensional array, one vector per string.
    if (Array.isArray(text)) {
      // Convert the transformer tensor into ordinary JavaScript arrays.
      return output.tolist();
    }

    // Convert the single vector's typed-array data into a normal array.
    let embedding = Array.from(output.data);
    // Return the vector to either the query route or ingestion route.
    return embedding;
  } catch (err) {
    // Record the failure and allow the caller to handle it.
    console.error("Embedding generation failed:", err.message);
    throw err;
  }
}

// Called by fetchGitHubRepo() below. Split source text into overlapping
// character windows. Overlap helps preserve
// context across boundaries, while the fixed size keeps embedding requests
// predictable. Character windows are simple but are not syntax/token aware.
function chunkText(text, chunkSize = 500, overlap = 100) {
  // Allocate the output collection for all generated chunks.
  const chunks = [];

  // Start slicing at the beginning of the source file.
  let start = 0;

  // Continue until every character has been included in a chunk.
  while (start < text.length) {
    // Calculate the exclusive end position for the current window.
    const end = start + chunkSize;

    // Copy the current character window from the source text.
    const chunk = text.slice(start, end);
    // Preserve that window for later embedding.
    chunks.push(chunk);

    // move with overlap
    // Advance less than chunkSize so adjacent chunks overlap.
    start += chunkSize - overlap;
  }

  // Expose a useful diagnostic during ingestion.
  console.log("Chunks created:", chunks.length);
  // Return all chunks to the repository downloader.
  return chunks;
}

export async function fetchGitHubRepo(repoUrl) {
  // Called by POST /ingest/github in server.js. It returns chunk objects that
  // the route later embeds and stores in Pinecone.
  try {
    // Accept both a full GitHub URL and the shorthand owner/repository form.
    // The same owner/repository pair later becomes the Pinecone namespace.
    // Remove a trailing Git suffix/slash and surrounding whitespace.
    const cleaned = repoUrl.replace(".git", "").replace(/\/$/, "").trim();

    // Better URL validation - support multiple formats
    // Reserve variables for the GitHub owner and repository name.
    let owner, repo;

    if (cleaned.includes("github.com")) {
      // Split a full URL into protocol, host, owner, and repository segments.
      const parts = cleaned.split("/");
      // Read the owner segment from the normalized URL.
      owner = parts[3];
      // Read the repository segment from the normalized URL.
      repo = parts[4];
    } else {
      // Handle shorthand format "owner/repo"
      // Split shorthand input such as "owner/repository".
      const parts = cleaned.split("/");
      // Accept shorthand only when it contains exactly two segments.
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

    // GitHub accepts unauthenticated requests, but a token raises the rate
    // limit. The helper centralizes headers for directory and raw-file calls.
    // Build fresh headers for each GitHub request.
    const getHeaders = () => ({
      // Authenticate when a token exists; otherwise use GitHub anonymously.
      Authorization: process.env.GITHUB_TOKEN
        ? `token ${process.env.GITHUB_TOKEN}`
        : "",
      // Identify this application to GitHub.
      "User-Agent": "devassist-ai",
      // Request GitHub's JSON API representation for directory listings.
      Accept: "application/vnd.github.v3+json",
    });

    if (!process.env.GITHUB_TOKEN) {
      console.warn("No GITHUB_TOKEN configured (60 req/hr limit)");
    }

    // Restrict ingestion to source and documentation formats understood here.
    const allowedExtensions = [".js", ".ts", ".jsx", ".tsx", ".md"];
    // Limit the number of files to keep API and embedding work bounded.
    const MAX_FILES = 20;
    // Limit recursive traversal depth to avoid enormous repository trees.
    const MAX_DEPTH = 3;

    function isAllowedFile(name) {
      // Return true when the filename ends with one supported extension.
      return allowedExtensions.some((ext) => name.toLowerCase().endsWith(ext));
    }

    // Traverse only a bounded portion of the repository. The limits protect
    // the API and local model from very large repositories.
    async function fetchDirectory(path = "", depth = 0, collected = []) {
      if (collected.length >= MAX_FILES || depth >= MAX_DEPTH) {
        return collected;
      }

      // Build the GitHub Contents API URL for this directory.
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents${path}`;

      try {
        // Fetch directory entries with a five-second network timeout.
        const response = await axios.get(apiUrl, {
          headers: getHeaders(),
          timeout: 5000, // 5 second timeout
        });

        if (!response.data || !Array.isArray(response.data)) {
          return collected;
        }

        // Inspect each file or directory returned by GitHub.
        for (let item of response.data) {
          if (collected.length >= MAX_FILES) break;

          if (
            item.type === "file" &&
            item.download_url &&
            isAllowedFile(item.name)
          ) {
            // Save supported files for the later raw-content download.
            collected.push(item);
            continue;
          }

          if (item.type === "dir" && depth < MAX_DEPTH) {
            // Recurse into directories while carrying the shared collection.
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

    // File downloads are concurrent, so a slow file does not block every
    // other download. Promise.all still waits for all selected files before
    // returning the complete list of chunks.
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

        // const chunks = chunkText(rawText, 300);
        const chunks = chunkText(rawText, 500, 100);
        // This is the hand-off contract to server.js: each chunk has source
        // identity, searchable text, and a browser-friendly GitHub URL.
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
