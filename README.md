# DevAssist AI 🤖

A developer-focused RAG (Retrieval-Augmented Generation) assistant that ingests GitHub repositories, answers code-related questions, and falls back to web search when repository context is insufficient.

## ✨ Features

- **Repository Ingestion**: Ingest GitHub repos and build searchable vector context
- **Repo-Specific Queries**: Select a repo and ask questions only against that repository
- **Web Search Fallback**: Uses Tavily when repo or LLM context is missing
- **Sources in Answers**: Returns both repo file links and web search sources
- **Vector Search**: Pinecone-powered semantic retrieval
- **React UI**: Clean Vite + React interface with chat and sources
- **Caching**: Intelligent caching for improved performance
- **Multi-Model Support**: Supports various Groq models (Llama, Mixtral)

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │    │   Express API   │    │   Vector DB     │
│   (Vite)        │◄──►│   (Node.js)     │◄──►│   (Pinecone)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │                        │
                              ▼                        ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │   LLM API       │    │   Web Search    │
                       │   (Groq)        │    │   (Tavily)      │
                       └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- GitHub Personal Access Token (recommended for GitHub API rate limits)
- Pinecone API key and index
- Groq API key
- Tavily API key (optional, but required for web search fallback)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd devassist-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd client
   npm install
   cd ..
   ```

3. **Create `.env` in the project root**
   ```env
   
   PINECONE_API_KEY=your_pinecone_api_key
   PINECONE_INDEX=your_dense_index_name
   GROQ_API_KEY=your_groq_api_key
   USE_API=true
   TAVILY_API_KEY=your_tavily_api_key
   GITHUB_TOKEN=ghp_your_github_token
   ```

   > The Pinecone index must be a **Dense** index with **384 dimensions**.

4. **Start the backend and frontend**
   ```bash
   npm start
   cd client
   npm run dev
   ```

5. **Open your browser**
   Visit `http://localhost:5173`

## 📖 Usage

### 1) Ingest a GitHub repository

- Paste a GitHub repo URL into the input field
- Click **Ingest**
- Wait for the ingestion job to finish
- The repo is stored in a dedicated namespace

### 2) Select a repo for queries

- After ingestion, choose the ingested repo from the dropdown
- Queries use that repo's data only

### 3) Ask questions

- Enter a question in the chat box
- Press Enter or click **Send**
- Answers include:
  - repo-based sources when available
  - web search sources when fallback is used

### What happens when repo context is missing?

- The system searches the selected repo namespace in Pinecone first
- If results are weak or missing, it falls back to Tavily web search
- The response returns `usedWeb: true` and includes web source links

## 🧠 How it works

1. GitHub repo files are fetched and chunked
2. Chunks are embedded and stored in Pinecone under a repo-specific namespace
3. User queries are converted to embeddings and queried against that namespace
4. If no strong repo context exists, Tavily search is used
5. Groq completes the answer with repo and/or web context

## 🛠️ Tech Stack

### Backend
- Node.js
- Express.js
- Pinecone
- Axios
- Groq API
- Tavily API
- @xenova/transformers

### Frontend
- React 19
- Vite
- React Markdown
- React Syntax Highlighter

## 🌐 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PINECONE_API_KEY` | Pinecone API key | Yes |
| `PINECONE_INDEX` | Pinecone dense index name (384 dims) | Yes |
| `GROQ_API_KEY` | Groq API key | Yes |
| `USE_API` | Enable LLM API | Yes |
| `TAVILY_API_KEY` | Tavily search API key | Recommended |
| `GITHUB_TOKEN` | GitHub token for repo access | Recommended |
| `VITE_API_BASE` | Frontend backend URL | No |

## 🚀 Deployment Notes

- Build the client with `cd client && npm run build`
- Deploy `client/dist` to static hosting
- Deploy `server.js` to a Node host
- Set `VITE_API_BASE` to your backend URL in production

## 📁 Project Structure

```
devassist-ai/
├── server.js              # Express server and API endpoints
├── rag/                   # Repository ingestion utilities
│   ├── ingest.js
│   └── pinecone.js
├── client/                # React frontend
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── public/
│   └── package.json
├── package.json           # Server dependencies
├── README.md              # Project documentation
└── .env                   # Environment variables (gitignored)
```

## ⚠️ Notes

- Repos are stored in isolated Pinecone namespaces for data separation
- Web search fallback only triggers when repo context is weak or missing
- Answers include both repo and web sources when available

## 🔒 Disclaimer

Use this tool responsibly. Monitor API usage, respect repository licenses, and avoid exposing secret keys in public repositories.
