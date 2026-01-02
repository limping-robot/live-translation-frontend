import React, { useRef, useState } from "react";

function makeUttId() {
  // Safari support: fallback if crypto.randomUUID isn't there
  if (crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export default function App() {
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState([]);

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const streamRef = useRef(null);

  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${proto}://${window.location.host}/ws`;

  async function start() {
    if (running) return;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";

    ws.binaryType = "arraybuffer";

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "result") {
        setLines((prev) => [{ uttId: msg.uttId, en: msg.en, tl: msg.tl }, ...prev]);
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
    <div style={{ padding: 16, fontFamily: "system-ui, sans-serif", maxWidth: 900 }}>
      <h2>Realtime EN → TL (utterance-based)</h2>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={start} disabled={running}>Start</button>
        <button onClick={stop} disabled={!running}>Stop</button>
        <span>Status: {connected ? "connected" : "disconnected"}</span>
      </div>

      <div style={{ marginTop: 16 }}>
        {lines.map((l) => (
          <div key={l.uttId} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid #ddd" }}>
            <div><b>EN:</b> {l.en}</div>
            <div><b>TL:</b> {l.tl}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
