/**
 * Shared Template Renderer Utility
 * Compiles and renders @react-pdf/renderer templates to PDF/PNG
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

const execAsync = promisify(exec);

// Chromium pack URL for serverless (downloads once per cold start, cached in /tmp)
// https://github.com/Sparticuz/chromium/releases
const CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v143.0.0/chromium-v143.0.0-pack.x64.tar";

// Helper to launch Puppeteer with correct Chrome for environment
async function launchBrowser() {
  const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
  return puppeteer.launch({
    args: isServerless ? chromium.args : ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath: isServerless
      ? await chromium.executablePath(CHROMIUM_PACK_URL)
      : process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "/usr/bin/google-chrome",
    headless: true,
  });
}

// Logger for template renderer
const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [template-renderer] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [template-renderer] ERROR: ${msg}`, data !== undefined ? data : "");
  },
  debug: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [template-renderer] DEBUG: ${msg}`, data !== undefined ? data : "");
  },
};

export interface RenderResult {
  success: boolean;
  pngBase64?: string;
  pdfBuffer?: Buffer;
  error?: string;
}

export interface RenderOptions {
  fields?: Record<string, unknown>;
  assets?: Record<string, string>;
  templateRoot?: string;
  outputFormat?: "png" | "pdf" | "both";
  dpi?: number;
}

// Allowed imports for templates
const ALLOWED_IMPORTS = ["react", "@react-pdf/renderer"];

// Known bad module names that models generate
const FORBIDDEN_MODULES = ["unknown", "path", "fs", "os", "child_process", "util", "crypto"];

/**
 * Validate template code for common issues before compilation
 */
