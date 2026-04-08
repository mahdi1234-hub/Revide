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
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoVision, setAutoVision] = useState(false);
  const [transcript, setTranscript] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const autoVisionRef = useRef<NodeJS.Timeout | null>(null);
  const speechSynthRef = useRef<SpeechSynthesisUtterance | null>(null);

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      if (autoVisionRef.current) {
        clearInterval(autoVisionRef.current);
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  // Speak text using Web Speech API
  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    // Try to use a natural voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.name.includes("Google") || v.name.includes("Samantha") || v.name.includes("Daniel")
    );
    if (preferred) utterance.voice = preferred;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    speechSynthRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  // Speech recognition (listen)
  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
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
      setTranscript(interim);
      if (final) {
        setInput(final);
        setTranscript("");
        // Auto-send after final transcript
        setTimeout(() => {
          const btn = document.getElementById("send-btn");
          if (btn) btn.click();
        }, 300);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsListening(true);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
    setTranscript("");
  }, []);

  const startCamera = async () => {
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setSource("camera");
      setIsStreaming(true);
    } catch (err) {
      console.error("Camera error:", err);
    }
  };

  const startScreenShare = async () => {
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
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
    } catch (err) {
      console.error("Screen share error:", err);
    }
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
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

  // Send message with optional vision
  const sendMessage = async (overrideContent?: string) => {
    const trimmed = overrideContent || input.trim();
    if (!trimmed || isLoading) return;

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
        : { messages: [...messages.slice(-10), { role: "user", content: trimmed }] };

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
              } catch { /* skip */ }
            }
          }
        }
      }

      // Auto-speak response
      if (assistantContent) {
        speak(assistantContent);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${msg}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle auto-vision mode (continuous analysis)
  const toggleAutoVision = useCallback(() => {
    if (autoVision) {
      if (autoVisionRef.current) clearInterval(autoVisionRef.current);
      autoVisionRef.current = null;
      setAutoVision(false);
    } else {
      setAutoVision(true);
      // Capture and analyze every 8 seconds
      const analyze = () => {
        if (!isLoading) {
          sendMessage("Describe what you see right now. Be concise and highlight any changes.");
        }
      };
      analyze();
      autoVisionRef.current = setInterval(analyze, 8000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVision, isLoading, isStreaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="min-h-screen grid place-items-center sm:p-6 md:p-8 p-4">
      <section
        className="overflow-hidden bg-black w-full max-w-6xl min-h-[86vh] max-h-[94vh] border-white/10 border rounded-3xl relative flex flex-col"
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
        <div className="relative z-10 flex items-center justify-between px-6 md:px-10 pt-5 md:pt-7">
          <div className="uppercase text-sm font-medium text-white/90 tracking-tighter">
            Revide
          </div>
          <div className="flex items-center gap-4">
            {isStreaming && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] uppercase tracking-widest text-white/50">
                  {source === "camera" ? "Camera" : "Screen"} Live
                </span>
              </div>
            )}
            {autoVision && (
              <span className="text-[10px] uppercase tracking-widest text-accent-purple/80 animate-pulse">
                Auto-Analyzing
              </span>
            )}
            {isSpeaking && (
              <button
                onClick={stopSpeaking}
                className="text-[9px] uppercase tracking-widest text-accent-pink/80 hover:text-white transition-colors"
              >
                Stop Speaking
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="relative z-10 flex-1 flex flex-col md:flex-row gap-3 px-4 md:px-6 py-3 overflow-hidden">
          {/* Left: Video + Controls */}
          <div className="w-full md:w-[42%] flex flex-col gap-2.5">
            {/* Video */}
            <div className="relative rounded-2xl overflow-hidden bg-black/40 border border-white/10 aspect-video">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${source === "camera" ? "video-feed" : ""} ${isStreaming ? "" : "hidden"}`}
              />
              {!isStreaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                  <div className="w-14 h-14 rounded-full border-2 border-white/20 flex items-center justify-center mb-3 glow-ring">
                    <svg className="w-7 h-7 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-white/40 text-xs font-light">
                    Start camera or share screen
                  </p>
                </div>
              )}
              {/* Auto-vision indicator */}
              {autoVision && isStreaming && (
                <div className="absolute top-3 right-3 bg-accent-purple/30 backdrop-blur-sm border border-accent-purple/40 rounded-full px-3 py-1">
                  <span className="text-[9px] uppercase tracking-widest text-white/80 animate-pulse">
                    Watching...
                  </span>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Source Controls */}
            <div className="flex gap-2">
              <button
                onClick={isStreaming && source === "camera" ? stopStream : startCamera}
                className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl border transition-all duration-300 ${
                  source === "camera"
                    ? "bg-red-500/20 border-red-500/40 text-red-300"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {source === "camera" ? "Stop" : "Camera"}
              </button>
              <button
                onClick={isStreaming && source === "screen" ? stopStream : startScreenShare}
                className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2 rounded-xl border transition-all duration-300 ${
                  source === "screen"
                    ? "bg-red-500/20 border-red-500/40 text-red-300"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {source === "screen" ? "Stop" : "Screen"}
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              {/* Voice Listen */}
              <button
                onClick={isListening ? stopListening : startListening}
                className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2.5 rounded-xl border transition-all duration-300 flex items-center justify-center gap-2 ${
                  isListening
                    ? "bg-red-500/20 border-red-500/40 text-red-300 animate-pulse"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
                {isListening ? "Listening..." : "Listen"}
              </button>

              {/* Auto Vision */}
              {isStreaming && (
                <button
                  onClick={toggleAutoVision}
                  className={`flex-1 text-[10px] uppercase tracking-widest px-3 py-2.5 rounded-xl border transition-all duration-300 flex items-center justify-center gap-2 ${
                    autoVision
                      ? "bg-accent-purple/20 border-accent-purple/40 text-accent-purple"
                      : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {autoVision ? "Stop Watch" : "Auto Watch"}
                </button>
              )}
            </div>

            {/* Voice transcript */}
            {(isListening || transcript) && (
              <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2">
                <span className="text-[9px] uppercase tracking-widest text-white/30 block mb-1">
                  Hearing...
                </span>
                <p className="text-white/70 text-sm font-light italic">
                  {transcript || "..."}
                </p>
              </div>
            )}

            {/* ElevenLabs Voice Agent */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-3 flex flex-col items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-widest text-white/30">
                ElevenLabs Voice Agent
              </span>
              {/* @ts-expect-error - ElevenLabs custom element */}
              <elevenlabs-convai agent-id="agent_0201kmwp5fvveacamafpg95ck3gd" />
            </div>
          </div>

          {/* Right: Chat */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto chat-scroll pr-2">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center fade-in-up">
                  <h1 className="text-3xl md:text-5xl font-extralight text-white/95 tracking-tight leading-[1.1] mb-3">
                    <span className="block">See. Understand.</span>
                    <span className="block">Listen. Speak.</span>
                  </h1>
                  <p className="text-white/35 text-xs font-light max-w-sm mb-5">
                    Real-time AI agent powered by Cerebras vision and ElevenLabs voice.
                    Start your camera, click Listen, and talk to the AI about what you see.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {[
                      "What do you see?",
                      "Describe my screen",
                      "Help me with this",
                      "What am I looking at?",
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => { setInput(s); inputRef.current?.focus(); }}
                        className="text-[9px] uppercase tracking-widest bg-white/5 border border-white/10 text-white/40 px-3 py-1.5 rounded-lg hover:bg-white/10 hover:text-white/70 transition-all"
                      >
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
                      ? "bg-accent-purple/20 border border-accent-purple/30 text-white"
                      : "bg-white/8 border border-white/10 text-white/90"
                  }`}>
                    {msg.role === "assistant" && (
                      <span className="block text-[9px] uppercase tracking-widest text-accent-purple/50 mb-1">Revide AI</span>
                    )}
                    {msg.image && (
                      <img src={msg.image} alt="Frame" className="w-full max-w-[180px] rounded-lg mb-2 border border-white/10" />
                    )}
                    <div className="text-sm font-light leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                    {msg.role === "assistant" && msg.content && (
                      <button
                        onClick={() => speak(msg.content)}
                        className="mt-1.5 text-[9px] uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
                      >
                        Replay
                      </button>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
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
            <div className="mt-2">
              <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex items-end gap-3">
                {isStreaming && (
                  <div className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400 animate-pulse mb-2" />
                )}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isStreaming ? "Ask about what you see..." : "Type a message..."}
                  rows={1}
                  className="flex-1 bg-transparent text-white text-sm font-light placeholder:text-white/25 resize-none outline-none max-h-20 leading-relaxed"
                  onInput={(e) => {
                    const t = e.target as HTMLTextAreaElement;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 80) + "px";
                  }}
                />
                <button
                  id="send-btn"
                  onClick={() => sendMessage()}
                  disabled={isLoading || !input.trim()}
                  className="text-[10px] uppercase tracking-widest bg-accent-purple/80 text-white px-4 py-2 rounded-xl font-medium hover:bg-accent-purple transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {isLoading ? "..." : "Send"}
                </button>
              </div>
              <p className="text-center text-white/15 text-[9px] uppercase tracking-widest mt-1.5">
                {isStreaming ? "Vision active -- frames captured with each message" : "Start camera or screen share for visual AI"}
                {" | "}{isListening ? "Listening for voice..." : "Click Listen for voice input"}
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
