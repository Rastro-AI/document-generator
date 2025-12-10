import { NextRequest } from "next/server";
import { runTemplateGeneratorAgent, GeneratorTrace } from "@/lib/agents/template-generator";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FormTemplateSchema } from "@/lib/pdf-filler";

const execAsync = promisify(exec);

// Logger
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
export const maxDuration = 300;

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
 */
async function pdfToImages(pdfBuffer: Buffer, maxPages: number = 5): Promise<string[]> {
  const tempDir = os.tmpdir();
  const tempId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);
  const pngPathBase = path.join(tempDir, tempId);

  try {
    await fs.writeFile(pdfPath, pdfBuffer);
    const pageCount = await getPdfPageCount(pdfPath);
    const pagesToConvert = Math.min(pageCount, maxPages);
    log.info(`PDF has ${pageCount} pages, converting first ${pagesToConvert}`);

    await execAsync(`pdftoppm -png -f 1 -l ${pagesToConvert} -r 200 "${pdfPath}" "${pngPathBase}"`);

    const images: string[] = [];
    for (let i = 1; i <= pagesToConvert; i++) {
      const pngPath = `${pngPathBase}-${i}.png`;
      try {
        const pngBuffer = await fs.readFile(pngPath);
        images.push(`data:image/png;base64,${pngBuffer.toString("base64")}`);
        await fs.unlink(pngPath).catch(() => {});
      } catch {
        break;
      }
    }

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
    const reasoning = (formData.get("reasoning") as "none" | "low" | "high" | null) || "low";

    // Continuation parameters
    const currentSchemaStr = formData.get("currentSchema") as string | null;
    const feedback = formData.get("feedback") as string | null;
    const startVersion = parseInt(formData.get("startVersion") as string || "0", 10);
    const currentBasePdfBase64 = formData.get("currentBasePdf") as string | null;

    if (!file) {
      return new Response(JSON.stringify({ error: "PDF file is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const isContinuation = !!(currentSchemaStr && feedback);
    log.info(isContinuation ? "Continuing generation with feedback" : "Starting new generation");

    const arrayBuffer = await file.arrayBuffer();
    const originalPdfBuffer = Buffer.from(arrayBuffer);

    // For continuation: use the current base PDF (with edits) if provided
    // Otherwise fall back to the original PDF
    let pdfBuffer: Buffer;
    let currentBasePdfBuffer: Buffer | undefined;
    if (isContinuation && currentBasePdfBase64) {
      // Extract buffer from data URL
      const base64Data = currentBasePdfBase64.replace(/^data:application\/pdf;base64,/, "");
      currentBasePdfBuffer = Buffer.from(base64Data, "base64");
      pdfBuffer = currentBasePdfBuffer;
      log.info("Using current base PDF with previous edits for continuation");
    } else {
      pdfBuffer = originalPdfBuffer;
    }

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

    // Create SSE stream
    log.info("Creating SSE stream...");
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    const sendEvent = (event: string, data: unknown) => {
      if (event === "trace" && typeof data === "object" && data !== null && (data as GeneratorTrace).type === "version") {
        log.info("SSE sending VERSION event", { version: (data as GeneratorTrace).version });
      }
      writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };

    // Run generator
    (async () => {
      try {
        const onEvent = (trace: GeneratorTrace) => {
          if (trace.type === "version") {
            log.info("Received VERSION trace", { version: trace.version });
          }
          sendEvent("trace", trace);
        };

        const existingSchema: FormTemplateSchema | undefined = currentSchemaStr
          ? JSON.parse(currentSchemaStr)
          : undefined;

        const result = await runTemplateGeneratorAgent(
          pageImages,
          pdfBuffer,  // For continuations, this is the current base PDF with all previous edits
          file.name,
          userPrompt || undefined,
          onEvent,
          reasoning,
          existingSchema,
          feedback || undefined,
          startVersion
        );

        // Convert result for frontend compatibility
        // The frontend expects templateJson and templateCode, so we convert schema
        const frontendResult = {
          success: result.success,
          message: result.message,
          versions: result.versions,
          // New schema-based output
          schema: result.schema,
          basePdfBase64: result.basePdfBuffer
            ? `data:application/pdf;base64,${result.basePdfBuffer.toString("base64")}`
            : undefined,
          originalPdfBase64: result.originalPdfBuffer
            ? `data:application/pdf;base64,${result.originalPdfBuffer.toString("base64")}`
            : undefined,
          // Legacy compatibility - convert schema to templateJson format
          templateJson: result.schema ? schemaToTemplateJson(result.schema) : undefined,
        };

        sendEvent("result", frontendResult);
        sendEvent("done", {});
      } catch (error) {
        console.error("Template generation error:", error);
        sendEvent("error", { error: String(error) });
      } finally {
        // Only close writer if it's not already closed
        try {
          await writer.close();
        } catch (closeError) {
          // Ignore "WritableStream is closed" errors - client may have disconnected
          if (!(closeError instanceof TypeError && String(closeError).includes("closed"))) {
            console.error("Error closing writer:", closeError);
          }
        }
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

/**
 * Convert form schema to legacy templateJson format for frontend compatibility
 */
function schemaToTemplateJson(schema: FormTemplateSchema) {
  const fields: Array<{ name: string; type: string; description: string }> = [];
  const assetSlots: Array<{ name: string; kind: string; description: string }> = [];

  for (const page of schema.pages) {
    for (const field of page.fields) {
      // Use the semantic description from the schema, or fall back to position-based
      const description = field.description
        || `Field at (${field.bbox.x.toFixed(0)}, ${field.bbox.y.toFixed(0)})`;

      if (field.type === "text") {
        fields.push({
          name: field.name,
          type: "string",
          description,
        });
      } else if (field.type === "image") {
        assetSlots.push({
          name: field.name,
          kind: "photo",
          description,
        });
      }
    }
  }

  return {
    id: "generated-template",
    name: "Generated Template",
    canvas: { width: 612, height: 792 },
    fields,
    assetSlots,
  };
}
