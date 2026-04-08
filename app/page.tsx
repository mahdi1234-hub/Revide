"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

const WebGLBackground = dynamic(() => import("@/components/WebGLBackground"), {
  ssr: false,
});

interface Message {
  role: "user" | "assistant";
  content: string;
  image?: string;
}

type SourceType = "camera" | "screen" | null;

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [source, setSource] = useState<SourceType>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setSource("camera");
      setIsStreaming(true);
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const startScreenShare = async () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setSource("screen");
      setIsStreaming(true);
      // Handle user stopping screen share via browser UI
      stream.getVideoTracks()[0].onended = () => {
        setIsStreaming(false);
        setSource(null);
      };
    } catch (err) {
      console.error("Screen share error:", err);
    }
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setSource(null);
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
    return canvas.toDataURL("image/jpeg", 0.7);
  };

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    // Capture current frame if streaming
    const frame = isStreaming ? captureFrame() : null;

    const userMessage: Message = {
      role: "user",
      content: trimmed,
      image: frame || undefined,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const endpoint = frame ? "/api/vision" : "/api/chat";
      const body = frame
        ? { message: trimmed, image: frame, history: messages.slice(-6) }
        : {
            messages: [...messages.slice(-10), { role: "user", content: trimmed }],
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      if (reader) {
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter((l) => l.trim());

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") break;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  assistantContent += parsed.content;
                  setMessages((prev) => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: "assistant",
                      content: assistantContent,
                    };
                    return updated;
                  });
                }
              } catch {
                // skip
              }
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${msg}. Please check your connection and try again.`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="min-h-screen grid place-items-center sm:p-6 md:p-8 p-4">
      <section
        className="aspect-auto md:aspect-auto overflow-hidden bg-black w-full max-w-5xl min-h-[86vh] max-h-[92vh] border-white/10 border rounded-3xl relative flex flex-col"
        style={{ boxShadow: "0 30px 80px rgba(15,23,42,.20)" }}
      >
        {/* WebGL Background */}
        <WebGLBackground />

        {/* Overlay */}
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{
            background:
              "radial-gradient(900px 700px at 50% 40%, rgba(120,70,255,0.1), transparent 60%), radial-gradient(900px 700px at 60% 65%, rgba(255,0,160,0.08), transparent 60%), linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.4) 45%, rgba(0,0,0,0.65))",
          }}
        />

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-6 md:px-10 pt-6 md:pt-8">
          <div className="uppercase text-sm font-medium text-white/90 tracking-tighter">
            Revide
          </div>
          <div className="flex items-center gap-3">
            {isStreaming && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-white/50">
                  {source === "camera" ? "Camera Live" : "Screen Sharing"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="relative z-10 flex-1 flex flex-col md:flex-row gap-4 px-4 md:px-6 py-4 overflow-hidden">
          {/* Left: Video + Controls */}
          <div className="w-full md:w-[45%] flex flex-col gap-3">
            {/* Video Feed */}
            <div className="relative rounded-2xl overflow-hidden bg-black/40 border border-white/10 aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${
                  source === "camera" ? "video-feed" : ""
                } ${isStreaming ? "" : "hidden"}`}
              />
              {!isStreaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                  <div className="w-16 h-16 rounded-full border-2 border-white/20 flex items-center justify-center mb-4 glow-ring">
                    <svg
                      className="w-8 h-8 text-white/60"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <p className="text-white/50 text-xs font-light">
                    Start your camera or share your screen for the AI to see
                  </p>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Source Controls */}
            <div className="flex gap-2">
              <button
                onClick={isStreaming && source === "camera" ? stopStream : startCamera}
                className={`flex-1 text-[10px] uppercase tracking-widest px-4 py-2.5 rounded-xl border transition-all duration-300 ${
                  source === "camera"
                    ? "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {source === "camera" ? "Stop Camera" : "Camera"}
              </button>
              <button
                onClick={
                  isStreaming && source === "screen" ? stopStream : startScreenShare
                }
                className={`flex-1 text-[10px] uppercase tracking-widest px-4 py-2.5 rounded-xl border transition-all duration-300 ${
                  source === "screen"
                    ? "bg-red-500/20 border-red-500/40 text-red-300 hover:bg-red-500/30"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                {source === "screen" ? "Stop Share" : "Screen"}
              </button>
            </div>

            {/* ElevenLabs Voice Agent */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-white/40">
                Voice Agent
              </span>
              {/* @ts-expect-error - ElevenLabs custom element */}
              <elevenlabs-convai agent-id="agent_0201kmwp5fvveacamafpg95ck3gd" />
            </div>
          </div>

          {/* Right: Chat */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto chat-scroll pr-2">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center fade-in-up">
                  <h1 className="text-3xl md:text-4xl lg:text-5xl font-extralight text-white/95 tracking-tight leading-[1.1] mb-4">
                    <span className="block">See. Understand.</span>
                    <span className="block">Speak.</span>
                  </h1>
                  <p className="text-white/40 text-xs font-light max-w-sm mb-6">
                    AI agent powered by Cerebras and ElevenLabs. Start your
                    camera or share your screen, then ask anything about what
                    you see.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      "What do you see?",
                      "Describe my screen",
                      "Help me with this code",
                      "What am I looking at?",
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setInput(s);
                          inputRef.current?.focus();
                        }}
                        className="text-[9px] uppercase tracking-widest bg-white/5 border border-white/10 text-white/50 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-white/80 transition-all"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${
                    msg.role === "user" ? "justify-end" : "justify-start"
                  } mb-3`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                      msg.role === "user"
                        ? "bg-accent-purple/20 border border-accent-purple/30 text-white"
                        : "bg-white/8 border border-white/10 text-white/90"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <span className="block text-[9px] uppercase tracking-widest text-accent-purple/60 mb-1">
                        Revide AI
                      </span>
                    )}
                    {msg.image && (
                      <img
                        src={msg.image}
                        alt="Captured frame"
                        className="w-full max-w-[200px] rounded-lg mb-2 border border-white/10"
                      />
                    )}
                    <div className="text-sm font-light leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}

              {isLoading &&
                messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex justify-start mb-3">
                    <div className="bg-white/8 border border-white/10 rounded-2xl px-4 py-3">
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

            {/* Input */}
            <div className="mt-3">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-end gap-3">
                {isStreaming && (
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse mb-2" />
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isStreaming
                      ? "Ask about what you see..."
                      : "Type a message..."
                  }
                  rows={1}
                  className="flex-1 bg-transparent text-white text-sm font-light placeholder:text-white/30 resize-none outline-none max-h-24 leading-relaxed"
                  onInput={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 96) + "px";
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={isLoading || !input.trim()}
                  className="text-[10px] uppercase tracking-widest bg-accent-purple/80 text-white px-4 py-2 rounded-xl font-medium hover:bg-accent-purple transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isLoading ? "..." : "Send"}
                </button>
              </div>
              <p className="text-center text-white/20 text-[9px] uppercase tracking-widest mt-2">
                {isStreaming
                  ? "Frames captured with each message"
                  : "Start camera or screen share for visual AI"}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
