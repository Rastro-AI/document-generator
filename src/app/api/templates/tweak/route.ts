import { NextRequest } from "next/server";
import { runCodeTweakAgent, AgentTrace } from "@/lib/agents/template-agent";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Tweak template code using AI agent with chat-based editing
 * Uses SSE streaming for real-time updates
 */
export async function POST(request: NextRequest) {
  try {
    const { code, prompt, history } = await request.json();

    if (!code) {
      return new Response(JSON.stringify({ error: "Template code is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!prompt) {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create SSE stream for real-time updates
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = (event: string, data: unknown) => {
      writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    // Run agent in background
    (async () => {
      try {
        const onEvent = (trace: AgentTrace) => {
          sendEvent("trace", trace);
        };

        const result = await runCodeTweakAgent(
          code,
          prompt,
          history || [],
          onEvent
        );

        sendEvent("result", {
          success: result.success,
          code: result.code,
          message: result.message,
          traces: result.traces,
        });

        sendEvent("done", {});
      } catch (error) {
        console.error("Tweak error:", error);
        sendEvent("error", { error: String(error) });
      } finally {
        await writer.close();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Tweak failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
