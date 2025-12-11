import { NextRequest } from "next/server";
import { runTemplateGeneratorAgent, GeneratorTrace } from "@/lib/agents/template-generator";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

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

// Build chromium pack URL - use production URL to avoid auth on preview deployments
function getChromiumPackUrl(): string {
  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prodUrl) {
    const url = `https://${prodUrl}/chromium-pack.tar`;
    log.info(`Using production URL for chromium: ${url}`);
    return url;
  }
  log.info(`No VERCEL_PROJECT_PRODUCTION_URL, using localhost`);
  return "http://localhost:3000/chromium-pack.tar";
}

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for complex generation

/**
 * Convert PDF buffer to PNG image using Puppeteer + PDF.js
 * Renders PDF in an HTML page using Mozilla's PDF.js library
 */
async function pdfToImages(pdfBuffer: Buffer): Promise<string[]> {
  const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
  log.info(`pdfToImages starting`, { isServerless, pdfSize: pdfBuffer.length });

  let browser;
  try {
    log.info(`Launching Puppeteer...`);
    const launchStart = Date.now();

    if (isServerless) {
      const chromiumPackUrl = getChromiumPackUrl();
      log.info(`Serverless mode: fetching chromium pack from ${chromiumPackUrl}`);
      const execPath = await chromium.executablePath(chromiumPackUrl);
      log.info(`Chromium executable path: ${execPath}`);

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

    // Set viewport for US Letter at 2x scale
    await page.setViewport({ width: 1632, height: 2112, deviceScaleFactor: 1 });
    log.info(`Viewport set to 1632x2112`);

    // Convert PDF to base64 for embedding
    const pdfBase64 = pdfBuffer.toString("base64");
    log.info(`PDF converted to base64`, { base64Length: pdfBase64.length });

    // Create HTML page that uses PDF.js to render the PDF
    const html = `
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    body { background: white; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="pdf-canvas"></canvas>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const pdfData = atob('${pdfBase64}');
    const pdfArray = new Uint8Array(pdfData.length);
    for (let i = 0; i < pdfData.length; i++) {
      pdfArray[i] = pdfData.charCodeAt(i);
    }

    pdfjsLib.getDocument({ data: pdfArray }).promise.then(function(pdf) {
      console.log('PDF loaded, pages:', pdf.numPages);
      return pdf.getPage(1);
    }).then(function(page) {
      const scale = 2;
      const viewport = page.getViewport({ scale });

      const canvas = document.getElementById('pdf-canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      console.log('Rendering page at', viewport.width, 'x', viewport.height);

      return page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;
    }).then(function() {
      console.log('PDF_RENDER_COMPLETE');
    }).catch(function(error) {
      console.error('PDF render error:', error);
    });
  </script>
</body>
</html>`;

    log.info(`Setting HTML content with PDF.js...`);
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

    // Wait for PDF.js to finish rendering
    log.info(`Waiting for PDF render to complete...`);
    await page.waitForFunction(
      () => {
        const canvas = document.getElementById("pdf-canvas") as HTMLCanvasElement;
        return canvas && canvas.width > 0 && canvas.height > 0;
      },
      { timeout: 30000 }
    );

    // Also wait for our completion log message
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const checkLogs = setInterval(() => {
          // Give PDF.js a moment to finish
          setTimeout(() => {
            clearInterval(checkLogs);
            resolve();
          }, 500);
        }, 100);
      });
    });

    log.info(`PDF rendered, taking screenshot...`);

    // Get canvas dimensions and resize viewport if needed
    const canvasDims = await page.evaluate(() => {
      const canvas = document.getElementById("pdf-canvas") as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });
    log.info(`Canvas dimensions: ${canvasDims.width}x${canvasDims.height}`);

    await page.setViewport({
      width: canvasDims.width,
      height: canvasDims.height,
      deviceScaleFactor: 1
    });

    const screenshot = await page.screenshot({ type: "png", fullPage: true });
    log.info(`Screenshot taken, size: ${screenshot.length} bytes`);

    const images = [`data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`];

    await browser.close();
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
