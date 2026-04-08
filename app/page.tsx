"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

const WebGLBackground = dynamic(() => import("@/components/WebGLBackground"), {
  ssr: false,
});

interface Message {
  role: "user" | "assistant";
  content: string;
}

type SourceType = "camera" | "screen" | null;

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [source, setSource] = useState<SourceType>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("Tap mic to start");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  // TTS
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) =>
        v.name.includes("Google") || v.name.includes("Samantha") || v.name.includes("Daniel")
      );
      if (preferred) u.voice = preferred;
      u.onstart = () => { setIsSpeaking(true); setStatus("Speaking..."); };
      u.onend = () => { setIsSpeaking(false); setStatus("Tap mic to speak"); resolve(); };
      u.onerror = () => { setIsSpeaking(false); resolve(); };
      window.speechSynthesis.speak(u);
    });
  }, []);

  // Video
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
      setStatus("Camera on. Tap mic to speak");
    } catch (err) { console.error(err); }
  };

  const startScreenShare = async () => {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setSource("screen");
      setIsStreaming(true);
      setStatus("Screen sharing. Tap mic to speak");
      stream.getVideoTracks()[0].onended = () => {
        setIsStreaming(false); setSource(null);
        setStatus("Tap mic to start");
      };
    } catch (err) { console.error(err); }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsStreaming(false); setSource(null);
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

  // Send to Gemini vision API
  const sendToVision = async (text: string) => {
    setIsProcessing(true);
    setStatus("Thinking...");

    const frame = captureFrame();
    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          image: frame,
          history: messages.slice(-6),
        }),
      });

      if (!res.ok) throw new Error(`Error: ${res.status}`);

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

      // Speak the response
      if (content) await speak(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error";
      setMessages((prev) => [...prev, { role: "assistant", content: msg }]);
      setStatus("Error. Tap mic to retry");
    } finally {
      setIsProcessing(false);
    }
  };

  // STT - toggle listening
  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Speech recognition not supported"); return; }

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(interim || final);
      if (final) {
        setTranscript("");
        setIsListening(false);
        sendToVision(final);
      }
    };

    recognition.onerror = () => { setIsListening(false); setStatus("Error. Tap mic again"); };
    recognition.onend = () => { setIsListening(false); };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
    setStatus("Listening...");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening, isStreaming, messages]);

  return (
    <div className="relative w-full h-screen overflow-hidden">
      {/* Full-page WebGL */}
      <WebGLBackground />
      <div
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(900px 700px at 50% 40%, rgba(120,70,255,0.1), transparent 60%), radial-gradient(900px 700px at 60% 65%, rgba(255,0,160,0.08), transparent 60%), linear-gradient(rgba(0,0,0,0.5), rgba(0,0,0,0.25) 45%, rgba(0,0,0,0.45))",
        }}
      />

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* UI Overlay */}
      <div className="relative z-10 w-full h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 md:px-10 pt-5">
          <div className="uppercase text-sm font-medium text-white/90 tracking-tighter">Revide</div>
          <div className="flex items-center gap-3">
            {isStreaming && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-white/50">
                  {source === "camera" ? "Camera" : "Screen"} Live
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Center: Title + Controls */}
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          {messages.length === 0 && !isListening && !isProcessing && (
            <div className="text-center mb-12 fade-in-up">
              <h1 className="text-5xl md:text-7xl font-extralight text-white/95 tracking-tight leading-[1.1] mb-4 drop-shadow-sm">
                <span className="block">See. Understand.</span>
                <span className="block">Speak.</span>
              </h1>
              <p className="text-white/30 text-sm font-light max-w-md mx-auto">
                Real-time AI visual agent. Share your camera or screen, then speak.
              </p>
            </div>
          )}

          {/* Video preview (small floating) */}
          {isStreaming && (
            <div className="absolute top-20 right-6 w-40 md:w-52 aspect-video rounded-2xl overflow-hidden border border-white/15 shadow-2xl">
              <video
                ref={videoRef}
                autoPlay playsInline muted
                className={`w-full h-full object-cover ${source === "camera" ? "video-feed" : ""}`}
              />
            </div>
          )}

          {/* Transcript */}
          {(isListening || transcript) && (
            <div className="mb-6 max-w-md text-center">
              <p className="text-white/60 text-lg font-light italic animate-pulse">
                {transcript || "Listening..."}
              </p>
            </div>
          )}

          {/* Last AI response */}
          {messages.length > 0 && (
            <div className="mb-8 max-w-lg text-center px-4">
              <div className="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl px-6 py-4 max-h-40 overflow-y-auto chat-scroll">
                <span className="block text-[9px] uppercase tracking-widest text-accent-purple/40 mb-1">Revide AI</span>
                <p className="text-white/80 text-sm font-light leading-relaxed">
                  {messages[messages.length - 1]?.content || ""}
                </p>
              </div>
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Status */}
          <p className="text-white/25 text-[10px] uppercase tracking-widest mb-6">{status}</p>

          {/* Big mic button */}
          <button
            onClick={toggleListening}
            disabled={isProcessing || isSpeaking}
            className={`w-20 h-20 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
              isListening
                ? "bg-red-500/30 border-red-500/60 scale-110 glow-ring"
                : isProcessing
                ? "bg-accent-purple/20 border-accent-purple/40 animate-pulse"
                : "bg-white/5 border-white/20 hover:bg-white/10 hover:border-white/40 hover:scale-105"
            } disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            {isProcessing ? (
              <div className="flex items-center gap-1">
                <div className="typing-dot w-2 h-2 rounded-full bg-accent-purple/80" />
                <div className="typing-dot w-2 h-2 rounded-full bg-accent-purple/80" />
                <div className="typing-dot w-2 h-2 rounded-full bg-accent-purple/80" />
              </div>
            ) : (
              <svg className={`w-8 h-8 ${isListening ? "text-red-400" : "text-white/70"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
        </div>

        {/* Bottom: Source controls */}
        <div className="flex items-center justify-center gap-3 pb-8 px-6">
          <button
            onClick={isStreaming && source === "camera" ? stopStream : startCamera}
            className={`text-[10px] uppercase tracking-widest px-5 py-2.5 rounded-full border transition-all ${
              source === "camera"
                ? "bg-red-500/20 border-red-500/40 text-red-300"
                : "bg-white/5 border-white/15 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            {source === "camera" ? "Stop Camera" : "Camera"}
          </button>
          <button
            onClick={isStreaming && source === "screen" ? stopStream : startScreenShare}
            className={`text-[10px] uppercase tracking-widest px-5 py-2.5 rounded-full border transition-all ${
              source === "screen"
                ? "bg-red-500/20 border-red-500/40 text-red-300"
                : "bg-white/5 border-white/15 text-white/50 hover:bg-white/10 hover:text-white"
            }`}
          >
            {source === "screen" ? "Stop Share" : "Screen Share"}
          </button>
          {isSpeaking && (
            <button
              onClick={() => { window.speechSynthesis?.cancel(); setIsSpeaking(false); }}
              className="text-[10px] uppercase tracking-widest px-5 py-2.5 rounded-full border bg-accent-pink/10 border-accent-pink/30 text-accent-pink/80 hover:bg-accent-pink/20 transition-all"
            >
              Stop Speaking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
