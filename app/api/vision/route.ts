import { NextRequest, NextResponse } from "next/server";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
const VISION_MODEL = process.env.VISION_MODEL || "llama-4-scout-17b-16e-instruct";

export async function POST(req: NextRequest) {
  try {
    const { message, image, history } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    if (!CEREBRAS_API_KEY) {
      return NextResponse.json({ error: "CEREBRAS_API_KEY not configured" }, { status: 500 });
    }

    // Build messages with vision content
    const systemMessage = {
      role: "system",
      content:
        "You are Revide AI, an advanced visual AI agent. You can see, understand, and describe what the user shows you through their camera or screen. Be precise, helpful, and articulate. When analyzing images, describe what you see in detail and answer questions about the visual content. If you see code, help debug or explain it. If you see a UI, describe it and suggest improvements.",
    };

    // Build conversation history
    const conversationMessages: Array<{
      role: string;
      content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    }> = [systemMessage];

    // Add history (text only for previous messages)
    if (history && Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        conversationMessages.push({
          role: h.role,
          content: h.content,
        });
      }
    }

    // Current message with image
    if (image) {
      conversationMessages.push({
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: image },
          },
          {
            type: "text",
            text: message,
          },
        ],
      });
    } else {
      conversationMessages.push({
        role: "user",
        content: message,
      });
    }

    const response = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CEREBRAS_API_KEY}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: conversationMessages,
        stream: true,
        max_tokens: 2048,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Cerebras vision error:", errorText);
      return NextResponse.json(
        { error: `Vision API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    // Stream the response back
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
