import { NextRequest } from "next/server";
import { runTemplateGeneratorAgent, GeneratorTrace } from "@/lib/agents/template-generator";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

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
 * Get PDF page count using pdfinfo (poppler)
 */
async function getPdfPageCount(pdfPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(`pdfinfo "${pdfPath}" | grep "Pages:" | awk '{print $2}'`);
    return parseInt(stdout.trim(), 10) || 1;
  } catch {
    return 1;
  }
}

/**
 * Convert PDF buffer to PNG images base64 using pdftoppm (poppler)
 * Returns array of base64 images, one per page (up to maxPages)
 */
async function pdfToImages(pdfBuffer: Buffer, maxPages: number = 5): Promise<string[]> {
  const tempDir = os.tmpdir();
  const tempId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);
  const pngPathBase = path.join(tempDir, tempId);

  try {
    await fs.writeFile(pdfPath, pdfBuffer);

    // Get page count
    const pageCount = await getPdfPageCount(pdfPath);
    const pagesToConvert = Math.min(pageCount, maxPages);
    log.info(`PDF has ${pageCount} pages, converting first ${pagesToConvert}`);

    // Convert pages to PNG using pdftoppm
    await execAsync(`pdftoppm -png -f 1 -l ${pagesToConvert} -r 200 "${pdfPath}" "${pngPathBase}"`);

    // Read all generated PNGs
    const images: string[] = [];
    for (let i = 1; i <= pagesToConvert; i++) {
      const pngPath = `${pngPathBase}-${i}.png`;
      try {
        const pngBuffer = await fs.readFile(pngPath);
        images.push(`data:image/png;base64,${pngBuffer.toString("base64")}`);
        await fs.unlink(pngPath).catch(() => {});
      } catch {
        // Page might not exist if PDF has fewer pages than expected
        break;
      }
    }

    // Clean up
    await fs.unlink(pdfPath).catch(() => {});

    return images;
  } catch (error) {
    await fs.unlink(pdfPath).catch(() => {});
    throw new Error(`PDF conversion failed: ${error}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("pdf") as File | null;
    const userPrompt = formData.get("prompt") as string | null;
    const reasoning = (formData.get("reasoning") as "none" | "low" | "high" | null) || "none";

    // For continuing from existing state (feedback mode)
    const currentCode = formData.get("currentCode") as string | null;
    const currentJson = formData.get("currentJson") as string | null;
    const feedback = formData.get("feedback") as string | null;
    const startVersion = parseInt(formData.get("startVersion") as string || "0", 10);

    if (!file) {
      return new Response(JSON.stringify({ error: "PDF file is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const isContinuation = !!(currentCode && feedback);
    log.info(isContinuation ? "Continuing generation with feedback" : "Starting new generation");

    // Convert PDF to buffer and screenshots (all pages)
    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    let pageImages: string[];
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

        const result = await runTemplateGeneratorAgent(
          pageImages,
          pdfBuffer,
          file.name,
          userPrompt || undefined,
          onEvent,
          reasoning,
          // Pass continuation state if available
          currentCode || undefined,
          currentJson ? JSON.parse(currentJson) : undefined,
          feedback || undefined,
          startVersion
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
