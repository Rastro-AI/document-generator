import { NextRequest } from "next/server";
import { runTemplateGeneratorAgent, GeneratorTrace } from "@/lib/agents/template-generator";
import { pdfToPng } from "pdf-to-png-converter";

// Logger for SSE route
const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [generate-route] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [generate-route] ERROR: ${msg}`, data !== undefined ? data : "");
  },
};

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for complex generation

/**
 * Convert PDF buffer to PNG images using pdf-to-png-converter
 * Pure JS solution using PDF.js + node-canvas, works on serverless
 */
async function pdfToImages(pdfBuffer: Buffer): Promise<string[]> {
  log.info(`pdfToImages starting`, { pdfSize: pdfBuffer.length });
  const startTime = Date.now();

  try {
    log.info(`Converting PDF to PNG with pdf-to-png-converter...`);

    // Convert Buffer to ArrayBuffer for pdf-to-png-converter
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    );

    const pages = await pdfToPng(arrayBuffer, {
      viewportScale: 2.0,  // 2x scale for good quality
      pagesToProcess: [1], // Only first page
    });

    log.info(`Conversion complete`, {
      pageCount: pages.length,
      duration: `${Date.now() - startTime}ms`
    });

    const images = pages
      .filter((page) => page.content) // Filter out pages without content
      .map((page, index) => {
        const base64 = `data:image/png;base64,${page.content!.toString("base64")}`;
        log.info(`Page ${index + 1} converted`, {
          name: page.name,
          width: page.width,
          height: page.height,
          bufferSize: page.content!.length,
          base64Length: base64.length
        });
        return base64;
      });

    log.info(`pdfToImages complete, returning ${images.length} image(s)`);
    return images;
  } catch (error) {
    const err = error as Error;
    log.error(`pdfToImages failed`, {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    throw new Error(`PDF conversion failed: ${err.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const pdfFile = formData.get("pdf") as File | null;
    const userPrompt = formData.get("prompt") as string | null;
    const reasoning = (formData.get("reasoning") as "none" | "low" | "high" | null) || "none";

    // For continuing from existing state (feedback mode)
    const currentCode = formData.get("currentCode") as string | null;
    const currentJson = formData.get("currentJson") as string | null;
    const feedback = formData.get("feedback") as string | null;
    const startVersion = parseInt(formData.get("startVersion") as string || "0", 10);
    const conversationHistoryJson = formData.get("conversationHistory") as string | null;

    // Get all image files (for prompt-only mode)
    const imageFiles: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key === "images" && value instanceof File) {
        imageFiles.push(value);
      }
    }

    // Either PDF or (prompt + optional images) is required
    if (!pdfFile && !userPrompt) {
      return new Response(JSON.stringify({ error: "Either a PDF file or a text prompt is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const isContinuation = !!(currentCode && feedback);
    log.info(isContinuation ? "Continuing generation with feedback" : "Starting new generation");
    log.info(`Mode: ${pdfFile ? "PDF reference" : "Prompt-only"}, Images: ${imageFiles.length}`);

    let pageImages: string[] = [];
    let pdfBuffer: Buffer | undefined;

    // If PDF provided, convert to images
    if (pdfFile) {
      const arrayBuffer = await pdfFile.arrayBuffer();
      pdfBuffer = Buffer.from(arrayBuffer);

      try {
        pageImages = await pdfToImages(pdfBuffer);
        log.info(`Converted PDF to ${pageImages.length} page images`);
      } catch (conversionError) {
        console.error("PDF conversion error:", conversionError);
        return new Response(
          JSON.stringify({ error: "Failed to convert PDF to image", details: String(conversionError) }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // Add any directly uploaded images
    for (const imageFile of imageFiles) {
      const arrayBuffer = await imageFile.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      const mimeType = imageFile.type || "image/png";
      pageImages.push(`data:${mimeType};base64,${base64}`);
      log.info(`Added image: ${imageFile.name} (${mimeType})`);
    }

    // Create SSE stream for real-time updates
    log.info("Creating SSE stream...");
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = (event: string, data: unknown) => {
      // Log version events specifically
      if (event === "trace" && typeof data === "object" && data !== null && (data as GeneratorTrace).type === "version") {
        log.info("SSE sending VERSION event", { version: (data as GeneratorTrace).version, hasPreview: !!(data as GeneratorTrace).previewUrl });
      }
      writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    // Run generator in background
    (async () => {
      try {
        const onEvent = (trace: GeneratorTrace) => {
          if (trace.type === "version") {
            log.info("Received VERSION trace from generator", { version: trace.version });
          }
          sendEvent("trace", trace);
        };

        // Parse conversation history if provided
        let conversationHistory;
        if (conversationHistoryJson) {
          try {
            conversationHistory = JSON.parse(conversationHistoryJson);
            log.info(`Resuming with conversation history (${conversationHistory.length} items)`);
          } catch (e) {
            log.error("Failed to parse conversation history", e);
          }
        }

        const result = await runTemplateGeneratorAgent(
          pageImages,
          pdfFile?.name || "prompt-based-template",
          pdfBuffer,
          userPrompt || undefined,
          onEvent,
          reasoning,
          // Pass continuation state if available
          currentCode || undefined,
          currentJson ? JSON.parse(currentJson) : undefined,
          feedback || undefined,
          startVersion,
          conversationHistory
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
