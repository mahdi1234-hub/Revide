import { NextRequest, NextResponse } from "next/server";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
const CHAT_MODEL = process.env.CHAT_MODEL || "llama-4-scout-17b-16e-instruct";

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }

    if (!CEREBRAS_API_KEY) {
      return NextResponse.json({ error: "CEREBRAS_API_KEY not configured" }, { status: 500 });
    }

    const systemMessage = {
      role: "system",
      content:
        "You are Revide AI, an advanced AI assistant. You are articulate, helpful, and provide well-structured responses. You can discuss any topic, help with code, explain concepts, and engage in thoughtful conversation.",
    };

    const chatMessages = [
      systemMessage,
      ...messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const response = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CEREBRAS_API_KEY}`,
      },
      body: JSON.stringify({
        model: CHAT_MODEL,
        messages: chatMessages,
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Chat API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const encoder = new TextEncoder();
    const reader = response.body?.getReader();

    if (!reader) {
      return NextResponse.json({ error: "No response body" }, { status: 500 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data: ")) continue;
              const data = trimmed.slice(6);
              if (data === "[DONE]") {
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                break;
              }
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
                  );
                }
              } catch {
                // skip
              }
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
