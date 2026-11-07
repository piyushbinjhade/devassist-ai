import { useEffect, useRef, useState } from "react";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light.js";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark.js";
import bash from "refractor/bash";
import c from "refractor/c";
import csharp from "refractor/csharp";
import css from "refractor/css";
import go from "refractor/go";
import java from "refractor/java";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import markup from "refractor/markup";
import php from "refractor/php";
import python from "refractor/python";
import rust from "refractor/rust";
import sql from "refractor/sql";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";
import "./App.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";
const SUGGESTED_QUESTIONS = [
  "How is the application structured?",
  "Where is the main API configured?",
  "How does repository indexing work?",
  "What are the main dependencies?",
];

[
  ["bash", bash],
  ["c", c],
  ["csharp", csharp],
  ["css", css],
  ["go", go],
  ["java", java],
  ["javascript", javascript],
  ["json", json],
  ["jsx", jsx],
  ["markup", markup],
  ["php", php],
  ["python", python],
  ["rust", rust],
  ["sql", sql],
  ["tsx", tsx],
  ["typescript", typescript],
  ["yaml", yaml],
].forEach(([name, language]) => SyntaxHighlighter.registerLanguage(name, language));
SyntaxHighlighter.alias("js", "javascript");
SyntaxHighlighter.alias("ts", "typescript");
SyntaxHighlighter.alias("html", "markup");
SyntaxHighlighter.alias("xml", "markup");
SyntaxHighlighter.alias("sh", "bash");