function validateTemplateCode(code: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for import statements with invalid modules: import X from 'module'
  const importFromRegex = /import\s+.*?\s+from\s+["']([^"']+)["']/g;
  let match;
  while ((match = importFromRegex.exec(code)) !== null) {
    const moduleName = match[1];
    if (!ALLOWED_IMPORTS.includes(moduleName)) {
      errors.push(`Invalid import: "${moduleName}". Only ${ALLOWED_IMPORTS.join(", ")} are allowed.`);
    }
  }

  // Check for side-effect imports: import 'module'
  const sideEffectImportRegex = /import\s+["']([^"']+)["']/g;
  while ((match = sideEffectImportRegex.exec(code)) !== null) {
    const moduleName = match[1];
    if (!ALLOWED_IMPORTS.includes(moduleName)) {
      errors.push(`Invalid side-effect import: "${moduleName}". Only ${ALLOWED_IMPORTS.join(", ")} are allowed.`);
    }
  }

  // Check for dynamic imports: import('module')
  const dynamicImportRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicImportRegex.exec(code)) !== null) {
    const moduleName = match[1];
    errors.push(`Dynamic imports not allowed: import("${moduleName}"). Use static imports from ${ALLOWED_IMPORTS.join(", ")} only.`);
  }

  // Check for require statements
  const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = requireRegex.exec(code)) !== null) {
    const moduleName = match[1];
    errors.push(`Do not use require("${moduleName}"). Use ES6 imports from ${ALLOWED_IMPORTS.join(", ")} only.`);
  }

  // Check for forbidden module names anywhere in the code (catches edge cases)
  for (const forbidden of FORBIDDEN_MODULES) {
    const forbiddenRegex = new RegExp(`from\\s+["']${forbidden}["']|require\\s*\\(\\s*["']${forbidden}["']`, "g");
    if (forbiddenRegex.test(code)) {
      errors.push(`Forbidden module "${forbidden}" detected. Only ${ALLOWED_IMPORTS.join(", ")} are allowed.`);
    }
  }

  // Check for Font import (common mistake)
  if (code.includes("Font.register") || /import\s+.*Font.*from\s+["']@react-pdf\/renderer["']/.test(code)) {
    errors.push("Do not use Font.register or import Font. Use fontFamily: 'Helvetica' instead (built-in font).");
  }

  // Check for missing render function export
  if (!code.includes("export function render") && !code.includes("export const render")) {
    errors.push("Template must export a render function: export function render(fields, assets, templateRoot)");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Compile and render template code to PDF/PNG
 */
export async function renderTemplateCode(
  templateCode: string,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const {
    fields = {},
    assets = {},
    templateRoot = path.join(process.cwd(), "templates", "sunco-spec-v1"),
    outputFormat = "png",
    dpi = 150,
  } = options;

  // Use a temp directory inside the project so compiled code can resolve node_modules
  const tempDir = path.join(process.cwd(), ".template-cache");
  const tempId = `render_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const templatePath = path.join(tempDir, `${tempId}.tsx`);
  const compiledPath = path.join(tempDir, `${tempId}.js`);
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);
  const pngPathBase = path.join(tempDir, tempId);

  // Ensure temp directory exists
  await fs.mkdir(tempDir, { recursive: true });

  const cleanup = async () => {
    const files = [templatePath, compiledPath, pdfPath, `${pngPathBase}-1.png`];
    for (const f of files) {
      await fs.unlink(f).catch(() => {});
    }
  };

  try {
    log.info("Starting template render", { tempId, outputFormat, dpi });
    log.debug("Template code length", templateCode.length);

    // Validate template code before compilation
    log.info("Validating template code...");
    const validation = validateTemplateCode(templateCode);
    if (!validation.valid) {
      log.error("Template validation failed", validation.errors);
      await cleanup();
      return {
        success: false,
        error: `Template validation failed:\n${validation.errors.join("\n")}`,
      };
    }
    log.info("Template validation passed");

    // Write template to temp file
    log.info("Writing template to temp file", templatePath);
    await fs.writeFile(templatePath, templateCode);

    // Compile with esbuild - bundle everything so the output is self-contained
    // No external modules means the compiled file doesn't need to resolve anything at runtime
    log.info("Compiling template with esbuild...");
    const esbuildPath = path.join(process.cwd(), "node_modules", ".bin", "esbuild");
    const esbuildCmd = `"${esbuildPath}" "${templatePath}" --bundle --platform=node --outfile="${compiledPath}" --format=cjs --jsx=automatic --loader:.tsx=tsx`;
    log.debug("esbuild command", esbuildCmd);
    try {
      const { stdout, stderr } = await execAsync(esbuildCmd);
      if (stdout) log.debug("esbuild stdout", stdout);
      if (stderr) log.debug("esbuild stderr", stderr);
      log.info("Compilation successful", compiledPath);
    } catch (compileError) {
      log.error("Compilation failed", compileError);
      await cleanup();
      return {
        success: false,
        error: `Compilation failed: ${compileError}`,
      };
    }

    // Import and render the self-contained bundle
    try {
      log.info("Loading compiled template module...");
      // Use eval to completely bypass webpack's static analysis
      // eslint-disable-next-line no-eval
      const dynamicRequire = eval("require") as NodeRequire;
      delete dynamicRequire.cache[dynamicRequire.resolve(compiledPath)];
      const templateModule = dynamicRequire(compiledPath);

      // Debug: log if require succeeded but module is malformed
      if (!templateModule) {
        log.error("Template module is null/undefined");
      }
      const renderFn = templateModule.render || templateModule.default?.render;
      log.debug("Module exports", Object.keys(templateModule || {}));

      if (!renderFn) {
        log.error("No render function exported from template");
        await cleanup();
        return {
          success: false,
          error: "Template must export a render function",
        };
      }
      log.info("Found render function, executing...");

      log.debug("Render inputs", { fieldCount: Object.keys(fields).length, assetCount: Object.keys(assets).length, templateRoot });
      const { renderToFile } = await import("@react-pdf/renderer");
      const document = renderFn(fields, assets, templateRoot);
      log.info("Render function executed, generating PDF...");
      await renderToFile(document, pdfPath);
      log.info("PDF generated", pdfPath);

      // Always generate both PDF and PNG for model feedback
      log.info("Reading PDF buffer...");
      const pdfBuffer = await fs.readFile(pdfPath);
      log.debug("PDF buffer size", pdfBuffer.length);

      log.info("Converting PDF to PNG using Puppeteer...");
      const pngBase64 = await pdfToPng(pdfBuffer, dpi);
      log.info("PNG generated", { base64Length: pngBase64.length });

      await cleanup();
      log.info("Template render complete - SUCCESS");

      return {
        success: true,
        pngBase64,
        pdfBuffer,
      };
    } catch (renderError) {
      const errorMessage = renderError instanceof Error ? renderError.message : String(renderError);
      log.error("Render execution failed", errorMessage);

      // Write full template code to debug file for inspection
      const debugPath = path.join(process.cwd(), "debug-template.txt");
      await fs.writeFile(debugPath, templateCode).catch(() => {});
      log.error("Full template code written to debug file", debugPath);

      await cleanup();
      return {
        success: false,
        error: `Render failed: ${errorMessage}`,
      };
    }
  } catch (error) {
    log.error("Unexpected error during template render", error);
    await cleanup();
    return {
      success: false,
      error: `Unexpected error: ${error}`,
    };
  }
}

/**
 * Convert PDF buffer to PNG base64 using Puppeteer
 */
export async function pdfToPng(pdfBuffer: Buffer, _dpi: number = 200): Promise<string> {
  const tempDir = os.tmpdir();
  const tempId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);

  let browser;
  try {
    await fs.writeFile(pdfPath, pdfBuffer);

    // Launch Puppeteer with correct Chrome for environment
    browser = await launchBrowser();

    const page = await browser.newPage();
    await page.goto(`file://${pdfPath}`, { waitUntil: "networkidle0" });
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });

    const screenshot = await page.screenshot({ type: "png", fullPage: false });

    await browser.close();
    await fs.unlink(pdfPath).catch(() => {});

    return `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`;
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    await fs.unlink(pdfPath).catch(() => {});
    throw new Error(`PDF conversion failed: ${error}`);
  }
}
