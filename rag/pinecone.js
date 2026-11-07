import { Pinecone } from "@pinecone-database/pinecone";

// Read the Pinecone SDK constructor from the installed dependency.
// This module exposes a standalone Pinecone index client. The active server
// currently creates an equivalent client directly in server.js; keeping this
// helper documented makes that duplication visible during future refactoring.
// Create a client using the secret API key from the server-only environment.
const pc = new Pinecone({
  // Pass the configured Pinecone key to authenticate every database request.
  apiKey: process.env.PINECONE_API_KEY,
});

// Select the configured index so callers can write and search its vectors.
export const index = pc.index(process.env.PINECONE_INDEX);
