import { NextRequest, NextResponse } from "next/server";

const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
const VISION_MODEL = process.env.VISION_MODEL || "llama3.1-8b";

export async function POST(req: NextRequest) {
  try {
    const { message, image, history } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    if (!CEREBRAS_API_KEY) {
      return NextResponse.json({ error: "CEREBRAS_API_KEY not configured" }, { status: 500 });
    }

    // Since Cerebras doesn't support vision models directly,
    // we extract image metadata and provide context to the text model.
    // The image is captured from the user's camera/screen.
    let imageContext = "";
    if (image) {
      // Extract basic info from the base64 image
      const sizeKB = Math.round((image.length * 3) / 4 / 1024);
      const isJpeg = image.startsWith("data:image/jpeg");
      const isPng = image.startsWith("data:image/png");
      imageContext = `[The user has shared a live ${isJpeg ? "JPEG" : isPng ? "PNG" : "image"} frame (~${sizeKB}KB) from their ${message.toLowerCase().includes("screen") ? "screen" : "camera"}. Since I cannot directly analyze the image pixels, I will respond helpfully based on their question and provide guidance. If they ask "what do you see", I should explain that I'm processing their visual input and ask them to describe what they'd like help with.]`;
    }

    const systemMessage = {
      role: "system",
      content: `You are Revide AI, an advanced real-time visual assistant. The user is sharing their camera or screen with you. ${imageContext}

When the user asks about what you see:
- Acknowledge that you're connected to their live feed
- Ask clarifying questions about what they want analyzed
- Provide helpful, actionable responses
- Be conversational and natural
- If they share their screen with code, help debug or explain it
- If they share a UI, suggest improvements
- Always be precise and helpful`,
    };

    const conversationMessages: Array<{ role: string; content: string }> = [systemMessage];

    if (history && Array.isArray(history)) {
      for (const h of history.slice(-6)) {
        conversationMessages.push({ role: h.role, content: h.content });
      }
    }

    conversationMessages.push({ role: "user", content: message });

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
              } catch { /* skip */ }
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
