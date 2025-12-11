/**
 * Test PDF to PNG conversion using Puppeteer + PDF.js
 * Run with: npx tsx scripts/test-pdf-to-png.ts
 */

import puppeteer from "puppeteer-core";
import fs from "fs/promises";
import path from "path";

async function testPdfToPng() {
  console.log("=== PDF to PNG Test ===\n");

  // Find a test PDF
  const testPdfPath = path.join(process.cwd(), "templates/generated-template/original.pdf");

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await fs.readFile(testPdfPath);
    console.log(`Loaded test PDF: ${testPdfPath}`);
    console.log(`PDF size: ${pdfBuffer.length} bytes\n`);
  } catch {
    console.error(`Could not find test PDF at ${testPdfPath}`);
    console.log("Please provide a PDF file to test with.");
    process.exit(1);
  }

  console.log("Launching Chrome...");
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  console.log("Browser launched\n");

  const page = await browser.newPage();

  // Listen for console messages
  page.on("console", (msg) => console.log(`[Browser] ${msg.text()}`));
  page.on("pageerror", (err) => console.error(`[Browser Error] ${err}`));

  // Convert PDF to base64
  const pdfBase64 = pdfBuffer.toString("base64");
  console.log(`PDF converted to base64: ${pdfBase64.length} chars\n`);

  // Create HTML with PDF.js
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: white; }
    #pdf-canvas { display: block; }
    #status { position: fixed; top: 10px; left: 10px; background: rgba(0,0,0,0.7); color: white; padding: 5px 10px; font-family: monospace; font-size: 12px; z-index: 1000; }
  </style>
</head>
<body>
  <div id="status">Loading PDF.js...</div>
  <canvas id="pdf-canvas"></canvas>
  <script>
    const statusEl = document.getElementById('status');
    function setStatus(msg) {
      statusEl.textContent = msg;
      console.log('[PDF.js] ' + msg);
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    setStatus('Decoding PDF data...');

    const pdfBase64 = '${pdfBase64}';
    const pdfData = atob(pdfBase64);
    const pdfArray = new Uint8Array(pdfData.length);
    for (let i = 0; i < pdfData.length; i++) {
      pdfArray[i] = pdfData.charCodeAt(i);
    }

    setStatus('Loading PDF document...');

    pdfjsLib.getDocument({ data: pdfArray }).promise
      .then(function(pdf) {
        setStatus('PDF loaded, ' + pdf.numPages + ' page(s). Getting page 1...');
        window.pdfLoaded = true;
        window.pdfNumPages = pdf.numPages;
        return pdf.getPage(1);
      })
      .then(function(page) {
        setStatus('Got page 1, calculating viewport...');

        const scale = 2.0;
        const viewport = page.getViewport({ scale: scale });

        const canvas = document.getElementById('pdf-canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        setStatus('Rendering at ' + viewport.width + 'x' + viewport.height + '...');

        return page.render({
          canvasContext: context,
          viewport: viewport
        }).promise;
      })
      .then(function() {
        setStatus('RENDER_COMPLETE');
        window.renderComplete = true;
        statusEl.style.display = 'none';
      })
      .catch(function(error) {
        setStatus('ERROR: ' + error.message);
        console.error('[PDF.js] Error:', error);
        window.renderError = error.message;
      });
  </script>
</body>
</html>`;

  console.log("Setting HTML content...");
  await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("HTML content set, waiting for PDF.js to render...\n");

  // Wait for render
  const renderResult = await page.evaluate(() => {
    return new Promise<{ success: boolean; error?: string; width?: number; height?: number }>((resolve) => {
      const startTime = Date.now();
      const timeout = 30000;

      const checkRender = setInterval(() => {
        if ((window as unknown as { renderComplete?: boolean }).renderComplete) {
          clearInterval(checkRender);
          const canvas = document.getElementById('pdf-canvas') as HTMLCanvasElement;
          resolve({
            success: true,
            width: canvas?.width || 0,
            height: canvas?.height || 0
          });
        } else if ((window as unknown as { renderError?: string }).renderError) {
          clearInterval(checkRender);
          resolve({
            success: false,
            error: (window as unknown as { renderError?: string }).renderError
          });
        } else if (Date.now() - startTime > timeout) {
          clearInterval(checkRender);
          resolve({
            success: false,
            error: 'Timeout waiting for PDF render'
          });
        }
      }, 100);
    });
  });

  if (!renderResult.success) {
    console.error(`\n❌ Render failed: ${renderResult.error}`);
    await browser.close();
    process.exit(1);
  }

  console.log(`\n✅ PDF rendered successfully!`);
  console.log(`   Canvas size: ${renderResult.width}x${renderResult.height}\n`);

  // Resize viewport
  await page.setViewport({
    width: renderResult.width || 1632,
    height: renderResult.height || 2112,
    deviceScaleFactor: 1
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  // Take screenshot
  console.log("Taking screenshot...");
  const screenshot = await page.screenshot({ type: "png", fullPage: true });
  console.log(`Screenshot taken: ${screenshot.length} bytes\n`);

  // Save to file
  const outputPath = path.join(process.cwd(), ".test-output/pdf-to-png-test.png");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, screenshot);
  console.log(`✅ Screenshot saved to: ${outputPath}`);

  await browser.close();
  console.log("\n=== Test Complete ===");
}

testPdfToPng().catch(console.error);
