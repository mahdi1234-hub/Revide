import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Revide - AI Visual Agent",
  description: "Real-time AI agent that can see, understand, and speak",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="min-h-screen antialiased selection:bg-indigo-500/30 text-slate-900 font-sans bg-[#f4f6fb]">
        {children}
        {/* ElevenLabs Conversational AI Widget */}
        <Script
          src="https://elevenlabs.io/convai-widget/index.js"
          strategy="afterInteractive"
          async
        />
      </body>
    </html>
  );
}
