import React, { useEffect, useRef, useState } from "react";

function makeUttId() {
  // Safari support: fallback if crypto.randomUUID isn't there
  if (crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState([]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState(null);
  const [authError, setAuthError] = useState(null);

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const streamRef = useRef(null);

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
    setToken(null);
    localStorage.removeItem("access_token");
    setConnected(false);
    if (running) {
      stop();
    }
  }

  async function start() {
    if (running) return;
    if (!token) {
      setAuthError("Please log in first.");
      return;
    }

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

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    await ctx.audioWorklet.addModule("/vad-processor.js");

    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "vad-processor");

    node.port.onmessage = (ev) => {
      const { type, pcm, sampleRate } = ev.data;
      if (type !== "utterance") return;

      const uttId = makeUttId();

      // JSON header, binary PCM, JSON footer
      ws.send(JSON.stringify({ type: "utt_start", uttId, sampleRate }));
      ws.send(pcm); // ArrayBuffer with PCM16 mono
      ws.send(JSON.stringify({ type: "utt_end", uttId }));
    };

    // keep node alive without audible output
    const gain = ctx.createGain();
    gain.gain.value = 0.0;

    src.connect(node).connect(gain).connect(ctx.destination);

    setRunning(true);
  }

  async function stop() {
    setRunning(false);

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
  }

  return (
      <div
          style={{
            padding: 16,
            fontFamily: "system-ui, sans-serif",
            maxWidth: 900,
          }}
      >
        <h2>Realtime EN → TL (utterance-based)</h2>

        {/* Auth box */}
        <div
            style={{
              marginBottom: 16,
              padding: 12,
              border: "1px solid #ddd",
              borderRadius: 8,
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
                <span>Logged in</span>
                <button onClick={handleLogout}>Log out</button>
              </div>
          ) : (
              <form
                  onSubmit={handleLogin}
                  style={{ display: "flex", gap: 8, alignItems: "center" }}
              >
                <input
                    type="text"
                    placeholder="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                />
                <input
                    type="password"
                    placeholder="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
                <button type="submit">Log in</button>
              </form>
          )}
          {authError && (
              <div style={{ marginTop: 8, color: "red", fontSize: 14 }}>
                {authError}
              </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={start} disabled={running || !token}>
            Start
          </button>
          <button onClick={stop} disabled={!running}>
            Stop
          </button>
          <span>Status: {connected ? "connected" : "disconnected"}</span>
        </div>

        <div style={{ marginTop: 16 }}>
          {lines.map((l) => (
              <div
                  key={l.uttId}
                  style={{
                    marginBottom: 14,
                    paddingBottom: 14,
                    borderBottom: "1px solid #ddd",
                  }}
              >
                <div>
                  <b>EN:</b> {l.en}
                </div>
                <div>
                  <b>TL:</b> {l.tl}
                </div>
              </div>
          ))}
        </div>
      </div>
  );
}
