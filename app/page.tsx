"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Conversation } from "@11labs/client";

const WebGLBackground = dynamic(() => import("@/components/WebGLBackground"), {
  ssr: false,
});

interface Message {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

type SourceType = "camera" | "screen" | null;
type Mode = "text" | "voice";

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<SourceType>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [mode, setMode] = useState<Mode>("text");
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [autoVision, setAutoVision] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const conversationRef = useRef<ReturnType<typeof Conversation.startSession> | null>(null);
  const autoVisionRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (autoVisionRef.current) clearInterval(autoVisionRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  // TTS speak
  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((v) => v.name.includes("Google") || v.name.includes("Samantha"));
    if (preferred) u.voice = preferred;
    window.speechSynthesis.speak(u);
  }, []);

  // ElevenLabs Voice Agent - start/stop
  const startVoiceAgent = async () => {
    try {
      setVoiceStatus("Connecting...");
      const conversation = await Conversation.startSession({
        agentId: "agent_0201kmwp5fvveacamafpg95ck3gd",
        connectionType: "websocket",
        onConnect: () => {
          setVoiceActive(true);
          setVoiceStatus("Connected");
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: "Voice agent connected. I can hear you now. Speak naturally!" },
          ]);
        },
        onDisconnect: () => {
          setVoiceActive(false);
          setVoiceStatus("");
        },
        onMessage: (props: { message: string; source: string }) => {
          if (props.source === "ai") {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: props.message },
            ]);
          } else if (props.source === "user") {
            const frame = isStreaming ? captureFrame() : null;
            setMessages((prev) => [
              ...prev,
              { role: "user", content: props.message, image: frame || undefined },
            ]);
          }
        },
        onError: (error: string) => {
          console.error("Voice error:", error);
          setVoiceStatus("Error");
          setVoiceActive(false);
        },
      });
      conversationRef.current = Promise.resolve(conversation);
    } catch (err) {
      console.error("Failed to start voice:", err);
      setVoiceStatus("Failed to connect");
      setTimeout(() => setVoiceStatus(""), 3000);
    }
  };

  const stopVoiceAgent = async () => {
    try {
      const conv = await conversationRef.current;
      if (conv) {
        await conv.endSession();
      }
    } catch {
      // ignore
    }
    conversationRef.current = null;
    setVoiceActive(false);
    setVoiceStatus("");
  };

  // Video controls
  const startCamera = async () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setSource("camera");
      setIsStreaming(true);
    } catch (err) { console.error("Camera error:", err); }
  };

  const startScreenShare = async () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setSource("screen");
      setIsStreaming(true);
      stream.getVideoTracks()[0].onended = () => {
        setIsStreaming(false);
        setSource(null);
        setAutoVision(false);
      };
    } catch (err) { console.error("Screen error:", err); }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsStreaming(false);
    setSource(null);
    setAutoVision(false);
    if (autoVisionRef.current) clearInterval(autoVisionRef.current);
  };

  const captureFrame = (): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isStreaming) return null;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  };

  // Text chat via Cerebras
  const sendMessage = async (overrideContent?: string) => {
    const trimmed = overrideContent || input.trim();
    if (!trimmed || isLoading) return;

    const frame = isStreaming ? captureFrame() : null;
    const userMessage: Message = { role: "user", content: trimmed, image: frame || undefined };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const endpoint = frame ? "/api/vision" : "/api/chat";
      const body = frame
        ? { message: trimmed, image: frame, history: messages.slice(-6) }
        : { messages: [...messages.slice(-10), { role: "user", content: trimmed }] };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let content = "";

      if (reader) {
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n").filter((l) => l.trim())) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const p = JSON.parse(data);
                if (p.content) {
                  content += p.content;
                  setMessages((prev) => {
                    const u = [...prev];
                    u[u.length - 1] = { role: "assistant", content };
                    return u;
                  });
                }
              } catch { /* skip */ }
            }
          }
        }
      }
      // Speak response in voice mode
      if (content && mode === "voice") speak(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-vision
  const toggleAutoVision = useCallback(() => {
    if (autoVision) {
      if (autoVisionRef.current) clearInterval(autoVisionRef.current);
      setAutoVision(false);
    } else {
      setAutoVision(true);
      const run = () => { if (!isLoading) sendMessage("Describe what you see. Be concise, highlight changes."); };
      run();
      autoVisionRef.current = setInterval(run, 8000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVision, isLoading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Full-page WebGL Background */}
      <WebGLBackground />

      {/* Full-page overlay */}
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(900px 700px at 50% 40%, rgba(120,70,255,0.1), transparent 60%), radial-gradient(900px 700px at 60% 65%, rgba(255,0,160,0.08), transparent 60%), linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.3) 45%, rgba(0,0,0,0.5))",
        }}
      />

      {/* App UI */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 md:px-10 pt-5">
          <div className="uppercase text-sm font-medium text-white/90 tracking-tighter">Revide</div>
          <div className="flex items-center gap-4">
            {isStreaming && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-white/50">
                  {source === "camera" ? "Camera" : "Screen"} Live
                </span>
              </div>
            )}
            {voiceActive && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-green-400/70">Voice Active</span>
              </div>
            )}
            {autoVision && (
              <span className="text-[10px] uppercase tracking-widest text-accent-purple/80 animate-pulse">Auto-Analyzing</span>
            )}
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 flex flex-col md:flex-row gap-3 px-4 md:px-8 py-3 overflow-hidden">
          {/* Left: Video + Controls */}
          <div className="w-full md:w-[38%] flex flex-col gap-2.5">
            <div className="relative rounded-2xl overflow-hidden bg-black/50 border border-white/10 aspect-video">
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className={`w-full h-full object-cover ${source === "camera" ? "video-feed" : ""} ${isStreaming ? "" : "hidden"}`}
              />
              {!isStreaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                  <div className="w-14 h-14 rounded-full border-2 border-white/15 flex items-center justify-center mb-3 glow-ring">
                    <svg className="w-7 h-7 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-white/30 text-xs font-light">Start camera or share screen for AI vision</p>
                </div>
              )}
              {autoVision && isStreaming && (
                <div className="absolute top-3 right-3 bg-accent-purple/30 backdrop-blur-sm border border-accent-purple/40 rounded-full px-3 py-1">
                  <span className="text-[9px] uppercase tracking-widest text-white/80 animate-pulse">Watching...</span>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Source buttons */}
            <div className="flex gap-2">
              <button onClick={isStreaming && source === "camera" ? stopStream : startCamera}
                className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl border transition-all ${source === "camera" ? "bg-red-500/20 border-red-500/40 text-red-300" : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"}`}>
                {source === "camera" ? "Stop" : "Camera"}
              </button>
              <button onClick={isStreaming && source === "screen" ? stopStream : startScreenShare}
                className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl border transition-all ${source === "screen" ? "bg-red-500/20 border-red-500/40 text-red-300" : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white"}`}>
                {source === "screen" ? "Stop" : "Screen"}
              </button>
            </div>

            {/* Mode toggle + Voice + Auto-Vision */}
            <div className="flex gap-2">
              <button
                onClick={() => setMode(mode === "text" ? "voice" : "text")}
                className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2.5 rounded-xl border transition-all flex items-center justify-center gap-1.5 ${mode === "voice" ? "bg-accent-purple/20 border-accent-purple/40 text-accent-purple" : "bg-white/5 border-white/10 text-white/50 hover:text-white"}`}>
                {mode === "voice" ? "Voice Mode" : "Text Mode"}
              </button>
              {isStreaming && (
                <button onClick={toggleAutoVision}
                  className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2.5 rounded-xl border transition-all flex items-center justify-center gap-1.5 ${autoVision ? "bg-accent-pink/20 border-accent-pink/40 text-accent-pink" : "bg-white/5 border-white/10 text-white/50 hover:text-white"}`}>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {autoVision ? "Stop" : "Auto"}
                </button>
              )}
            </div>

            {/* Voice agent button (in voice mode) */}
            {mode === "voice" && (
              <button
                onClick={voiceActive ? stopVoiceAgent : startVoiceAgent}
                className={`w-full text-[10px] uppercase tracking-widest px-4 py-3 rounded-xl border transition-all flex items-center justify-center gap-2 ${
                  voiceActive
                    ? "bg-green-500/20 border-green-500/40 text-green-300 glow-ring"
                    : "bg-accent-purple/10 border-accent-purple/30 text-accent-purple hover:bg-accent-purple/20"
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {voiceActive ? "End Voice Session" : "Start Voice Agent"}
                {voiceStatus && !voiceActive && (
                  <span className="text-white/40 ml-1">({voiceStatus})</span>
                )}
              </button>
            )}
          </div>

          {/* Right: Chat */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto chat-scroll pr-2">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center fade-in-up">
                  <h1 className="text-4xl md:text-6xl font-extralight text-white/95 tracking-tight leading-[1.1] mb-4 drop-shadow-sm">
                    <span className="block">See. Understand.</span>
                    <span className="block">Listen. Speak.</span>
                  </h1>
                  <p className="text-white/30 text-xs font-light max-w-md mb-6">
                    {mode === "text"
                      ? "Cerebras-powered AI. Start your camera, then type questions about what you see."
                      : "Voice-powered AI agent. Start your camera, click Start Voice Agent, and talk naturally."}
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {["What do you see?", "Describe my screen", "Help me with this code", "What am I looking at?"].map((s) => (
                      <button key={s} onClick={() => { setInput(s); inputRef.current?.focus(); }}
                        className="text-[9px] uppercase tracking-widest bg-white/5 border border-white/10 text-white/35 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-white/60 transition-all">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} mb-3`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-accent-purple/15 border border-accent-purple/25 text-white"
                      : "bg-white/6 border border-white/8 text-white/90"
                  }`}>
                    {msg.role === "assistant" && (
                      <span className="block text-[9px] uppercase tracking-widest text-accent-purple/40 mb-1">Revide AI</span>
                    )}
                    {msg.image && (
                      <img src={msg.image} alt="Frame" className="w-full max-w-[160px] rounded-lg mb-2 border border-white/10" />
                    )}
                    <div className="text-sm font-light leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    {msg.role === "assistant" && msg.content && (
                      <button onClick={() => speak(msg.content)}
                        className="mt-1 text-[9px] uppercase tracking-widest text-white/20 hover:text-white/50 transition-colors">
                        Replay
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex justify-start mb-3">
                  <div className="bg-white/6 border border-white/8 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="typing-dot w-1.5 h-1.5 rounded-full bg-accent-purple/60" />
                      <div className="typing-dot w-1.5 h-1.5 rounded-full bg-accent-purple/60" />
                      <div className="typing-dot w-1.5 h-1.5 rounded-full bg-accent-purple/60" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input (always visible for text mode, hidden label for voice) */}
            <div className="mt-2">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-end gap-3">
                {isStreaming && <div className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse mb-2" />}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={mode === "voice" ? "Or type here..." : isStreaming ? "Ask about what you see..." : "Type a message..."}
                  rows={1}
                  className="flex-1 bg-transparent text-white text-sm font-light placeholder:text-white/20 resize-none outline-none max-h-20 leading-relaxed"
                  onInput={(e) => { const t = e.target as HTMLTextAreaElement; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 80) + "px"; }}
                />
                <button id="send-btn" onClick={() => sendMessage()} disabled={isLoading || !input.trim()}
                  className="text-[10px] uppercase tracking-widest bg-accent-purple/80 text-white px-4 py-2 rounded-xl font-medium hover:bg-accent-purple transition-all disabled:opacity-20 disabled:cursor-not-allowed whitespace-nowrap">
                  {isLoading ? "..." : "Send"}
                </button>
              </div>
              <p className="text-center text-white/12 text-[9px] uppercase tracking-widest mt-1.5">
                {mode === "text" ? "Text mode -- Cerebras AI" : "Voice mode -- ElevenLabs Agent"}
                {isStreaming ? " | Vision active" : ""}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
