import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

function App() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const chatEndRef = useRef(null);

  // auto scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // helper function 
  function renderMessage(text) {
    if (!text) return null;

    const parts = text.split("```");

    return parts.map((part, i) => {
      // normal text
      if (i % 2 === 0) {
        return (
          <div key={i} style={{ whiteSpace: "pre-line" }}>
            {part}
          </div>
        );
      }

      // code block
      const lines = part.split("\n");
      const language = lines[0];
      const code = lines.slice(1).join("\n");

      return (
        <SyntaxHighlighter
          key={i}
          language={language || "javascript"}
          style={vscDarkPlus}
          customStyle={{
            borderRadius: "8px",
            fontSize: "13px",
          }}
        >
          {code}
        </SyntaxHighlighter>
      );
    });
  }

  const sendMessage = async () => {
    if (!question.trim()) return;

    setLoading(true);

    const userMsg = { type: "user", text: question };
    setMessages(prev => [...prev, userMsg]);

    try {
      const res = await axios.post("http://localhost:3000/query", {
        question,
      });

      const botMsg = {
        type: "bot",
        text: res.data.answer,
        sources: res.data.sources || [],
      };

      setMessages(prev => [...prev, botMsg]);
      setQuestion("");

    } catch (err) {
      console.error(err);
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
      console.error(err);
      alert("Error ingesting repo");
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div style={styles.container}>
      <h2>DevAssist AI</h2>

      {/* GitHub input */}
      <div style={styles.repoBox}>
        <input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="Enter GitHub repo URL..."
          style={styles.input}
          disabled={ingesting}
        />
        <button onClick={ingestRepo} disabled={ingesting}>
          {ingesting ? "Loading..." : "Ingest"}
        </button>
      </div>

      {/* Chat */}
      <div style={styles.chat}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.message,
              alignSelf: msg.type === "user" ? "flex-end" : "flex-start",
              background: msg.type === "user" ? "#007bff" : "#333",
            }}
          >
            {/* formatted message */}
            <div>{renderMessage(msg.text)}</div>

            {/* sources */}
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
                      style={{ color: "#4da6ff" }}
                    >
                      {src.name}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && <div style={{ color: "#999" }}>Typing...</div>}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div style={styles.inputArea}>
        <input
          disabled={loading}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask something..."
          style={styles.input}
        />
        <button onClick={sendMessage} style={styles.button} disabled={loading}>
          Send
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: "500px",
    margin: "30px auto",
    fontFamily: "Arial",
    color: "white",
  },
  chat: {
    height: "400px",
    background: "#1e1e1e",
    borderRadius: "10px",
    padding: "15px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  message: {
    padding: "10px 14px",
    borderRadius: "12px",
    maxWidth: "75%",
    fontSize: "14px",
  },
  inputArea: {
    display: "flex",
    marginTop: "10px",
    gap: "10px",
  },
  input: {
    flex: 1,
    padding: "10px",
    borderRadius: "8px",
    border: "none",
  },
  button: {
    padding: "10px 14px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    background: "#007bff",
    color: "white",
  },
  sources: {
    marginTop: "6px",
    fontSize: "11px",
    color: "#aaa",
  },
  sourceItem: {
    marginLeft: "8px",
  },
  repoBox: {
    display: "flex",
    gap: "10px",
    marginBottom: "10px",
  },
};

export default App;