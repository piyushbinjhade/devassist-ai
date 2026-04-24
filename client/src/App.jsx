import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);

    setTimeout(() => {
      setCopied(false);
    }, 1500);
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={handleCopy}
        style={{
          position: "absolute",
          right: "10px",
          top: "10px",
          fontSize: "12px",
          background: copied ? "#16a34a" : "#27272a",
          border: "none",
          padding: "4px 8px",
          borderRadius: "6px",
          cursor: "pointer",
          color: "white",
          transition: "0.2s",
        }}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>

      <SyntaxHighlighter
        language={language}
        style={vscDarkPlus}
        customStyle={{
          borderRadius: "10px",
          fontSize: "13px",
          paddingTop: "30px",
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function App() {
  const [chats, setChats] = useState(() => {
    try {
      const saved = localStorage.getItem("devassist_chats");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {
      console.error("Failed parsing chats", e);
    }
    return [{ id: Date.now().toString(), title: "New Chat", messages: [] }];
  });

  const [activeChatId, setActiveChatId] = useState(() => chats[0]?.id);

  const [question, setQuestion] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [loadingMap, setLoadingMap] = useState({});
  const [ingestingMap, setIngestingMap] = useState({});
  const [ingestStatusMap, setIngestStatusMap] = useState({});

  const loading = loadingMap[activeChatId] || false;
  const ingesting = ingestingMap[activeChatId] || false;
  const ingestStatusMsg = ingestStatusMap[activeChatId] || "";

  const setLoading = (val, id = activeChatId) => setLoadingMap(prev => ({ ...prev, [id]: val }));
  const setIngesting = (val, id = activeChatId) => setIngestingMap(prev => ({ ...prev, [id]: val }));
  const setIngestStatusMsg = (val, id = activeChatId) => setIngestStatusMap(prev => ({ ...prev, [id]: val }));
  const chatEndRef = useRef(null);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem("devassist_chats", JSON.stringify(chats));
  }, [chats]);

  const currentChat = chats.find(c => c.id === activeChatId) || chats[0];
  const messages = currentChat?.messages || [];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const createNewChat = () => {
    const newChat = { id: Date.now().toString(), title: "New Chat", messages: [] };
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
  };

  const deleteChat = (id, e) => {
    e.stopPropagation();
    const newChats = chats.filter(c => c.id !== id);
    if (newChats.length === 0) {
      const fallback = { id: Date.now().toString(), title: "New Chat", messages: [] };
      setChats([fallback]);
      setActiveChatId(fallback.id);
    } else {
      setChats(newChats);
      if (activeChatId === id) {
        setActiveChatId(newChats[0].id);
      }
    }
  };

  function renderMessage(text) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          code({ inline, className, children }) {
            const match = /language-(\w+)/.exec(className || "");
            const code = String(children).replace(/\n$/, "").trim();

            return !inline ? (
              <CodeBlock code={code} language={match?.[1] || "javascript"} />
            ) : (
              <code
                style={{
                  background: "#27272a",
                  padding: "2px 6px",
                  borderRadius: "6px",
                }}
              >
                {children}
              </code>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    );
  }

  const sendMessage = async () => {
    if (!question.trim()) return;

    const chatIdForReq = activeChatId;
    setLoading(true, chatIdForReq);

    const userMsg = { type: "user", text: question };
    
    let updatedTitle = currentChat.title;
    if (currentChat.messages.length === 0) {
      updatedTitle = question.slice(0, 25) + (question.length > 25 ? "..." : "");
    }

    setChats((prev) => prev.map(c => 
      c.id === chatIdForReq 
        ? { ...c, title: updatedTitle, messages: [...c.messages, userMsg] } 
        : c
    ));

    const currentQuestion = question;
    setQuestion("");

    try {
      const res = await axios.post(`${API_BASE}/query`, {
        question: currentQuestion,
      });

      const botMsg = {
        type: "bot",
        text: res.data.answer,
        sources: res.data.sources || [],
        usedWeb: res.data.usedWeb || false,
      };

      setChats((prev) => prev.map(c => 
        c.id === chatIdForReq 
          ? { ...c, messages: [...c.messages, botMsg] } 
          : c
      ));
    } catch (err) {
      alert(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Error sending your question. Please try again.",
      );
    } finally {
      setLoading(false, chatIdForReq);
    }
  };

  const ingestRepo = async () => {
    if (!repoUrl.trim()) return;

    const chatIdForReq = activeChatId;
    setIngesting(true, chatIdForReq);
    setIngestStatusMsg("Starting ingestion...", chatIdForReq);

    try {
      const res = await axios.post(`${API_BASE}/ingest/github`, {
        repoUrl,
      });

      const jobId = res.data.jobId;
      if (!jobId) {
        console.log("Repo ingested successfully!");
        setIngesting(false, chatIdForReq);
        setIngestStatusMsg("", chatIdForReq);
        return;
      }

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await axios.get(`${API_BASE}/ingest/status/${jobId}`);
          const job = statusRes.data;

          if (job.status === "processing") {
            setIngestStatusMsg(job.progress || "Processing...", chatIdForReq);
          } else if (job.status === "completed") {
            clearInterval(pollInterval);
            setIngesting(false, chatIdForReq);
            setIngestStatusMsg("Repo ingested successfully!", chatIdForReq);
            console.log(`Repo ingested successfully!`);
          } else if (job.status === "failed") {
            clearInterval(pollInterval);
            setIngesting(false, chatIdForReq);
            setIngestStatusMsg("", chatIdForReq);
            alert(`Error: ${job.error || "Failed to ingest"}\n${job.message || ""}`);
          }
        } catch (pollErr) {
          clearInterval(pollInterval);
          setIngesting(false, chatIdForReq);
          setIngestStatusMsg("", chatIdForReq);
          alert("Error checking ingestion status");
        }
      }, 2000);

    } catch (err) {
      setIngesting(false, chatIdForReq);
      setIngestStatusMsg("", chatIdForReq);
      alert(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          "Error ingesting repo",
      );
    }
  };

  return (
    <div style={styles.appWrapper}>
      {/* Sidebar */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarHeader}>DevAssist AI</div>
        <button style={styles.newChatBtn} onClick={createNewChat}>+ New Chat</button>
        <div style={styles.chatList}>
          {chats.map(chat => (
            <div 
              key={chat.id} 
              style={{
                ...styles.chatListItem,
                backgroundColor: chat.id === activeChatId ? "#27272a" : "transparent"
              }}
              onClick={() => setActiveChatId(chat.id)}
            >
              <div style={styles.chatListTitle}>{chat.title}</div>
              <button 
                style={styles.deleteBtn} 
                onClick={(e) => deleteChat(chat.id, e)}
                title="Delete Chat"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Area */}
      <div style={styles.mainArea}>
        {/* Top bar logic */}
        <div style={styles.topArea}>
          <div style={styles.repoBox}>
            <input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="Paste GitHub repo URL..."
              style={styles.repoInput}
              disabled={ingesting}
            />
            <button style={styles.button} onClick={ingestRepo} disabled={ingesting}>
              {ingesting ? "Loading..." : "Ingest"}
            </button>
          </div>
          {ingestStatusMsg && (
            <div style={{ 
              fontSize: "13px", 
              fontWeight: ingestStatusMsg.includes("successfully") ? "600" : "normal",
              color: ingestStatusMsg.includes("successfully") ? "#4ade80" : ingestStatusMsg.includes("Error") ? "#f87171" : "#a1a1aa", 
              marginTop: "-8px", 
              marginLeft: "4px" 
            }}>
              {ingestStatusMsg.includes("successfully") && "✅ "}
              {ingestStatusMsg.includes("Error") && "❌ "}
              {ingestStatusMsg}
            </div>
          )}
        </div>

        {/* Chat container */}
        <div style={styles.chat}>
          {messages.map((msg, i) => (
            <div
              key={i}
              style={{
                ...styles.message,
                alignSelf: msg.type === "user" ? "flex-end" : "flex-start",
                background: msg.type === "user" ? "#2563eb" : "#18181b",
              }}
            >
              <div>{renderMessage(msg.text)}</div>

              {msg.usedWeb && (
                <div
                  style={{
                    fontSize: "11px",
                    color: "#60a5fa",
                    marginBottom: "6px",
                  }}
                >
                  🌐 Web Search Used
                </div>
              )}

              {msg.sources && msg.sources.length > 0 && (
                <div style={styles.sources}>
                  <strong>Sources:</strong>
                  {msg.sources.map((src, idx) => (
                    <div key={idx} style={styles.sourceItem}>
                      •{" "}
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        {src.name}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div style={styles.loading}>
              Thinking<span className="dots">...</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={styles.inputArea}>
          <input
            disabled={loading}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Ask a question..."
            style={styles.chatInput}
          />
          <button
            onClick={sendMessage}
            style={styles.button}
            disabled={loading}
            onMouseOver={(e) => (e.target.style.opacity = 0.85)}
            onMouseOut={(e) => (e.target.style.opacity = 1)}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  appWrapper: {
    display: "flex",
    height: "100vh",
    width: "100vw",
    fontFamily: "Inter, sans-serif",
    color: "white",
    background: "#000",
    overflow: "hidden"
  },

  sidebar: {
    width: "260px",
    background: "#09090b",
    borderRight: "1px solid #27272a",
    display: "flex",
    flexDirection: "column",
    padding: "16px",
  },

  sidebarHeader: {
    fontSize: "18px",
    fontWeight: "700",
    marginBottom: "20px",
    color: "#e4e4e7"
  },

  newChatBtn: {
    width: "100%",
    padding: "10px",
    background: "#18181b",
    border: "1px solid #27272a",
    borderRadius: "8px",
    color: "#e4e4e7",
    cursor: "pointer",
    fontWeight: "500",
    marginBottom: "20px",
    transition: "0.2s"
  },

  chatList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "8px"
  },

  chatListItem: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px",
    borderRadius: "8px",
    cursor: "pointer",
    color: "#a1a1aa",
    transition: "0.2s"
  },

  chatListTitle: {
    fontSize: "13px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    flex: 1
  },

  deleteBtn: {
    background: "transparent",
    border: "none",
    color: "#71717a",
    cursor: "pointer",
    fontSize: "14px",
    padding: "4px",
    marginLeft: "8px",
  },

  mainArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: "20px 40px",
    maxWidth: "900px",
    margin: "0 auto",
    height: "100vh",
    boxSizing: "border-box"
  },

  topArea: {
    marginBottom: "16px",
  },

  repoBox: {
    display: "flex",
    gap: "10px",
    marginBottom: "12px",
  },

  repoInput: {
    flex: 1,
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid #27272a",
    background: "#18181b",
    color: "white",
    outline: "none",
  },

  chat: {
    flex: 1,
    background: "#09090b",
    borderRadius: "12px",
    padding: "20px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    border: "1px solid #27272a",
    marginBottom: "16px"
  },

  message: {
    padding: "14px 18px",
    borderRadius: "14px",
    maxWidth: "80%",
    fontSize: "15px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    lineHeight: "1.5"
  },

  inputArea: {
    display: "flex",
    gap: "10px",
    paddingBottom: "20px"
  },

  chatInput: {
    flex: 1,
    padding: "16px",
    borderRadius: "10px",
    border: "1px solid #27272a",
    background: "#18181b",
    color: "white",
    outline: "none",
    fontSize: "15px"
  },

  button: {
    padding: "12px 20px",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    background: "#2563eb",
    color: "white",
    fontWeight: "500",
    transition: "0.2s",
  },

  sources: {
    marginTop: "10px",
    fontSize: "12px",
    color: "#a1a1aa",
  },

  sourceItem: {
    marginLeft: "8px",
    marginTop: "4px"
  },

  link: {
    color: "#60a5fa",
    textDecoration: "none",
  },

  loading: {
    fontSize: "14px",
    color: "#71717a",
    fontStyle: "italic",
    padding: "10px"
  },
};

export default App;
