import type { Metadata } from "next";
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
      <body className="min-h-screen antialiased text-slate-900 font-sans bg-black overflow-hidden">
        {children}
      </body>
    </html>
  );
}
