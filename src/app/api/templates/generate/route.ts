import { NextRequest } from "next/server";
import { runTemplateGenerator, GeneratorTrace } from "@/lib/agents/template-generator";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for complex generation

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("pdf") as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "PDF file is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Convert PDF to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const pdfBase64 = `data:application/pdf;base64,${base64}`;

    // Create SSE stream for real-time updates
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = (event: string, data: unknown) => {
      writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    // Run generator in background
    (async () => {
      try {
        const onEvent = (trace: GeneratorTrace) => {
          sendEvent("trace", trace);
        };

        const result = await runTemplateGenerator(
          pdfBase64,
          file.name,
          onEvent
        );

        sendEvent("result", result);
        sendEvent("done", {});
      } catch (error) {
        console.error("Template generation error:", error);
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
    console.error("Template generate route error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
