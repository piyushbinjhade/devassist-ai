import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
      {/* Dynamic Button */}
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
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function renderMessage(text) {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children }) {
            const match = /language-(\w+)/.exec(className || "");
            const code = String(children).replace(/\n$/, "");

            // local state inside component
            const [copied, setCopied] = useState(false);

            const handleCopy = () => {
              navigator.clipboard.writeText(code);
              setCopied(true);

              setTimeout(() => {
                setCopied(false);
              }, 1500);
            };

            return !inline ? (
              <div style={{ position: "relative" }}>
                {/* dynamic button */}
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
                  language={match?.[1] || "javascript"}
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

    setLoading(true);

    const userMsg = { type: "user", text: question };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await axios.post("http://localhost:3000/query", {
        question,
      });

      const botMsg = {
        type: "bot",
        text: res.data.answer,
        sources: res.data.sources || [],
        usedWeb: res.data.usedWeb || false,
      };

      setMessages((prev) => [...prev, botMsg]);
      setQuestion("");
    } catch (err) {
    } finally {
      setLoading(false);
    }
  };

  const ingestRepo = async () => {
    if (!repoUrl.trim()) return;

    setIngesting(true);

    try {
      await axios.post("http://localhost:3000/ingest/github", {
        repoUrl,
      });

      alert("Repo ingested successfully!");
    } catch (err) {
      alert("Error ingesting repo");
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>DevAssist AI</div>

      {/* Repo input (card style) */}
      <div style={styles.repoBox}>
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="Paste GitHub repo URL..."
          style={styles.input}
          disabled={ingesting}
        />
        <button style={styles.button} onClick={ingestRepo} disabled={ingesting}>
          {ingesting ? "Loading..." : "Ingest"}
        </button>
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
            Thinking<span className="dots">...</span> {/* ✨ NEW */}
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
          placeholder="Ask about your repo..."
          style={styles.input}
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
  );
}

const styles = {
  container: {
    width: "600px",
    margin: "20px auto",
    fontFamily: "Inter, sans-serif",
    color: "white",
  },

  header: {
    fontSize: "20px",
    fontWeight: "600",
    marginBottom: "12px",
    borderBottom: "1px solid #27272a",
    paddingBottom: "10px",
  },

  chat: {
    height: "420px",
    background: "#09090b",
    borderRadius: "12px",
    padding: "15px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    border: "1px solid #27272a",
  },

  message: {
    padding: "12px 16px",
    borderRadius: "14px",
    maxWidth: "75%",
    fontSize: "14px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  },

  inputArea: {
    display: "flex",
    marginTop: "12px",
    gap: "10px",
  },

  input: {
    flex: 1,
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid #27272a",
    background: "#18181b",
    color: "white",
    outline: "none",
  },

  button: {
    padding: "12px 16px",
    borderRadius: "10px",
    border: "none",
    cursor: "pointer",
    background: "#2563eb",
    color: "white",
    transition: "0.2s",
  },

  sources: {
    marginTop: "8px",
    fontSize: "12px",
    color: "#a1a1aa",
  },

  sourceItem: {
    marginLeft: "8px",
  },

  link: {
    color: "#60a5fa",
    textDecoration: "none",
  },

  repoBox: {
    display: "flex",
    gap: "10px",
    marginBottom: "12px",
  },

  loading: {
    fontSize: "13px",
    color: "#71717a",
    fontStyle: "italic",
  },
};

export default App;
