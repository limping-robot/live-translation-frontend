import React, { useEffect, useRef, useState } from "react";

function makeUttId() {
  // Safari support: fallback if crypto.randomUUID isn't there
  if (crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [isPressing, setIsPressing] = useState(false);
  const [lines, setLines] = useState([]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(null);
  const [authError, setAuthError] = useState(null);

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const nodeRef = useRef(null);
  const isPressingRef = useRef(false);
  const allowNextUtteranceRef = useRef(false);

  const proto = window.location.protocol === "https:" ? "wss" : "ws";

  function buildWsUrl(jwtToken) {
    const base = `${proto}://${window.location.host}/ws`;
    return `${base}?token=${encodeURIComponent(jwtToken)}`;
  }

  // Load token from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("access_token");
    if (saved) {
      setToken(saved);
    }
  }, []);

  // Open WebSocket connection when token is available
  useEffect(() => {
    if (token) {
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        initializeWebSocket();
      }
    } else {
      // Cleanup on token removal
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
        setConnected(false);
      }
    }
  }, [token]);

  // Request microphone access after WebSocket is connected
  useEffect(() => {
    if (connected && token && !running) {
      initializeAudio().catch((err) => {
        console.error("Failed to initialize audio:", err);
        setAuthError("Failed to access microphone. Please check permissions.");
      });
    }
  }, [connected, token]);

  async function handleLogin(e) {
    e.preventDefault();
    setAuthError(null);

    try {
      const res = await fetch("/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAuthError(data.error || "Login failed");
        return;
      }

      const data = await res.json();
      if (data.access_token) {
        setToken(data.access_token);
        localStorage.setItem("access_token", data.access_token);
        setAuthError(null);
      } else {
        setAuthError("No token returned from server");
      }
    } catch (err) {
      console.error("Login error:", err);
      setAuthError("Network or server error");
    }
  }

  function handleLogout() {
    cleanup();
    setToken(null);
    localStorage.removeItem("access_token");
    setConnected(false);
  }

  async function initializeWebSocket() {
    if (!token) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const wsUrl = buildWsUrl(token);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setRunning(false);
    };
    ws.onerror = () => {
      setConnected(false);
      setRunning(false);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (msg.type === "error" && msg.message === "unauthorized") {
        setAuthError("Unauthorized WebSocket connection. Please log in again.");
        handleLogout();
        return;
      }

      if (msg.type === "result") {
        setLines((prev) => [
          { uttId: msg.uttId, en: msg.en, tl: msg.tl },
          ...prev,
        ]);
      }
    };

    wsRef.current = ws;
  }

  async function initializeAudio() {
    if (running) return; // Already initialized
    if (!token) {
      setAuthError("Please log in first.");
      return;
    }

    // Ensure WebSocket is connected
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      await initializeWebSocket();
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    await ctx.audioWorklet.addModule("/vad-processor.js");

    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "vad-processor");
    nodeRef.current = node;

    node.port.onmessage = (ev) => {
      const { type, pcm, sampleRate } = ev.data;
      if (type !== "utterance") return;
      
      // Only send utterances if button is currently pressed OR if we're allowing
      // the next utterance (from a force-end)
      if (!isPressingRef.current && !allowNextUtteranceRef.current) return;
      
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

      const uttId = makeUttId();

      // JSON header, binary PCM, JSON footer
      wsRef.current.send(JSON.stringify({ type: "utt_start", uttId, sampleRate }));
      wsRef.current.send(pcm); // ArrayBuffer with PCM16 mono
      wsRef.current.send(JSON.stringify({ type: "utt_end", uttId }));
      
      // Clear the allow flag after sending
      allowNextUtteranceRef.current = false;
    };

    // keep node alive without audible output
    const gain = ctx.createGain();
    gain.gain.value = 0.0;

    src.connect(node).connect(gain).connect(ctx.destination);

    setRunning(true);
  }

  async function cleanup() {
    setRunning(false);
    setIsPressing(false);
    isPressingRef.current = false;
    allowNextUtteranceRef.current = false;

    wsRef.current?.close();
    wsRef.current = null;

    if (ctxRef.current) {
      await ctxRef.current.close();
      ctxRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    nodeRef.current = null;
  }

  async function handlePushStart() {
    if (!token) {
      setAuthError("Please log in first.");
      return;
    }
    
    // Audio should already be initialized after login, but check just in case
    if (!running) {
      await initializeAudio();
    }
    
    isPressingRef.current = true;
    allowNextUtteranceRef.current = false; // Reset flag when starting new press
    setIsPressing(true);
  }

  function handlePushEnd() {
    isPressingRef.current = false;
    setIsPressing(false);
    
    // Force-end any current utterance in the VAD processor
    // Allow the next utterance to be sent even though button is released
    if (nodeRef.current) {
      allowNextUtteranceRef.current = true;
      nodeRef.current.port.postMessage({ type: "force_end" });
    }
  }

  return (
      <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            backgroundColor: "#f5f5f5",
          }}
      >
        <div
            style={{
              width: "100%",
              maxWidth: 700,
              backgroundColor: "white",
              borderRadius: 12,
              padding: 32,
              boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 24, textAlign: "center" }}>
            Realtime English to Tagalog
          </h2>

          {/* Auth box */}
          <div
              style={{
                marginBottom: 24,
                padding: 16,
                border: "1px solid #e0e0e0",
                borderRadius: 8,
                backgroundColor: "#fafafa",
              }}
          >
            {token ? (
                <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      justifyContent: "space-between",
                    }}
                >
                  <span style={{ color: "#4caf50", fontWeight: 500 }}>
                    ✓ Logged in
                  </span>
                  <button
                      onClick={handleLogout}
                      style={{
                        padding: "6px 16px",
                        border: "1px solid #ddd",
                        borderRadius: 4,
                        backgroundColor: "white",
                        cursor: "pointer",
                        fontSize: 14,
                      }}
                  >
                    Log out
                  </button>
                </div>
            ) : (
                <form
                    onSubmit={handleLogin}
                    style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
                >
                  <input
                      type="text"
                      placeholder="username"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      style={{
                        padding: "8px 12px",
                        border: "1px solid #ddd",
                        borderRadius: 4,
                        fontSize: 14,
                        flex: 1,
                        minWidth: 120,
                      }}
                  />
                  <input
                      type="password"
                      placeholder="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      style={{
                        padding: "8px 12px",
                        border: "1px solid #ddd",
                        borderRadius: 4,
                        fontSize: 14,
                        flex: 1,
                        minWidth: 120,
                      }}
                  />
                  <button
                      type="submit"
                      style={{
                        padding: "8px 20px",
                        border: "none",
                        borderRadius: 4,
                        backgroundColor: "#2196f3",
                        color: "white",
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: 500,
                      }}
                  >
                    Log in
                  </button>
                </form>
            )}
            {authError && (
                <div style={{ marginTop: 12, color: "#f44336", fontSize: 14 }}>
                  {authError}
                </div>
            )}
          </div>

          {/* Push to Talk Button */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <button
                onMouseDown={handlePushStart}
                onMouseUp={handlePushEnd}
                onMouseLeave={handlePushEnd}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handlePushStart();
                }}
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handlePushEnd();
                }}
                disabled={!token}
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  border: "none",
                  backgroundColor: isPressing ? "#f44336" : (connected ? "#4caf50" : "#9e9e9e"),
                  color: "white",
                  cursor: token ? "pointer" : "not-allowed",
                  boxShadow: isPressing
                      ? "0 4px 20px rgba(244, 67, 54, 0.4)"
                      : "0 2px 8px rgba(0,0,0,0.2)",
                  transition: "all 0.2s ease",
                  transform: isPressing ? "scale(0.95)" : "scale(1)",
                  outline: "none",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                  WebkitTapHighlightColor: "transparent",
                  msUserSelect: "none",
                  touchAction: "manipulation",
                }}
            />
            <div style={{ textAlign: "center" }}>
              <div 
                  style={{ 
                    fontSize: 14, 
                    color: "#666", 
                    marginBottom: 4,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    msUserSelect: "none",
                  }}
              >
                <span style={{ fontSize: 18 }}>
                  {isPressing ? "🎤" : "🎙️"}
                </span>
                <span>{isPressing ? "Listening..." : "Hold to talk"}</span>
              </div>
              <div style={{ fontSize: 12, color: "#999" }}>
                Status: {connected ? "✓ Connected" : "Disconnected"}
              </div>
            </div>
          </div>

          {/* Translation Results */}
          {lines.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h3 style={{ fontSize: 16, marginBottom: 16, color: "#333" }}>
                  Translations
                </h3>
                <div
                    style={{
                      maxHeight: 400,
                      overflowY: "auto",
                      border: "1px solid #e0e0e0",
                      borderRadius: 8,
                      padding: 16,
                      backgroundColor: "#fafafa",
                    }}
                >
                  {lines.map((l) => (
                      <div
                          key={l.uttId}
                          style={{
                            marginBottom: 16,
                            paddingBottom: 16,
                            borderBottom: "1px solid #e0e0e0",
                          }}
                      >
                        <div style={{ marginBottom: 8 }}>
                          <b style={{ color: "#666" }}>EN:</b>{" "}
                          <span style={{ color: "#333" }}>{l.en}</span>
                        </div>
                        <div>
                          <b style={{ color: "#666" }}>TL:</b>{" "}
                          <span style={{ color: "#2196f3", fontWeight: 500 }}>{l.tl}</span>
                        </div>
                      </div>
                  ))}
                </div>
              </div>
          )}
        </div>
      </div>
  );
}
