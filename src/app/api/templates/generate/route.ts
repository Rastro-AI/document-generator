import { NextRequest } from "next/server";
import { runTemplateGenerator, GeneratorTrace } from "@/lib/agents/template-generator";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for complex generation

/**
 * Convert PDF buffer to PNG image base64 using pdftoppm (poppler)
 */
async function pdfToImage(pdfBuffer: Buffer): Promise<string> {
  // Create temp files
  const tempDir = os.tmpdir();
  const tempId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);
  const pngPathBase = path.join(tempDir, tempId);

  try {
    // Write PDF to temp file
    await fs.writeFile(pdfPath, pdfBuffer);

    // Convert first page to PNG using pdftoppm (from poppler)
    // -png: output PNG format
    // -f 1 -l 1: first page only
    // -r 200: 200 DPI for good quality
    await execAsync(`pdftoppm -png -f 1 -l 1 -r 200 "${pdfPath}" "${pngPathBase}"`);

    // pdftoppm outputs with -1 suffix for single page
    const pngPath = `${pngPathBase}-1.png`;

    // Read the PNG file
    const pngBuffer = await fs.readFile(pngPath);
    const base64 = pngBuffer.toString("base64");

    // Clean up temp files
    await fs.unlink(pdfPath).catch(() => {});
    await fs.unlink(pngPath).catch(() => {});

    return `data:image/png;base64,${base64}`;
  } catch (error) {
    // Clean up on error
    await fs.unlink(pdfPath).catch(() => {});
    throw new Error(`PDF conversion failed: ${error}`);
  }
}

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

    // Convert PDF to image (first page only for now)
    const arrayBuffer = await file.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    let imageBase64: string;
    try {
      imageBase64 = await pdfToImage(pdfBuffer);
    } catch (conversionError) {
      console.error("PDF conversion error:", conversionError);
      return new Response(
        JSON.stringify({ error: "Failed to convert PDF to image", details: String(conversionError) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

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
          imageBase64,
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