function Icon({ name, size = 18 }) {
  const paths = {
    add: <path d="M12 5v14m-7-7h14" />,
    arrow: <path d="M5 12h14m-7-7 7 7-7 7" />,
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    close: <path d="m18 6-12 12M6 6l12 12" />,
    code: <path d="m8 17-5-5 5-5m8 10 5-5-5-5m-2-12-4 18" />,
    copy: (
      <>
        <rect x="8" y="8" width="13" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
    external: (
      <>
        <path d="M14 3h7v7m-1-6-9 9" />
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8m-8 4h8" />
      </>
    ),
    github: (
      <>
        <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.7c3-.3 6.2-1.5 6.2-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.2-.4-3.8 1.4a13.2 13.2 0 0 0-7 0C5.4 1.1 4.2 1.5 4.2 1.5a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.2 6.4 6.2 6.7A3.4 3.4 0 0 0 8 18.1V22" />
      </>
    ),
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    message: (
      <>
        <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z" />
      </>
    ),
    retry: (
      <>
        <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" />
        <path d="M3 3v5h5" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" />
        <path d="m19 14 1.1 2.9L23 18l-2.9 1.1L19 22l-1.1-2.9L15 18l2.9-1.1L19 14Z" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function readSavedChats() {
  try {
    const saved = JSON.parse(localStorage.getItem("devassist_chats") || "null");
    if (Array.isArray(saved) && saved.length > 0) return saved;
  } catch (error) {
    console.error("Failed to load saved chats:", error);
  }
  return [{ id: createId(), title: "New chat", messages: [] }];
}

function parseGitHubRepo(value) {
  const input = value.trim();
  const match = input.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+)\/?$/i,
  );
  const shorthand = input.match(/^([^/\s?#]+)\/([^/\s?#]+)$/);
  const parts = match || shorthand;
  if (!parts) return null;

  const owner = parts[1];
  const repo = parts[2].replace(/\.git$/i, "");
  if (
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(repo) ||
    owner === "." ||
    owner === ".." ||
    repo === "." ||
    repo === ".."
  ) {
    return null;
  }
  return {
    owner,
    name: repo,
    url: `https://github.com/${owner}/${repo}`,
  };
}

function getErrorMessage(error, fallback) {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
}

function App() {
  const [chats, setChats] = useState(readSavedChats);
  const [activeChatId, setActiveChatId] = useState(null);
  const [repoInput, setRepoInput] = useState("");
  const [repository, setRepository] = useState(null);
  const [repoError, setRepoError] = useState("");
  const [isIngesting, setIsIngesting] = useState(false);
  const [question, setQuestion] = useState("");
  const [loadingChatId, setLoadingChatId] = useState(null);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(
    () => window.matchMedia("(min-width: 921px)").matches,
  );
  const [selectedSource, setSelectedSource] = useState(null);
  const [copied, setCopied] = useState("");
  const [copyError, setCopyError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const chatEndRef = useRef(null);
  const questionRef = useRef(null);

  const currentChat = chats.find((chat) => chat.id === activeChatId) || chats[0];
  const messages = currentChat?.messages || [];
  const chatContextMismatch =
    messages.length > 0 &&
    (!currentChat?.repoUrl ||
      !repository ||
      currentChat.repoUrl !== repository.url);
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.type === "bot");
  const displayedSources =
    selectedSource?.sources || latestAssistant?.sources || [];

  useEffect(() => {
    localStorage.setItem("devassist_chats", JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    if (!chats.some((chat) => chat.id === activeChatId)) {
      setActiveChatId(chats[0]?.id || null);
    }
  }, [activeChatId, chats]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeChatId, messages.length, loadingChatId]);

  const updateChatMessages = (chatId, update) => {
    setChats((previous) =>
      previous.map((chat) =>
        chat.id === chatId
          ? { ...chat, messages: update(chat.messages) }
          : chat,
      ),
    );
  };

  const createNewChat = () => {
    const chat = {
      id: createId(),
      title: "New chat",
      messages: [],
      repoUrl: repository?.url || null,
    };
    setChats((previous) => [chat, ...previous]);
    setActiveChatId(chat.id);
    setSelectedSource(null);
    setSidebarOpen(false);
    questionRef.current?.focus();
  };

  const deleteChat = (event, id) => {
    event.stopPropagation();
    const remaining = chats.filter((chat) => chat.id !== id);
    if (remaining.length === 0) {
      const replacement = {
        id: createId(),
        title: "New chat",
        messages: [],
        repoUrl: repository?.url || null,
      };
      setChats([replacement]);
      setActiveChatId(replacement.id);
    } else {
      setChats(remaining);
      if (activeChatId === id) setActiveChatId(remaining[0].id);
    }
    if (loadingChatId === id) setLoadingChatId(null);
  };

  const connectRepository = async (event, retryRepo = null) => {
    event?.preventDefault();
    setRepoError("");
    const parsedRepo = retryRepo || parseGitHubRepo(repoInput);
    if (!parsedRepo) {
      setRepoError("Enter a GitHub repository URL or owner/repository.");
      return;
    }
    if (isIngesting) return;

    setRepoInput(parsedRepo.url);
    if (currentChat?.messages.length && currentChat.repoUrl !== parsedRepo.url) {
      const newChat = {
        id: createId(),
        title: "New chat",
        messages: [],
        repoUrl: parsedRepo.url,
      };
      setChats((previous) => [newChat, ...previous]);
      setActiveChatId(newChat.id);
      setSelectedSource(null);
    } else if (currentChat) {
      setChats((previous) =>
        previous.map((chat) =>
          chat.id === currentChat.id
            ? { ...chat, repoUrl: parsedRepo.url }
            : chat,
        ),
      );
    }
    setRepository({
      ...parsedRepo,
      status: "processing",
      progress: "Starting repository indexing…",
      stored: null,
    });
    setIsIngesting(true);

    try {
      const response = await axios.post(`${API_BASE}/ingest/github`, {
        repoUrl: parsedRepo.url,
      });
      const jobId = response.data?.jobId;
      if (!jobId) {
        throw new Error("The server did not return an indexing job ID.");
      }

      let completed = false;
      for (let attempt = 0; attempt < 450; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusResponse = await axios.get(
          `${API_BASE}/ingest/status/${encodeURIComponent(jobId)}`,
        );
        const job = statusResponse.data;

        if (job.status === "completed") {
          const stored = job.stored ?? job.stats?.validRecords ?? null;
          setRepository((previous) => ({
            ...previous,
            status: "ready",
            progress: job.message || "Indexing complete",
            stored,
          }));
          completed = true;
          break;
        }
        if (job.status === "failed") {
          throw new Error(
            [job.error, job.message, job.hint].filter(Boolean).join(" "),
          );
        }
        setRepository((previous) => ({
          ...previous,
          status: "processing",
          progress: job.progress || "Indexing repository…",
          stored: typeof job.stored === "number" ? job.stored : previous.stored,
        }));
      }
      if (!completed) {
        throw new Error(
          "Indexing status could not be confirmed before the wait limit. Check the server and try again.",
        );
      }
    } catch (error) {
      const message = getErrorMessage(error, "Could not index this repository.");
      setRepository((previous) =>
        previous
          ? { ...previous, status: "failed", progress: message }
          : previous,
      );
      setRepoError(message);
    } finally {
      setIsIngesting(false);
    }
  };

  const retryRepositoryIngestion = () => {
    if (!repository || isIngesting) return;
    setRepoInput(repository.url);
    connectRepository(null, repository);
  };

  const sendMessage = async (text = question, retryId = null) => {
    const prompt = text.trim();
    if (!prompt || loadingChatId) return;
    if (!repository || repository.status !== "ready" || chatContextMismatch) {
      return;
    }

    const chatId = currentChat?.id || activeChatId;
    if (!chatId) return;
    const userMessage = { id: createId(), type: "user", text: prompt };
    if (retryId) {
      updateChatMessages(chatId, (previous) =>
        previous.filter((message) => message.id !== retryId),
      );
    } else {
      const title =
        currentChat.messages.length === 0
          ? `${prompt.slice(0, 34)}${prompt.length > 34 ? "…" : ""}`
          : currentChat.title;
      setChats((previous) =>
        previous.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                title,
                repoUrl: repository.url,
                messages: [...chat.messages, userMessage],
              }
            : chat,
        ),
      );
      setQuestion("");
    }

    setLoadingChatId(chatId);
    try {
      const response = await axios.post(`${API_BASE}/query`, {
        question: prompt,
        repo: repository.url,
      });
      if (typeof response.data?.answer !== "string") {
        throw new Error("The server returned a response without an answer.");
      }

      const assistantMessage = {
        id: createId(),
        type: "bot",
        text: response.data.answer,
        sources: Array.isArray(response.data.sources)
          ? response.data.sources
          : [],
        usedWeb: Boolean(response.data.usedWeb),
        metrics: response.data.metrics || null,
      };
      updateChatMessages(chatId, (previous) => [
        ...previous,
        assistantMessage,
      ]);
      setSelectedSource(
        assistantMessage.sources.length
          ? { messageId: assistantMessage.id, sources: assistantMessage.sources }
          : null,
      );
    } catch (error) {
      updateChatMessages(chatId, (previous) => [
        ...previous,
        {
          id: createId(),
          type: "error",
          text: getErrorMessage(error, "Could not get an answer. Try again."),
          retryQuestion: prompt,
        },
      ]);
    } finally {
      setLoadingChatId(null);
    }
  };

  const copyText = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyError("");
      setCopied(id);
      window.setTimeout(
        () => setCopied((previous) => (previous === id ? "" : previous)),
        1800,
      );
    } catch (error) {
      console.error("Could not copy text:", error);
      setCopyError("Clipboard access is unavailable in this browser.");
    }
  };

  const renderMarkdown = (text, messageId) => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code({ className, children }) {
          const language = /language-([\w-]+)/.exec(className || "")?.[1];
          const code = String(children).replace(/\n$/, "");
          const isBlock = Boolean(language) || code.includes("\n");
          if (!isBlock) return <code className="inline-code">{children}</code>;
          const copyId = `${messageId}-${code.length}`;
          return (
            <div className="code-block">
              <div className="code-block-header">
                <span>{language || "text"}</span>
                <button
                  className="code-copy-button"
                  type="button"
                  onClick={() => copyText(code, copyId)}
                  aria-label="Copy code"
                >
                  <Icon name={copied === copyId ? "check" : "copy"} size={14} />
                  {copied === copyId ? "Copied" : "Copy"}
                </button>
              </div>
              {language ? (
                <SyntaxHighlighter
                  language={language}
                  style={oneDark}
                  customStyle={{
                    margin: 0,
                    padding: "16px",
                    background: "transparent",
                    fontSize: "13px",
                  }}
                  wrapLongLines
                >
                  {code}
                </SyntaxHighlighter>
              ) : (
                <pre className="plain-code"><code>{code}</code></pre>
              )}
            </div>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );

  const repositoryForm = (compact = false) => (
    <form
      className={`repo-form${compact ? " repo-form-compact" : ""}`}
      onSubmit={connectRepository}
    >
      <label className="sr-only" htmlFor={compact ? "repo-url-sidebar" : "repo-url"}>
        GitHub repository URL
      </label>
      <div className="repo-input-wrap">
        <Icon name="github" size={18} />
        <input
          id={compact ? "repo-url-sidebar" : "repo-url"}
          value={repoInput}
          onChange={(event) => setRepoInput(event.target.value)}
          placeholder="github.com/owner/repository"
          autoComplete="url"
          disabled={isIngesting}
        />
      </div>
      <button className="button button-primary connect-button" disabled={isIngesting}>
        {isIngesting ? (
          <>
            <span className="spinner" aria-hidden="true" />
            Indexing
          </>
        ) : repository?.status === "ready" ? (
          "Re-index"
        ) : (
          "Connect"
        )}
      </button>
    </form>
  );

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          aria-label="Close navigation"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar${sidebarOpen ? " sidebar-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}>
          <span className="brand-mark"><Icon name="code" size={19} /></span>
          <span>DevAssist<span className="brand-light"> AI</span></span>
        </a>

        <button className="button new-chat-button" onClick={createNewChat}>
          <Icon name="add" size={17} />
          New chat
          <span className="shortcut">⌘ K</span>
        </button>

        <section className="sidebar-section repository-section">
          <div className="section-label">REPOSITORY</div>
          {repository ? (
            <div className={`repo-card repo-${repository.status}`}>
              <div className="repo-card-heading">
                <span className="status-dot" />
                <span className="repo-status-label">
                  {repository.status === "ready"
                    ? "Indexed"
                    : repository.status === "processing"
                      ? "Indexing"
                      : "Indexing failed"}
                </span>
              </div>
              <div className="repo-name">{repository.owner}/{repository.name}</div>
              {repository.status === "processing" && (
                <div className="repo-progress">
                  <span className="spinner" aria-hidden="true" />
                  <span>{repository.progress}</span>
                </div>
              )}
              {repository.status === "ready" && (
                <div className="repo-progress repo-count">
                  <Icon name="check" size={14} />
                  {typeof repository.stored === "number"
                    ? `${repository.stored.toLocaleString()} chunks indexed`
                    : "Indexing completed"}
                </div>
              )}
              {repository.status === "failed" && (
                <div className="repo-failure">
                  <p>{repository.progress}</p>
                  <button
                    className="retry-button"
                    type="button"
                    onClick={retryRepositoryIngestion}
                    disabled={isIngesting}
                  >
                    <Icon name="retry" size={14} />
                    Retry indexing
                  </button>
                </div>
              )}
              <a
                className="repo-link"
                href={repository.url}
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub <Icon name="external" size={13} />
              </a>
            </div>
          ) : (
            <>
              <p className="sidebar-help">
                Connect a public GitHub repository to start asking questions.
              </p>
              {repositoryForm(true)}
            </>
          )}
          {repoError && repository && repository.status !== "failed" && (
            <p className="inline-error" role="alert">{repoError}</p>
          )}
          {!repository && (
            <p className="api-note">
              Index status is available from the active job only; it is not saved by the API.
            </p>
          )}
        </section>

        <section className="sidebar-section history-section">
          <div className="section-label">RECENT CHATS</div>
          <div className="chat-history">
            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`history-row${chat.id === activeChatId ? " history-row-active" : ""}`}
              >
                <button
                  className="history-select"
                  onClick={() => {
                    setActiveChatId(chat.id);
                    setSelectedSource(null);
                    setSidebarOpen(false);
                  }}
                  title={chat.title}
                >
                  <Icon name="message" size={16} />
                  <span>{chat.title || "New chat"}</span>
                </button>
                <button
                  className="icon-button delete-chat"
                  aria-label={`Delete ${chat.title || "chat"}`}
                  onClick={(event) => deleteChat(event, chat.id)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="sidebar-footer">
          <span className="avatar">DA</span>
          <div>
            <strong>Developer workspace</strong>
            <span>Chats saved in this browser</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <Icon name="chevron" size={15} />
            <strong>{repository ? repository.name : "New conversation"}</strong>
          </div>
          <div className="topbar-actions">
            {repository?.status === "ready" ? (
              <span className="top-status"><span className="status-dot" /> Repository ready</span>
            ) : (
              <span className="top-status top-status-muted"></span>
            )}
            <button
              className="icon-button evidence-toggle"
              aria-label={sourcePanelOpen ? "Close source panel" : "Open source panel"}
              onClick={() => setSourcePanelOpen((open) => !open)}
            >
              <Icon name="file" size={17} />
              <span>Sources</span>
            </button>
          </div>
        </header>

        <div className="workspace-body">
          <section className="conversation">
            {messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-eyebrow">
                  <span className="eyebrow-line" />
                  YOUR CODEBASE, IN CONTEXT
                </div>
                <div className="welcome-icon"><Icon name="sparkles" size={23} /></div>
                <h1>Understand your codebase.<br /><span>Just ask.</span></h1>
                <p className="welcome-description">
                  Connect a GitHub repository and explore its architecture, trace
                  code paths, and get answers grounded in the files that matter.
                </p>

                {!repository && (
                  <div className="connect-card">
                    <div className="connect-card-heading">
                      <span className="connect-github"><Icon name="github" size={19} /></span>
                      <div>
                        <strong>Connect a repository</strong>
                        <span>Public GitHub repositories are supported</span>
                      </div>
                    </div>
                    {repositoryForm()}
                    {repoError && !sidebarOpen && !repository && (
                      <p className="inline-error" role="alert">{repoError}</p>
                    )}
                  </div>
                )}

                {repository?.status === "processing" && (
                  <div className="welcome-status" role="status">
                    <span className="spinner" />
                    <span>{repository.progress}</span>
                    {typeof repository.stored === "number" && repository.stored > 0 && (
                      <span className="stored-count">
                        {repository.stored.toLocaleString()} chunks stored
                      </span>
                    )}
                  </div>
                )}
                {repository?.status === "failed" && (
                  <div className="welcome-error" role="alert">
                    <strong>Repository indexing failed</strong>
                    <span>{repository.progress}</span>
                    <button
                      className="button retry-ingestion-button"
                      type="button"
                      onClick={retryRepositoryIngestion}
                      disabled={isIngesting}
                    >
                      <Icon name="retry" size={15} />
                      Retry indexing
                    </button>
                  </div>
                )}
                {repository?.status === "ready" && (
                  <div className="ready-banner" role="status">
                    <span className="status-dot" />
                    <span><strong>{repository.owner}/{repository.name}</strong> is ready to explore</span>
                    {typeof repository.stored === "number" && (
                      <span className="stored-count">{repository.stored.toLocaleString()} chunks indexed</span>
                    )}
                  </div>
                )}

                <div className="suggestion-heading">TRY ASKING</div>
                <div className="suggestion-grid">
                  {SUGGESTED_QUESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      className="suggestion-card"
                      disabled={repository?.status !== "ready"}
                      onClick={() => {
                        setQuestion(suggestion);
                        questionRef.current?.focus();
                      }}
                    >
                      <span>{suggestion}</span>
                      <Icon name="arrow" size={15} />
                    </button>
                  ))}
                </div>
                {repository?.status !== "ready" && (
                  <p className="suggestion-note">
                    Connect and index a repository to enable codebase questions.
                  </p>
                )}
              </div>
            ) : (
              <div className="message-list" aria-live="polite">
                {messages.map((message) => (
                  <article
                    className={`message-row message-${message.type}`}
                    key={message.id || `${message.type}-${message.text}`}
                  >
                    <div className={`message-avatar avatar-${message.type}`}>
                      {message.type === "user" ? "You" : <Icon name="sparkles" size={17} />}
                    </div>
                    <div className="message-content">
                      <div className="message-heading">
                        <strong>{message.type === "user" ? "You" : "DevAssist"}</strong>
                        {message.type === "bot" && (
                          <span className="grounded-label">AI assistant</span>
                        )}
                      </div>
                      {message.type === "error" ? (
                        <div className="message-error" role="alert">
                          <p>{message.text}</p>
                          <button
                            className="retry-button"
                            onClick={() => sendMessage(message.retryQuestion, message.id)}
                          >
                            <Icon name="retry" size={15} /> Retry
                          </button>
                        </div>
                      ) : (
                        <div className="markdown-body">
                          {renderMarkdown(message.text, message.id)}
                        </div>
                      )}
                      {message.type === "bot" && (
                        <>
                          {message.usedWeb && (
                            <div className="external-context-note">
                              <Icon name="external" size={14} />
                              External web search was used alongside repository context.
                            </div>
                          )}
                          {message.sources?.length > 0 && (
                            <div className="message-sources">
                              <div className="message-sources-heading">
                                <span>Sources returned by the API</span>
                                {message.usedWeb && <span className="web-badge">Web search used</span>}
                              </div>
                              <div className="source-chips">
                                {message.sources.slice(0, 4).map((source, index) => (
                                  <button
                                    className="source-chip"
                                    key={`${source.url}-${index}`}
                                    onClick={() => {
                                      setSelectedSource({
                                        messageId: message.id,
                                        sources: message.sources,
                                        activeUrl: source.url,
                                      });
                                      setSourcePanelOpen(true);
                                    }}
                                  >
                                    <Icon name="file" size={14} />
                                    <span>{source.name || source.url}</span>
                                    <Icon name="external" size={12} />
                                  </button>
                                ))}
                                {message.sources.length > 4 && (
                                  <button
                                    className="more-sources"
                                    onClick={() => {
                                      setSelectedSource({
                                        messageId: message.id,
                                        sources: message.sources,
                                      });
                                      setSourcePanelOpen(true);
                                    }}
                                  >
                                    +{message.sources.length - 4} more
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                          <div className="message-actions">
                            <button
                              className="icon-button"
                              onClick={() => copyText(message.text, message.id)}
                            >
                              <Icon name={copied === message.id ? "check" : "copy"} size={14} />
                              {copied === message.id ? "Copied" : "Copy answer"}
                            </button>
                            {copyError && (
                              <span className="copy-error" role="status">{copyError}</span>
                            )}
                            {message.metrics?.queryTime && (
                              <span className="response-metric">
                                {message.metrics.queryTime}
                                {message.metrics.resultCount != null &&
                                  ` · ${message.metrics.resultCount} matches`}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                ))}
                {loadingChatId === activeChatId && (
                  <div className="message-row message-bot" role="status">
                    <div className="message-avatar avatar-bot"><Icon name="sparkles" size={17} /></div>
                    <div className="message-content">
                      <div className="message-heading"><strong>DevAssist</strong></div>
                      <div className="thinking"><span /><span /><span /> Searching your repository</div>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
            )}

            {chatContextMismatch && (
              <div className="chat-context-notice" role="status">
                <Icon name="file" size={16} />
                <span>
                  {!currentChat?.repoUrl
                    ? "This saved chat has no repository association. Start a new chat to keep answers grounded in the right codebase."
                    : !repository
                      ? `Reconnect ${parseGitHubRepo(currentChat.repoUrl)?.name || "this chat's repository"} to continue this conversation.`
                      : `This chat belongs to ${parseGitHubRepo(currentChat.repoUrl)?.owner}/${parseGitHubRepo(currentChat.repoUrl)?.name}. Reconnect that repository or start a new chat.`}
                </span>
                <button className="button context-new-chat" onClick={createNewChat}>
                  New chat
                </button>
              </div>
            )}

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                sendMessage();
              }}
            >
              <textarea
                ref={questionRef}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder={
                  repository?.status === "ready"
                    ? `Ask anything about ${repository.name}…`
                    : "Connect and index a repository to start asking"
                }
                aria-label="Ask a question about the repository"
                disabled={
                  repository?.status !== "ready" ||
                  loadingChatId !== null ||
                  chatContextMismatch
                }
                rows={1}
              />
              <div className="composer-footer">
                <span><kbd>Enter</kbd> to send <span className="composer-separator">·</span> <kbd>Shift + Enter</kbd> for a new line</span>
                <button
                  className="button button-send"
                  type="submit"
                  disabled={
                    !question.trim() ||
                    repository?.status !== "ready" ||
                    loadingChatId !== null ||
                    chatContextMismatch
                  }
                  aria-label="Send question"
                >
                  <span>Ask DevAssist</span>
                  <Icon name="send" size={15} />
                </button>
              </div>
            </form>
            <p className="privacy-caption">Answers are generated from retrieved repository context. Always verify important changes.</p>
          </section>

          <aside className={`source-panel${sourcePanelOpen ? " source-panel-open" : ""}`}>
            <div className="source-panel-header">
              <div>
                <span className="section-label">REFERENCE</span>
                <h2>Sources</h2>
              </div>
              <button
                className="icon-button source-close"
                aria-label="Close source panel"
                onClick={() => setSourcePanelOpen(false)}
              >
                <Icon name="close" size={17} />
              </button>
            </div>
            {displayedSources.length ? (
              <>
                <p className="source-panel-intro">
                  References returned with the latest answer. Open a file on GitHub to inspect its contents.
                </p>
                <div className="source-list">
                  {displayedSources.map((source, index) => (
                    <a
                      className={`source-reference${selectedSource?.activeUrl === source.url ? " source-reference-active" : ""}`}
                      href={source.url}
                      key={`${source.url}-${index}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="source-file-icon"><Icon name="file" size={16} /></span>
                      <span className="source-reference-copy">
                        <strong>{source.name || "Source"}</strong>
                        <span>{source.url}</span>
                      </span>
                      <Icon name="external" size={14} />
                    </a>
                  ))}
                </div>
                <div className="source-limit-note">
                  The API returns source names and links only. It does not currently return code snippets or line numbers.
                </div>
              </>
            ) : (
              <div className="source-empty">
                <span className="source-empty-icon"><Icon name="file" size={20} /></span>
                <strong>No references yet</strong>
                <p>Source links from an answer will appear here after you ask a question.</p>
              </div>
            )}
          </aside>
        </div>
      </main>
      {sourcePanelOpen && (
        <button
          aria-label="Close source panel"
          className="source-backdrop"
          onClick={() => setSourcePanelOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
