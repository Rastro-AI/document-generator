import { NextRequest } from "next/server";
import { runTemplateGeneratorAgent, GeneratorTrace } from "@/lib/agents/template-generator";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import path from "path";
import fs from "fs/promises";
import os from "os";

// Path to bundled chromium brotli files (included in repo for Vercel deployment)
const CHROMIUM_PACK_PATH = path.join(process.cwd(), "bin", "chromium-pack");

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
 * Convert PDF buffer to PNG image base64 using Puppeteer
 * Only converts the first page - multi-page PDFs are not supported
 */
async function pdfToImages(pdfBuffer: Buffer): Promise<string[]> {
  const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
  log.info(`pdfToImages starting`, { isServerless, pdfSize: pdfBuffer.length });

  let browser;
  try {
    // Launch browser
    log.info(`Launching Puppeteer...`);
    const launchStart = Date.now();

    if (isServerless) {
      log.info(`Serverless mode: using bundled chromium pack at ${CHROMIUM_PACK_PATH}`);
      const execPath = await chromium.executablePath(CHROMIUM_PACK_PATH);
      log.info(`Chromium executable path: ${execPath}`);
      log.info(`Chromium args: ${JSON.stringify(chromium.args)}`);

      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: execPath,
        headless: true,
      });
    } else {
      const localChrome = process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/google-chrome";
      log.info(`Local mode: using Chrome at ${localChrome}`);

      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath: localChrome,
        headless: true,
      });
    }

    log.info(`Browser launched in ${Date.now() - launchStart}ms`);

    const page = await browser.newPage();
    log.info(`New page created`);

    // Listen for console messages and errors
    page.on("console", (msg) => log.info(`Browser console [${msg.type()}]: ${msg.text()}`));
    page.on("pageerror", (err) => log.error(`Browser page error: ${String(err)}`));
    page.on("requestfailed", (req) => {
      log.error(`Request failed: ${req.url()}`, {
        failure: req.failure()?.errorText,
        resourceType: req.resourceType(),
      });
    });

    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
    log.info(`Viewport set`);

    // Write PDF to /tmp and load via file:// protocol
    const tempDir = os.tmpdir();
    const tempPdfPath = path.join(tempDir, `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
    await fs.writeFile(tempPdfPath, pdfBuffer);
    log.info(`PDF written to ${tempPdfPath}`);

    const pdfUrl = `file://${tempPdfPath}`;
    log.info(`Navigating to ${pdfUrl}...`);
    const navStart = Date.now();

    const response = await page.goto(pdfUrl, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });

    log.info(`Navigation complete in ${Date.now() - navStart}ms`, {
      status: response?.status(),
      ok: response?.ok(),
      url: response?.url()?.substring(0, 100),
    });

    // Take screenshot
    log.info(`Taking screenshot...`);
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    log.info(`Screenshot taken, size: ${screenshot.length} bytes`);

    const images = [`data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`];

    await browser.close();
    await fs.unlink(tempPdfPath).catch(() => {}); // Clean up temp file
    log.info(`Browser closed, returning ${images.length} image(s)`);

    return images;
  } catch (error) {
    const err = error as Error;
    log.error(`pdfToImages failed`, {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    if (browser) await browser.close().catch(() => {});
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
