# DevAssist AI 🤖

A powerful RAG (Retrieval-Augmented Generation) based AI assistant designed specifically for developers. It helps you understand and work with your codebase by ingesting GitHub repositories and providing intelligent answers to your questions.

## ✨ Features

- **Repository Ingestion**: Ingest entire GitHub repositories for context-aware assistance
- **Intelligent Q&A**: Ask questions about your codebase and get precise answers
- **Web Search Integration**: Falls back to web search when codebase context is insufficient
- **Vector Search**: Uses Pinecone for fast, semantic code search
- **Modern UI**: Clean, responsive React interface with syntax highlighting
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

## � Quick Start

### Prerequisites

- Node.js 18+
- GitHub account (for repository access)
- API keys for:
  - [Pinecone](https://pinecone.io) (vector database - must be **dense** index with 384 dimensions)
  - [Groq](https://groq.com) (LLM API)
  - [Tavily](https://tavily.com) (web search - optional)
  - GitHub Personal Access Token (for higher rate limits)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd devassist-ai
   ```

2. **Install dependencies**
   ```bash
   # Install server dependencies
   npm install

   # Install client dependencies
   cd client
   npm install
   cd ..
   ```

3. **Environment Setup**
   Create a `.env` file in the root directory:
   ```env
   # Pinecone Configuration (must be DENSE index with 384 dimensions)
   PINECONE_API_KEY=your_pinecone_api_key
   PINECONE_INDEX=your_dense_index_name

   # Groq API Configuration
   GROQ_API_KEY=your_groq_api_key
   USE_API=true

   # Web Search (Optional)
   TAVILY_API_KEY=your_tavily_api_key

   # GitHub Token (for higher rate limits)
   GITHUB_TOKEN=ghp_your_github_token
   ```

   **Important:** Your Pinecone index must be configured as **Dense** (not Sparse) with dimension 384 to work with the embedding model.

4. **Start the application**
   ```bash
   # Start the server (in one terminal)
   npm start

   # Start the client (in another terminal)
   cd client
   npm run dev
   ```

5. **Open your browser**
   Navigate to `http://localhost:5173`

## 📖 Usage

### Ingesting a Repository

1. Paste a GitHub repository URL in the input field
2. Click "Ingest" to process the repository
3. Wait for the ingestion to complete

### Asking Questions

1. Type your question about the codebase in the chat input
2. Press Enter or click Send
3. The AI will provide answers based on the ingested code

### Understanding Responses

- **Sources**: Links to relevant files or web pages
- **🌐 Web Search Used**: Indicates when web search was used for additional context
- **Code Blocks**: Syntax-highlighted code snippets in responses

## 🛠️ Tech Stack

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Pinecone** - Vector database for semantic search
- **@xenova/transformers** - Local embedding generation
- **Axios** - HTTP client for API calls

### Frontend
- **React 19** - UI framework
- **Vite** - Build tool and dev server
- **React Syntax Highlighter** - Code syntax highlighting
- **React Markdown** - Markdown rendering

### AI/ML
- **Groq API** - Fast LLM inference
- **Tavily API** - Web search integration
- **Transformers.js** - Local embeddings

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PINECONE_API_KEY` | Pinecone API key | Yes |
| `PINECONE_INDEX` | Pinecone dense index name (384 dimensions) | Yes |
| `GROQ_API_KEY` | Groq API key | Yes |
| `USE_API` | Enable LLM API (set to "true") | Yes |
| `TAVILY_API_KEY` | Tavily API key for web search | No |
| `GITHUB_TOKEN` | GitHub Personal Access Token | Recommended |

### Pinecone Setup

1. Create a Pinecone account and index
2. Set dimension to 384 (for the embedding model used)
3. Configure the index name in your `.env` file

## � Deployment

### Backend Deployment
1. Deploy the server to a platform like Render, Railway, or Heroku
2. Set all environment variables in your deployment platform
3. Ensure the server runs on the correct port (uses `process.env.PORT || 3000`)

### Frontend Deployment
1. Build the client: `cd client && npm run build`
2. Deploy the `client/dist` folder to Vercel, Netlify, or similar
3. Set `VITE_API_BASE` environment variable to your backend URL (e.g., `https://your-backend.onrender.com`)

### Client Environment Variables
For the React client, create environment variables in your deployment platform:
```env
VITE_API_BASE=https://your-backend-url.com
```

## �📁 Project Structure

```
devassist-ai/
├── server.js              # Express server and API endpoints
├── rag/
│   ├── ingest.js         # GitHub repo ingestion logic
│   └── pinecone.js       # Pinecone utilities
├── client/               # React frontend
│   ├── src/
│   │   ├── App.jsx       # Main React component
│   │   ├── main.jsx      # App entry point
│   │   └── index.css     # Global styles
│   ├── public/           # Static assets
│   └── package.json      # Client dependencies
├── package.json          # Server dependencies
├── .env                  # Environment variables (gitignored)
└── README.md            # This file
```

## 🚨 Disclaimer

This tool is for educational and development purposes. Be mindful of API rate limits and costs when using external services. Always respect repository licenses and terms of service.