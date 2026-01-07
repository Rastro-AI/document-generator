/**
 * Satori Template Generator Agent
 * Creates multi-page Satori document templates with {{FIELD}} placeholders from PDF analysis
 * LLM analyzes PDF visually and creates JSX pages from scratch
 */

import {
  Agent,
  Runner,
  tool,
  setDefaultModelProvider,
} from "@openai/agents-core";
import { OpenAIProvider } from "@openai/agents-openai";
import { z } from "zod";
import { renderSatoriDocument, SatoriDocument } from "@/lib/satori-renderer";
import { SATORI_DOCUMENT_PROMPT } from "@/lib/prompts/satori-document";
import type { SatoriPageContent } from "@/lib/types";
import sharp from "sharp";

// Logger for template generator
const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [satori-template-generator] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [satori-template-generator] ERROR: ${msg}`, data !== undefined ? data : "");
  },
  debug: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [satori-template-generator] DEBUG: ${msg}`, data !== undefined ? data : "");
  },
};

// Maximum image dimension for OpenAI API
// Using detail: "high" for better quality comparison
const MAX_IMAGE_DIMENSION = 1536;

/**
 * Resize a base64 data URL image to max dimension while preserving aspect ratio
 * Returns the resized image as a base64 data URL
 */
async function resizeImageDataUrl(dataUrl: string, label: string): Promise<string> {
  try {
    // Extract base64 data
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) {
      log.error(`[RESIZE] ${label}: no comma separator, returning original`);
      return dataUrl;
    }
    const base64Data = dataUrl.substring(commaIdx + 1);
    const mimeMatch = dataUrl.match(/^data:(image\/\w+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/png";

    // Decode and get metadata
    const inputBuffer = Buffer.from(base64Data, "base64");
    const metadata = await sharp(inputBuffer).metadata();

    if (!metadata.width || !metadata.height) {
      log.error(`[RESIZE] ${label}: couldn't get dimensions, returning original`);
      return dataUrl;
    }

    // Check if resizing is needed
    const maxDim = Math.max(metadata.width, metadata.height);
    if (maxDim <= MAX_IMAGE_DIMENSION) {
      log.info(`[RESIZE] ${label}: ${metadata.width}x${metadata.height} already within limit`);
      return dataUrl;
    }

    // Calculate new dimensions
    const scale = MAX_IMAGE_DIMENSION / maxDim;
    const newWidth = Math.round(metadata.width * scale);
    const newHeight = Math.round(metadata.height * scale);

    // Resize and convert to JPEG for smaller file size
    const resizedBuffer = await sharp(inputBuffer)
      .resize(newWidth, newHeight, { fit: "inside" })
      .jpeg({ quality: 80 })
      .toBuffer();

    const resizedBase64 = resizedBuffer.toString("base64");
    log.info(`[RESIZE] ${label}: ${metadata.width}x${metadata.height} -> ${newWidth}x${newHeight} (${base64Data.length} -> ${resizedBase64.length} chars, ~${Math.round(resizedBase64.length / base64Data.length * 100)}% of original)`);

    return `data:image/jpeg;base64,${resizedBase64}`;
  } catch (e) {
    log.error(`[RESIZE] ${label}: resize failed, returning original`, e);
    return dataUrl;
  }
}

/**
 * Validate HTML/JSX for common Satori issues BEFORE rendering.
 * Returns array of issues found, empty if valid.
 *
 * Works with both HTML (style="...") and JSX (style={{...}}) formats.
 * Supported elements: div, span, p, img, svg (and svg children)
 */
function validateSatoriHtml(html: string): string[] {
  const issues: string[] = [];

  // Check for unsupported elements
  // Satori supports: div, span, p, img, svg
  const unsupportedElements = ["<table", "<ul", "<ol", "<li", "<a ", "<a>", "<input", "<button", "<form", "<select", "<textarea"];
  for (const elem of unsupportedElements) {
    if (html.includes(elem)) {
      const tag = elem.replace("<", "").replace(" ", "").replace(">", "");
      issues.push(`Unsupported element <${tag}> found - use div/span/p instead`);
    }
  }

  // Check for unsupported CSS (works for both HTML and JSX style formats)
  const unsupportedCss = [
    { pattern: /display:\s*['"]?grid/i, msg: "display: grid not supported - use flexbox" },
    { pattern: /display:\s*['"]?table/i, msg: "display: table not supported - use flexbox" },
    { pattern: /position:\s*['"]?fixed/i, msg: "position: fixed not supported - use relative or absolute" },
    { pattern: /position:\s*['"]?sticky/i, msg: "position: sticky not supported - use relative or absolute" },
    { pattern: /calc\(/i, msg: "calc() not supported - use fixed pixel values" },
    { pattern: /var\(--/i, msg: "CSS variables (var()) not supported" },
    { pattern: /hsl\(/i, msg: "HSL colors not supported - use hex or rgb/rgba" },
  ];
  for (const { pattern, msg } of unsupportedCss) {
    if (pattern.test(html)) {
      issues.push(msg);
    }
  }

  // CRITICAL: Check for embedded base64 data URLs - these bloat the SVG and crash resvg
  const dataUrlMatches = html.match(/data:image\/[^"']+/g) || [];
  if (dataUrlMatches.length > 0) {
    issues.push(`Found ${dataUrlMatches.length} embedded data:image URL(s) - NEVER use base64 data URLs! Use {{ASSET_PLACEHOLDER}} instead (e.g., {{PRODUCT_IMAGE}}, {{LOGO}})`);
  }

  // Check for img tags without width/height attributes
  // Supports both HTML (width="200") and JSX (width={200}) formats
  const imgMatches = html.matchAll(/<img[^>]*>/g);
  for (const match of imgMatches) {
    const imgTag = match[0];
    const hasWidthAttr = /width=["']\d+["']/.test(imgTag) || /width=\{?\d+\}?/.test(imgTag);
    const hasHeightAttr = /height=["']\d+["']/.test(imgTag) || /height=\{?\d+\}?/.test(imgTag);
    if (!hasWidthAttr || !hasHeightAttr) {
      issues.push("<img> tag missing width and/or height attributes (must be attributes, not just style)");
      break; // Only report once
    }
  }

  return issues;
}

// Keep old name as alias for backward compatibility
const validateSatoriJsx = validateSatoriHtml;

// Helper to validate image data URL format
function validateImageDataUrl(dataUrl: string, label: string): boolean {
  if (!dataUrl) {
    log.error(`[VALIDATION] ${label}: empty or null`);
    return false;
  }
  if (!dataUrl.startsWith("data:image/")) {
    log.error(`[VALIDATION] ${label}: doesn't start with data:image/, starts with "${dataUrl.substring(0, 30)}"`);
    return false;
  }
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) {
    log.error(`[VALIDATION] ${label}: no comma separator found`);
    return false;
  }
  const base64Part = dataUrl.substring(commaIdx + 1);
  if (base64Part.length < 100) {
    log.error(`[VALIDATION] ${label}: base64 part too short (${base64Part.length} chars)`);
    return false;
  }
  // Check for valid base64 characters
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  if (!base64Regex.test(base64Part)) {
    const invalidChars = base64Part.match(/[^A-Za-z0-9+/=]/g);
    log.error(`[VALIDATION] ${label}: invalid base64 characters found: ${invalidChars?.slice(0, 5).join(", ")}`);
    return false;
  }
  log.info(`[VALIDATION] ${label}: OK (${dataUrl.length} total chars, ${base64Part.length} base64 chars)`);
  return true;
}

// Initialize the OpenAI provider
let providerInitialized = false;
function ensureProvider() {
  if (!providerInitialized) {
    const provider = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY,
    });
    setDefaultModelProvider(provider);
    providerInitialized = true;
  }
}

export interface GeneratorTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status" | "version" | "template_json";
  content: string;
  toolName?: string;
  version?: number;
  previewUrls?: string[]; // Multiple page previews
  pdfUrl?: string;
  templateJson?: TemplateJson;
  satoriPages?: SatoriPageContent[]; // Satori document pages
}

export type GeneratorEventCallback = (event: GeneratorTrace) => void;

export interface TemplateJsonField {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
  default?: unknown;
  example?: unknown;
  items?: { type: string; properties?: Record<string, { type: string; description?: string }> };
  properties?: Record<string, { type: string; description?: string }>;
}

export interface TemplateJson {
  id: string;
  name: string;
  format: "satori";
  satoriConfig?: {
    pageSize: "A4" | "LETTER" | "LEGAL";
    header?: { height: number; content: string };
    footer?: { height: number; content: string };
  };
  fields: TemplateJsonField[];
  assetSlots: Array<{ name: string; kind: string; description: string }>;
}

export interface TemplateGeneratorResult {
  success: boolean;
  templateJson?: TemplateJson;
  satoriPages?: SatoriPageContent[]; // Satori document pages
  message: string;
  versions?: Array<{ version: number; previewBase64s: string[]; pdfBase64?: string }>;
  // Full conversation history for resuming later
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversationHistory?: any[];
}

// LocalShell class removed - it was a security risk that allowed arbitrary command execution
// on the local server. The agent should use code_interpreter for code execution,
// which runs in a sandboxed container.

/**
 * System prompt for Satori template generation
 */
const SYSTEM_PROMPT = `You create document templates from images/PDFs.

${SATORI_DOCUMENT_PROMPT}

## YOUR ONLY JOB: Look at the image → Create a SIMPLIFIED template → Iterate

**Call write_satori_document IMMEDIATELY. The user is waiting.**

IMPORTANT: Create a TEMPLATE, not an exact copy. Focus on:
- Overall layout structure (header, sections, footer)
- Key placeholders for dynamic content
- Approximate colors and typography
- DON'T try to replicate every tiny detail - simplify!

## WORKFLOW
1. Look at the screenshot image provided
2. Call write_satori_document with HTML that matches the layout
3. Compare your render to the original
4. Use apply_patch for small fixes, or write_satori_document for larger changes
5. When happy, call write_template_json then mark_complete

## TOOLS
- write_satori_document: Create/replace all HTML pages → renders immediately
- apply_patch: Make small edits to a page (page1.html, page2.html, etc.) → renders after
- write_template_json: Define {{PLACEHOLDER}} fields (required before completing)
- mark_complete: Finish when template matches original

## ⚠️ CRITICAL: UNDERSTAND WHAT A TEMPLATE IS ⚠️

A template has THREE types of content:

### 1. STATIC TEXT (hardcoded labels)
Text that NEVER changes - keep as literal HTML text:
- Labels: "Voltage", "Wattage", "Specifications", "Model"
- Section headers, column names, units

### 2. TEXT PLACEHOLDERS (dynamic values)
Values that CHANGE per document - use {{PLACEHOLDER}} as TEXT:
- {{PRODUCT_NAME}} → "PAR38 LED BULB"
- {{VOLTAGE}} → "120V"
- {{WATTAGE}} → "13W"
- {{BRAND_NAME}} → "Sunco"

Example: <div style="font-size: 24px">{{PRODUCT_NAME}}</div>

### 3. IMAGE PLACEHOLDERS (photos, charts, logos)
Visual elements - use {{PLACEHOLDER}} in img src:
- {{PRODUCT_IMAGE}} → product photo
- {{CHART_IMAGE}} → distribution chart
- {{LOGO}} → company logo

Example: <img src="{{PRODUCT_IMAGE}}" width="200" height="150" />

## ⚠️ THE #1 MISTAKE TO AVOID ⚠️

DO NOT try to embed text as images!
- "120V" is TEXT → use {{VOLTAGE}} as div content
- "PAR38 LED BULB" is TEXT → use {{PRODUCT_NAME}} as div content
- A product PHOTO is an IMAGE → use <img src="{{PRODUCT_IMAGE}}">

If you see text in the PDF, recreate it as HTML text.
If you see a photo/chart/logo, use an img tag with placeholder.

## ⚠️ PAGE SIZE IS STRICTLY LIMITED - CONTENT WILL BE CUT OFF! ⚠️

The page is EXACTLY 794px wide × 1123px tall (A4 at 96 DPI).
- Content CANNOT extend beyond 1123px - it will be INVISIBLE!
- The root div MUST be: width: 794px; height: 1123px
- With 40px padding top/bottom, you have ~1043px for content
- MATCH THE REFERENCE PDF'S COMPACTNESS - look at how tight the spacing is!

**Compact layout tips:**
- Title: 28-36px (not 44px+)
- Body text: 12-14px
- Table rows: 8-10px padding (not 12-16px)
- Section gaps: 12-18px (not 24-32px)
- If reference fits, your template MUST fit - use SAME proportions

## RULES
- Estimate colors from what you see (e.g., dark blue = #1e3a5f)
- EVERY div with 2+ children MUST have display: flex (Satori requirement!)
- Use flex-direction: column for vertical stacking, default is row
- Keep total content height under 1123px (minus any header/padding)

## WRITE STANDARD HTML WITH INLINE CSS
Use style="..." with CSS properties (kebab-case like font-size, background-color).
Example:
<div style="display: flex; flex-direction: column; padding: 20px; background-color: #fff">
  <div style="font-size: 24px; font-weight: 700">{{PRODUCT_NAME}}</div>
</div>

START NOW - call write_satori_document!`;

/**
 * Extract reasoning text from a reasoning item
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractReasoningText(item: any): string | null {
  if (item.content && Array.isArray(item.content)) {
    const texts = item.content
      .filter((c: { type: string; text?: string }) => c.type === "input_text" || c.type === "reasoning_text" || c.type === "text")
      .map((c: { text: string }) => c.text)
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n");
  }
  if (item.rawContent && Array.isArray(item.rawContent)) {
    const texts = item.rawContent
      .filter((c: { type: string; text?: string }) => c.type === "reasoning_text" || c.type === "text")
      .map((c: { text: string }) => c.text)
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n");
  }
  if (item.summary && Array.isArray(item.summary)) {
    const texts = item.summary
      .map((s: { text?: string }) => s.text)
      .filter(Boolean);
    if (texts.length > 0) return texts.join("\n");
  }
  if (typeof item.text === "string") return item.text;
  return null;
}

/**
 * Run the Satori template generator agent
 */
// Brand kit types for colors and fonts
interface BrandColor {
  name: string;
  value: string;
  usage?: string;
}

interface BrandFont {
  name: string;
  family: string;
  weights: string[];
  usage?: string;
}

export async function runTemplateGeneratorAgent(
  pdfPageImages: string | string[],
  pdfFilename: string,
  pdfBuffer?: Buffer | null,
  userPrompt?: string,
  onEvent?: GeneratorEventCallback,
  reasoning: "none" | "low" | "high" = "none",
  // Continuation parameters
  existingSatoriPages?: SatoriPageContent[],
  existingJson?: TemplateJson,
  feedback?: string,
  startVersion: number = 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingConversationHistory?: any[],
  // Brand kit
  brandColors?: BrandColor[],
  brandFonts?: BrandFont[]
): Promise<TemplateGeneratorResult> {
  const pageImages = Array.isArray(pdfPageImages) ? pdfPageImages : [pdfPageImages];
  const isContinuation = !!(existingSatoriPages && existingSatoriPages.length > 0 && feedback);

  log.info(`\n${"#".repeat(80)}`);
  log.info(`### SATORI TEMPLATE GENERATOR ${isContinuation ? "CONTINUING" : "STARTED"} ###`);
  log.info(`${"#".repeat(80)}`);
  log.info(`PDF filename: ${pdfFilename}`);
  log.info(`Reasoning level: ${reasoning}`);
  log.info(`Continuation mode: ${isContinuation}`);

  ensureProvider();

  // State tracking
  const versions: Array<{ version: number; previewBase64s: string[]; pdfBase64?: string }> = [];
  let currentVersion = startVersion;
  let currentSatoriPages: SatoriPageContent[] = existingSatoriPages || [];
  let currentJson: TemplateJson | null = existingJson || null;
  let isComplete = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conversationHistory: any[] = existingConversationHistory || [];
  let lastRenderPngBase64s: string[] = [];

  // Helper to render current Satori pages and emit version event

  // Track last render error for passing back to model
  let lastRenderError: string | null = null;
  let lastRenderSucceeded = false;

  const renderCurrentVersion = async (): Promise<string[] | null> => {
    if (currentSatoriPages.length === 0) return null;
    currentVersion++;
    lastRenderError = null;
    const renderStart = Date.now();
    log.info(`\n--- RENDERING VERSION ${currentVersion} (${currentSatoriPages.length} pages) ---`);
    onEvent?.({ type: "status", content: `Rendering version ${currentVersion} (${currentSatoriPages.length} pages)...` });

    try {
      // Generate placeholder values for preview
      const fieldsForRender: Record<string, unknown> = {};
      if (currentJson) {
        for (const field of currentJson.fields) {
          if (field.type === "array") {
            fieldsForRender[field.name] = [`{{${field.name}[0]}}`, `{{${field.name}[1]}}`];
          } else {
            fieldsForRender[field.name] = `{{${field.name}}}`;
          }
        }
      }

      // Render Satori document to PNGs and PDF
      // Provide placeholder images for any asset references during generation
      // This prevents "Image source is not provided" errors from Satori
      // Scan all pages for {{ASSET_*}} or {{*_IMAGE}} patterns and provide placeholders
      const placeholderImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6QwQCjUEm/YvVwAAABl0RVh0Q29tbWVudABDcmVhdGVkIHdpdGggR0lNUFeBDhcAAABYSURBVHja7cExAQAAAMKg9U9tCy+gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4GYNTgAB/dJqXwAAAABJRU5ErkJggg=="; // 100x100 gray box
      const assetsForRender: Record<string, string> = {};

      // Scan JSX for asset placeholders - ONLY those ending with _IMAGE, _LOGO, _ICON, _PHOTO, _CHART
      // Do NOT match text placeholders like {{BRAND_NAME}}, {{VOLTAGE}}, etc.
      const allJsx = currentSatoriPages.map(p => p.body).join(" ");
      const assetMatches = allJsx.match(/\{\{([A-Z][A-Z0-9_]*(?:_IMAGE|_LOGO|_ICON|_PHOTO|_CHART))\}\}/g);
      if (assetMatches) {
        for (const match of assetMatches) {
          const assetName = match.slice(2, -2); // Remove {{ and }}
          if (!assetsForRender[assetName]) {
            assetsForRender[assetName] = placeholderImage;
          }
        }
      }

      // Also add any defined asset slots
      if (currentJson?.assetSlots) {
        for (const slot of currentJson.assetSlots) {
          if (!assetsForRender[slot.name]) {
            assetsForRender[slot.name] = placeholderImage;
          }
        }
      }

      const satoriDoc: SatoriDocument = {
        pageSize: currentJson?.satoriConfig?.pageSize || "A4",
        header: currentJson?.satoriConfig?.header,
        footer: currentJson?.satoriConfig?.footer,
        pages: currentSatoriPages,
      };

      const result = await renderSatoriDocument(satoriDoc, fieldsForRender, assetsForRender);

      // Convert all PNGs to base64
      const pngBase64s = result.pngBuffers.map(buf => `data:image/png;base64,${buf.toString("base64")}`);
      const pdfBase64 = `data:application/pdf;base64,${result.pdfBuffer.toString("base64")}`;

      const renderDuration = Date.now() - renderStart;
      log.info(`VERSION ${currentVersion} RENDER SUCCESS in ${renderDuration}ms - ${pngBase64s.length} pages, PDF size: ${result.pdfBuffer.length} bytes`);
      versions.push({ version: currentVersion, previewBase64s: pngBase64s, pdfBase64 });
      lastRenderSucceeded = true;
      lastRenderPngBase64s = pngBase64s;

      // Emit version event with all page previews
      onEvent?.({
        type: "version",
        content: `Version ${currentVersion} rendered (${pngBase64s.length} pages)`,
        version: currentVersion,
        previewUrls: pngBase64s,
        pdfUrl: pdfBase64,
        satoriPages: currentSatoriPages,
      });

      return pngBase64s;
    } catch (renderError) {
      const errorMsg = renderError instanceof Error ? renderError.message : String(renderError);
      lastRenderError = errorMsg;
      lastRenderSucceeded = false;
      log.error(`VERSION ${currentVersion} RENDER FAILED`, renderError);
      onEvent?.({ type: "status", content: `Render failed: ${errorMsg}` });
      currentVersion--; // Rollback version number on failure
      return null;
    }
  };

  try {
    // Status update
    onEvent?.({ type: "status", content: isContinuation ? "Applying feedback..." : "Starting generation..." });
    log.info(isContinuation ? "Continuing with feedback" : "Starting fresh generation");

    // Create Satori document tools
    const writeSatoriDocumentTool = tool({
      name: "write_satori_document",
      description: "Create or replace the Satori document pages. Each page is a JSX string that will be rendered with flexbox layout. The rendered preview images will be returned to you.",
      parameters: z.object({
        pages: z.array(z.object({
          body: z.string().describe("JSX string for the page body content"),
          headerOverride: z.string().nullable().describe("JSX to override the default header for this page (null to use default)"),
          footerOverride: z.string().nullable().describe("JSX to override the default footer for this page (null to use default)"),
        })).describe("Array of page objects with body JSX content"),
      }),
      execute: async ({ pages }) => {
        onEvent?.({ type: "tool_call", content: `Writing Satori document (${pages.length} pages)`, toolName: "write_satori_document" });
        log.info(`write_satori_document: ${pages.length} pages`);

        // PRE-VALIDATION: Check JSX for common issues BEFORE rendering
        const allIssues: string[] = [];
        for (let i = 0; i < pages.length; i++) {
          const jsx = pages[i].body;
          const preview = jsx.substring(0, 500);
          log.info(`[JSX PAGE ${i + 1}] (${jsx.length} chars): ${preview}...`);

          // Run validation
          const issues = validateSatoriJsx(jsx);
          if (issues.length > 0) {
            log.info(`[JSX PAGE ${i + 1}] Validation issues: ${issues.join("; ")}`);
            allIssues.push(...issues.map(iss => `Page ${i + 1}: ${iss}`));
          }
        }

        // If pre-validation found issues, return them without rendering
        if (allIssues.length > 0) {
          log.info(`[PRE-VALIDATION FAILED] ${allIssues.length} issues found`);
          return `VALIDATION FAILED - Fix these issues before rendering:

${allIssues.map(iss => `- ${iss}`).join("\n")}

REMEMBER:
- Root div MUST use pixel dimensions: width: 794, height: 1123 (for A4)
- Use flexDirection: 'column' for vertical stacking (Satori defaults to flex)
- No unsupported elements (table, ul, li, a) or CSS (grid, calc, var(), hsl)

Fix and call write_satori_document again.`;
        }

        currentSatoriPages = pages;

        // Render immediately after write
        const pngBase64s = await renderCurrentVersion();

        if (!pngBase64s) {
          // Provide specific error guidance based on common issues
          const errorDetail = lastRenderError ? `\n\nSATORI ERROR: ${lastRenderError}` : "";
          return `Satori document written with ${pages.length} pages but RENDER FAILED.${errorDetail}

Check your JSX and ensure:
1. Use flexDirection: 'column' for vertical stacking (Satori defaults to flex)
2. No unsupported CSS (grid, calc, var(), hsl colors)
3. All <img> tags have width AND height attributes (not just style)
4. No unsupported elements (table, ul, li, a)

Fix the JSX and call write_satori_document again.`;
        }

        // Estimate content height to warn about potential overflow
        // A4 is 1123px tall. With typical padding (40px top/bottom), usable height is ~1043px
        // Rough heuristic: count major sections and estimate heights
        const warnings: string[] = [];
        for (let i = 0; i < pages.length; i++) {
          const html = pages[i].body;
          const sectionCount = (html.match(/<div[^>]*font-size:\s*(2[0-9]|3[0-9])px/gi) || []).length;
          const rowCount = (html.match(/display:\s*flex[^}]*border/gi) || []).length;
          const imgCount = (html.match(/<img[^>]+height=["']?(\d+)/gi) || []).length;

          // Very rough estimate: sections ~60px, rows ~45px each, images vary
          const estimatedHeight = (sectionCount * 60) + (rowCount * 45);
          if (estimatedHeight > 900 || rowCount > 18 || sectionCount > 8) {
            warnings.push(`Page ${i + 1}: May overflow! (~${sectionCount} sections, ~${rowCount} table rows). Consider: smaller fonts (12-14px), less padding, fewer sections, or split into multiple pages.`);
          }
        }

        // Return render result with images inline for model to see
        const pageDescriptions = pngBase64s.map((_, i) => `Page ${i + 1}`).join(", ");
        const warningText = warnings.length > 0 ? `\n\n⚠️ OVERFLOW WARNING:\n${warnings.join("\n")}` : "";
        return `Satori document written and rendered as V${currentVersion}. ${pngBase64s.length} page(s) rendered: ${pageDescriptions}. Check the rendered images above and use write_satori_document again to fix any issues.${warningText}`;
      },
    });

    // Apply patch tool for incremental edits
    const applyPatchTool = tool({
      name: "apply_patch",
      description: "Make a small edit to a page by replacing a specific string. Use page1.jsx, page2.jsx etc. Faster than rewriting entire page. Triggers a render after the edit.",
      parameters: z.object({
        file: z.string().describe("The file to edit: page1.jsx, page2.jsx, etc."),
        old_string: z.string().describe("The exact string to find and replace (must match exactly)"),
        new_string: z.string().describe("The replacement string"),
      }),
      execute: async ({ file, old_string, new_string }) => {
        onEvent?.({ type: "tool_call", content: `Patching ${file}`, toolName: "apply_patch" });
        log.info(`apply_patch: ${file}, replacing ${old_string.length} chars with ${new_string.length} chars`);

        // Parse page number from filename
        const match = file.match(/page(\d+)\.jsx/);
        if (!match) {
          return `Error: Invalid file name "${file}". Use page1.jsx, page2.jsx, etc.`;
        }
        const pageIndex = parseInt(match[1], 10) - 1;

        if (pageIndex < 0 || pageIndex >= currentSatoriPages.length) {
          return `Error: Page ${pageIndex + 1} doesn't exist. Current pages: ${currentSatoriPages.length}`;
        }

        const currentBody = currentSatoriPages[pageIndex].body;

        if (!currentBody.includes(old_string)) {
          // Show context to help debug
          const preview = currentBody.substring(0, 300);
          return `Error: Could not find the old_string in ${file}. Make sure it matches exactly.\n\nPage starts with:\n${preview}...`;
        }

        // Apply the replacement
        const newBody = currentBody.replace(old_string, new_string);
        currentSatoriPages[pageIndex] = {
          ...currentSatoriPages[pageIndex],
          body: newBody,
        };

        // Validate
        const issues = validateSatoriJsx(newBody);
        if (issues.length > 0) {
          return `Patch applied but validation failed: ${issues.join("; ")}. Fix the issues.`;
        }

        // Render
        const pngBase64s = await renderCurrentVersion();
        if (!pngBase64s) {
          return `Patch applied but render failed: ${lastRenderError}. Undo or fix the issue.`;
        }

        return `Patch applied to ${file} and rendered as V${currentVersion}. Check the result.`;
      },
    });

    const writeTemplateJsonTool = tool({
      name: "write_template_json",
      description: "Write the template metadata (fields and asset slots). Must be called before mark_complete.",
      parameters: z.object({
        id: z.string().describe("Template ID (lowercase, hyphens)"),
        name: z.string().describe("Human-readable template name"),
        pageSize: z.enum(["A4", "LETTER", "LEGAL"]).describe("Page size for the document"),
        headerHeight: z.number().nullable().describe("Header height in pixels (null if no header)"),
        headerContent: z.string().nullable().describe("Header JSX content (null if no header)"),
        footerHeight: z.number().nullable().describe("Footer height in pixels (null if no footer)"),
        footerContent: z.string().nullable().describe("Footer JSX content (null if no footer)"),
        fields: z.array(z.object({
          name: z.string().describe("SCREAMING_SNAKE_CASE field name"),
          type: z.enum(["string", "number", "boolean", "array", "object"]),
          description: z.string(),
          optional: z.boolean().nullable().describe("Whether this field is optional (default: false)"),
          defaultValue: z.string().nullable().describe("Default value if field is not provided"),
          exampleJson: z.string().nullable().describe("JSON-encoded example value"),
          itemsJson: z.string().nullable().describe("For arrays: item schema"),
          propertiesJson: z.string().nullable().describe("For objects: properties schema"),
        })),
        assetSlots: z.array(z.object({
          name: z.string().describe("SCREAMING_SNAKE_CASE asset name"),
          kind: z.enum(["photo", "logo", "icon", "chart"]),
          description: z.string(),
        })),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async ({ id, name, pageSize, headerHeight, headerContent, footerHeight, footerContent, fields, assetSlots }: any) => {
        onEvent?.({ type: "tool_call", content: `Writing template JSON (${fields.length} fields, ${assetSlots.length} assets)`, toolName: "write_template_json" });

        const parseJson = (str: string | null): unknown => {
          if (!str) return undefined;
          try {
            return JSON.parse(str);
          } catch {
            return undefined;
          }
        };

        currentJson = {
          id: id || "generated-template",
          name: name || "Generated Template",
          format: "satori",
          satoriConfig: {
            pageSize: pageSize || "A4",
            header: headerHeight ? { height: headerHeight, content: headerContent || "" } : undefined,
            footer: footerHeight ? { height: footerHeight, content: footerContent || "" } : undefined,
          },
          fields: fields.map((f: { name: string; type: string; description: string; optional?: boolean | null; defaultValue?: string | null; exampleJson?: string | null; itemsJson?: string | null; propertiesJson?: string | null }) => ({
            name: f.name,
            type: f.type,
            description: f.description,
            optional: f.optional ?? false,
            default: f.defaultValue || undefined,
            example: parseJson(f.exampleJson || null),
            items: parseJson(f.itemsJson || null),
            properties: parseJson(f.propertiesJson || null),
          })) || [],
          assetSlots: assetSlots || [],
        };

        log.info(`write_template_json: ${currentJson.fields.length} fields, ${currentJson.assetSlots.length} assets`);

        onEvent?.({
          type: "template_json",
          content: `Template JSON updated: ${currentJson.fields.length} fields, ${currentJson.assetSlots.length} assets`,
          templateJson: currentJson,
        });

        return `Template JSON written with ${currentJson.fields.length} fields and ${currentJson.assetSlots.length} assets.`;
      },
    });

    const markCompleteTool = tool({
      name: "mark_complete",
      description: "Call this ONLY after you have seen at least one rendered comparison and the template matches the original well. Do NOT call on the first iteration. Do NOT call if the last render failed.",
      parameters: z.object({
        message: z.string().describe("Brief summary of what was generated"),
      }),
      execute: async ({ message }) => {
        onEvent?.({ type: "tool_call", content: `Marking complete: ${message}`, toolName: "mark_complete" });

        // Reject if last render failed
        if (!lastRenderSucceeded) {
          log.info(`mark_complete REJECTED: last render failed`);
          return `ERROR: Cannot mark complete because the last render FAILED. You must fix the JSX issues first using write_satori_document. Check the error message for details.`;
        }

        // Require minimum iterations before allowing completion
        const MIN_VERSIONS = 2; // At least 2 rendered versions before completing
        if (currentVersion < MIN_VERSIONS) {
          log.info(`mark_complete REJECTED: only ${currentVersion} versions, need ${MIN_VERSIONS}`);
          return `ERROR: You've only completed ${currentVersion} iteration(s). You need at least ${MIN_VERSIONS} iterations. Keep refining the template with write_satori_document.`;
        }

        isComplete = true;
        log.info(`mark_complete: ${message} (after ${currentVersion} versions)`);
        return "Generation marked complete.";
      },
    });

    // Build system prompt with optional brand guidelines
    let systemPrompt = SYSTEM_PROMPT;

    if ((brandColors && brandColors.length > 0) || (brandFonts && brandFonts.length > 0)) {
      let brandSection = "\n\n## BRAND GUIDELINES\nUSE THESE BRAND ASSETS when designing the template:\n";

      if (brandColors && brandColors.length > 0) {
        brandSection += "\n### Brand Colors\n";
        for (const color of brandColors) {
          brandSection += `- ${color.name}: ${color.value}${color.usage ? ` (${color.usage})` : ""}\n`;
        }
        brandSection += "\nUse these exact color codes in your JSX styles. Match usage types when applicable.\n";
      }

      if (brandFonts && brandFonts.length > 0) {
        brandSection += "\n### Brand Fonts\n";
        for (const font of brandFonts) {
          brandSection += `- ${font.name}: "${font.family}" weights: ${font.weights.join(", ")}${font.usage ? ` (${font.usage})` : ""}\n`;
        }
        brandSection += "\nUse these fonts in your JSX styles with fontFamily property.\n";
      }

      systemPrompt += brandSection;
      log.info(`Added brand guidelines: ${brandColors?.length || 0} colors, ${brandFonts?.length || 0} fonts`);
    }

    // Create agent
    log.info(`[DEBUG] Creating agent with reasoning: ${reasoning}`);
    const modelSettings = reasoning !== "none"
      ? { reasoning: { effort: reasoning } }
      : {}; // Don't pass reasoning config if none - let model use default
    log.info(`[DEBUG] Model settings:`, JSON.stringify(modelSettings));

    const agent = new Agent({
      name: "SatoriTemplateGenerator",
      instructions: systemPrompt,
      model: "gpt-5.2",
      modelSettings,
      tools: [
        writeSatoriDocumentTool,
        applyPatchTool,
        writeTemplateJsonTool,
        markCompleteTool,
      ],
    });

    // Build initial prompt
    const userInstructions = userPrompt ? `\n\nUSER INSTRUCTIONS:\n${userPrompt}\n` : "";

    let initialPrompt: string;
    if (isContinuation) {
      initialPrompt = `You are continuing work on a Satori document template based on user feedback.

USER FEEDBACK:
${feedback}

STEPS:
1. Make the requested changes using write_satori_document
2. Update write_template_json if fields changed
3. Review the rendered output

Original filename: ${pdfFilename}`;
    } else {
      initialPrompt = `Create a Satori document template matching this PDF.

Filename: ${pdfFilename}${userInstructions}

**ACTION: Call write_satori_document NOW with your best attempt at the layout.**

Look at the screenshot image I'm providing. Create JSX that matches:
- Same colors (estimate hex values from what you see)
- Same layout structure
- Same typography style
- Use {{PLACEHOLDERS}} for dynamic text

**YOUR FIRST TOOL CALL SHOULD BE write_satori_document. GO!**`;
    }

    // Create a Runner with lifecycle hooks for real-time tool call updates
    const runner = new Runner();

    // Hook: Tool execution started - emit event immediately
    runner.on("agent_tool_start", (_context, _agent, tool, _details) => {
      const toolName = tool.name || "unknown";
      log.info(`[TOOL START] ${toolName}`);
      onEvent?.({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
    });

    // Hook: Tool execution ended - emit result
    runner.on("agent_tool_end", (_context, _agent, tool, result, _details) => {
      const toolName = tool.name || "unknown";
      // Truncate long results for display
      const truncatedResult = typeof result === "string" && result.length > 200
        ? result.substring(0, 200) + "..."
        : String(result);
      log.info(`[TOOL END] ${toolName}: ${truncatedResult.substring(0, 100)}`);
      onEvent?.({ type: "tool_result", content: truncatedResult, toolName });
    });

    // Iteration loop - allow plenty of iterations for quality output
    const MAX_ITERATIONS = 15;
    const startTime = Date.now();
    log.info(`Starting iteration loop`, { maxIterations: MAX_ITERATIONS });

    for (let iteration = 0; iteration < MAX_ITERATIONS && !isComplete; iteration++) {
      log.info(`\n${"=".repeat(80)}`);
      log.info(`=== ITERATION ${iteration + 1}/${MAX_ITERATIONS} ===`);
      log.info(`${"=".repeat(80)}`);

      onEvent?.({
        type: "status",
        content: iteration === 0
          ? (isContinuation ? "Applying feedback..." : "Analyzing PDF and creating Satori pages...")
          : `Refining template (iteration ${iteration + 1})...`,
      });

      // Build input
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let input: any;

      if (iteration === 0 && existingConversationHistory && existingConversationHistory.length > 0) {
        // Resuming with existing history - inject user feedback into the conversation
        log.info(`Resuming with existing conversation history (${existingConversationHistory.length} items)`);

        const feedbackContent = `USER FEEDBACK (please address this):
${feedback}

The current template state has been preserved. Please:
1. Review the feedback carefully
2. Use read_satori_document to see the current pages if needed
3. Make the requested changes using write_satori_document
4. Update write_template_json if fields changed`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const feedbackMessage: any[] = [
          { type: "input_text", text: feedbackContent },
        ];
        if (pageImages[0]) {
          const resizedFeedbackImage = await resizeImageDataUrl(pageImages[0], "feedback_reference");
          feedbackMessage.push({ type: "input_image", image: resizedFeedbackImage, detail: "high" });
        }

        input = [...existingConversationHistory, { role: "user", content: feedbackMessage }];
      } else if (iteration === 0) {
        // Fresh start
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const initialContent: any[] = [
          { type: "input_text", text: initialPrompt },
        ];
        if (pageImages[0]) {
          validateImageDataUrl(pageImages[0], "initial_pdf_screenshot");
          const resizedImage = await resizeImageDataUrl(pageImages[0], "initial_pdf_screenshot");
          // Use detail: "high" to reduce processing time
          initialContent.push({ type: "input_image", image: resizedImage, detail: "high" });
        }
        input = [{ role: "user", content: initialContent }];
      } else {
        const hasOriginalRef = !!pageImages[0];

        const comparisonText = `COMPARISON - Version ${currentVersion} rendered.

${hasOriginalRef ? "Left image: Original reference\nRight image(s): Current rendered template (V" + currentVersion + ")" : "Reference: Current rendered template (V" + currentVersion + ")"}

Compare carefully:
- Does the layout match? (positions, sizes, spacing)
- Do the colors match? (backgrounds, text colors, borders)
- Are placeholders correctly placed?

If template looks good → call write_template_json (if not done) and mark_complete.
If issues remain → use write_satori_document to fix them.`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content: any[] = [
          { type: "input_text", text: comparisonText },
        ];
        if (pageImages[0]) {
          validateImageDataUrl(pageImages[0], "original_reference");
          const resizedOriginal = await resizeImageDataUrl(pageImages[0], "original_reference");
          content.push({ type: "input_image", image: resizedOriginal, detail: "high" });
        }

        if (lastRenderPngBase64s.length > 0) {
          // Validate, resize, and add all rendered pages for comparison
          for (let i = 0; i < lastRenderPngBase64s.length; i++) {
            const imgData = lastRenderPngBase64s[i];
            validateImageDataUrl(imgData, `render_page_${i + 1}`);
            const resizedRender = await resizeImageDataUrl(imgData, `render_page_${i + 1}`);
            content.push({ type: "input_image", image: resizedRender, detail: "high" });
          }
          const originalLen = pageImages[0] ? pageImages[0].length : 0;
          log.info(`Sending comparison: original reference (${originalLen} chars) + ${lastRenderPngBase64s.length} current render page(s)`);
        } else {
          log.error(`WARNING: No lastRenderPngBase64s available for iteration ${iteration + 1}! Model won't see current template.`);
        }

        input = [...conversationHistory, { role: "user", content }];
      }

      log.info(`Running agent iteration ${iteration + 1}`);
      log.info(`[DEBUG] Input message count: ${Array.isArray(input) ? input.length : 1}`);

      // Detailed context logging
      if (Array.isArray(input)) {
        for (let i = 0; i < input.length; i++) {
          const msg = input[i];
          const role = msg.role || "unknown";
          if (msg.content && Array.isArray(msg.content)) {
            const parts = msg.content.map((c: { type: string; text?: string; image?: string }) => {
              if (c.type === "input_text") {
                return `text(${c.text?.length || 0} chars)`;
              } else if (c.type === "input_image") {
                return `image(${c.image?.length || 0} chars)`;
              }
              return c.type;
            });
            log.info(`[CONTEXT MSG ${i}] role=${role}, parts=[${parts.join(", ")}]`);

            // Log text content preview
            for (const c of msg.content) {
              if (c.type === "input_text" && c.text) {
                log.info(`[CONTEXT TEXT ${i}] (${c.text.length} chars): ${c.text.substring(0, 200)}...`);
              }
            }
          } else if (typeof msg.content === "string") {
            log.info(`[CONTEXT MSG ${i}] role=${role}, content string (${msg.content.length} chars)`);
          }
        }
      }

      // Use streaming to get real-time events for built-in tools like code_interpreter
      const runStartTime = Date.now();
      log.info(`[TIMING] Starting runner.run() call...`);

      let stream;
      try {
        stream = await runner.run(agent, input, { maxTurns: 15, stream: true });
      } catch (runError) {
        const err = runError as Error & { status?: number; code?: string; param?: string };
        log.error(`[ERROR] runner.run() failed:`, {
          message: err.message,
          status: err.status,
          code: err.code,
          param: err.param,
          stack: err.stack?.split("\n").slice(0, 5).join("\n"),
        });
        throw runError;
      }
      log.info(`[TIMING] runner.run() returned stream in ${Date.now() - runStartTime}ms`);

      // Track tool calls in progress for matching with results
      const pendingToolCalls = new Map<string, string>();
      let firstEventReceived = false;
      let eventCount = 0;
      const streamStartTime = Date.now();
      let lastEventTime = Date.now();

      // Track accumulated text for progress reporting
      let accumulatedText = "";
      let lastTextLogTime = 0;

      // Process streaming events in real-time
      try {
      for await (const event of stream) {
        const now = Date.now();
        const timeSinceLastEvent = now - lastEventTime;

        // Log any pauses longer than 3 seconds
        if (timeSinceLastEvent > 3000) {
          log.info(`[PAUSE] ${timeSinceLastEvent}ms gap detected between events (event ${eventCount} -> ${eventCount + 1})`);
        }
        lastEventTime = now;

        if (!firstEventReceived) {
          firstEventReceived = true;
          log.info(`[TIMING] First stream event received in ${now - streamStartTime}ms (total from run start: ${now - runStartTime}ms)`);
        }
        eventCount++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyEvent = event as any;

        if (anyEvent.type === "raw_model_stream_event" && anyEvent.data) {
          let data = anyEvent.data;

          // "model" events have nested structure: {type:"model", event:{type:"response.xxx",...}}
          // Unwrap to get the actual event data
          if (data.type === "model" && data.event) {
            data = data.event;
          }

          // Extract text delta from various event types
          let textDelta = "";
          const eventType = data.type || "unknown";

          // Log significant events (skip high-frequency streaming deltas)
          const skipLogging = [
            "response.output_text.delta",
            "response.function_call_arguments.delta",
            "response.code_interpreter_call_code.delta",
          ];

          if (!skipLogging.includes(eventType)) {
            // Build informative log message
            const parts: string[] = [eventType];

            // Add useful context based on event type
            if (data.name) parts.push(`name=${data.name}`);
            if (data.status) parts.push(`status=${data.status}`);
            if (data.output_index !== undefined) parts.push(`idx=${data.output_index}`);

            // For completed events, show result preview
            if (eventType === "response.function_call_arguments.done" && data.arguments) {
              const preview = data.arguments.substring(0, 100);
              parts.push(`args=${preview}...`);
            }

            // Log the event
            log.info(`[${eventType}] ${parts.slice(1).join(", ")} (+${Math.round((Date.now() - runStartTime) / 1000)}s)`);
          }

          // Handle code_interpreter events with useful details
          if (eventType === "response.code_interpreter_call.in_progress") {
            onEvent?.({ type: "tool_call", content: "Running code_interpreter...", toolName: "code_interpreter" });
          }

          if (eventType === "response.code_interpreter_call.completed") {
            const output = data.output || data.result;
            const outputPreview = output ? JSON.stringify(output).substring(0, 300) : "no output";
            log.info(`[CODE_INTERPRETER DONE] ${outputPreview}`);
            onEvent?.({ type: "tool_result", content: `Code result: ${outputPreview.substring(0, 100)}`, toolName: "code_interpreter" });
          }

          // Log code being executed by code_interpreter
          if (eventType === "response.code_interpreter_call_code.done" && data.code) {
            const codeLines = data.code.split("\n").slice(0, 5).join(" | ");
            log.info(`[CODE_INTERPRETER] Executing: ${codeLines.substring(0, 200)}...`);
            onEvent?.({ type: "status", content: `Running Python: ${codeLines.substring(0, 80)}...` });
          }

          // Handle function tool calls
          if (data.type === "response.function_call_arguments.delta") {
            // Tool call in progress - we'll emit when done
          }

          if (data.type === "response.function_call_arguments.done") {
            const callId = data.item_id || data.call_id;
            const toolName = data.name || "unknown";
            if (callId) {
              pendingToolCalls.set(callId, toolName);
            }
            log.info(`[TOOL CALL] ${toolName}`);
            onEvent?.({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
          }

          // Handle output text streaming - accumulate and log periodically
          if (eventType === "response.output_text.delta" && data.delta) {
            textDelta = data.delta;
            accumulatedText += textDelta;
          }

          // Log text progress every 3 seconds
          const now = Date.now();
          if (accumulatedText.length > 0 && (now - lastTextLogTime > 3000)) {
            const preview = accumulatedText.slice(-200).replace(/\n/g, "\\n");
            log.info(`[MODEL WRITING] ${accumulatedText.length} chars so far: ...${preview}`);
            lastTextLogTime = now;
          }

          // When output text is done, log it and reset accumulator
          if (eventType === "response.output_text.done") {
            const finalText = data.text || accumulatedText;
            if (finalText.length > 0) {
              log.info(`[MODEL TEXT COMPLETE] ${finalText.length} chars`);
              onEvent?.({ type: "reasoning", content: finalText });
            }
            accumulatedText = "";
          }
        }

        // Handle run_item_stream_event for tool results and other items
        if (anyEvent.type === "run_item_stream_event" && anyEvent.item) {
          const item = anyEvent.item;

          if (item.type === "tool_call_item") {
            const toolName = item.name || item.rawItem?.name || "unknown";
            log.info(`[TOOL START] ${toolName} (+${Date.now() - runStartTime}ms)`);
            onEvent?.({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
          }

          if (item.type === "tool_call_output_item") {
            const toolName = item.name || item.rawItem?.name || "tool";
            const output = typeof item.output === "string" ? item.output : JSON.stringify(item.output);
            const truncated = output.length > 200 ? output.substring(0, 200) + "..." : output;
            log.info(`[TOOL END] ${toolName} (+${Date.now() - runStartTime}ms): ${truncated.substring(0, 100)}`);
            onEvent?.({ type: "tool_result", content: truncated, toolName });
          }

          if (item.type === "reasoning_item" && item.rawItem) {
            const reasoningText = extractReasoningText(item.rawItem);
            if (reasoningText) {
              log.info(`[REASONING] ${reasoningText.substring(0, 200)}...`);
              onEvent?.({ type: "reasoning", content: reasoningText });
            }
          }

          if (item.type === "message_output_item" && item.rawItem) {
            const content = item.rawItem.content;
            if (Array.isArray(content)) {
              for (const part of content) {
                if (part.type === "output_text" && part.text) {
                  log.info(`[MODEL OUTPUT] ${part.text.substring(0, 300)}...`);
                  onEvent?.({ type: "reasoning", content: part.text });
                }
              }
            }
          }
        }
      }
      } catch (streamError) {
        const err = streamError as Error & { status?: number; code?: string; param?: string };
        log.error(`[ERROR] Stream processing failed at event ${eventCount}:`, {
          message: err.message,
          status: err.status,
          code: err.code,
          param: err.param,
        });
        throw streamError;
      }

      // Wait for stream to complete and get final result
      await stream.completed;
      const iterationDuration = Date.now() - runStartTime;
      log.info(`[ITERATION ${iteration + 1} DONE] ${Math.round(iterationDuration / 1000)}s, ${eventCount} events`);

      // Get result from stream after completion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const streamAny = stream as any;
      const result = streamAny.result || streamAny._result || { history: conversationHistory };
      conversationHistory = result.history || conversationHistory;

      // Note: Rendering now happens on each patch/write, not at end of iteration
      log.info(`Iteration ${iteration + 1} complete`, { isComplete, version: currentVersion, durationMs: iterationDuration });
    }

    if (currentSatoriPages.length > 0 && currentJson) {
      log.info("Template generation SUCCESS", { totalVersions: currentVersion, pageCount: currentSatoriPages.length });

      // Re-render the final clean HTML to get accurate preview
      // (intermediate renders may have had base64 stripped to [IMAGE])
      log.info("Re-rendering final clean HTML for accurate preview...");
      const finalPngs = await renderCurrentVersion();
      const finalVersion = versions[versions.length - 1];
      if (finalPngs && finalVersion) {
        finalVersion.previewBase64s = finalPngs;
        log.info("Final re-render complete");
      }

      return {
        success: true,
        templateJson: currentJson,
        satoriPages: currentSatoriPages,
        message: `Satori template generated with ${currentVersion} version(s), ${currentSatoriPages.length} page(s)`,
        versions,
        conversationHistory,
      };
    }

    log.error("Template generation FAILED - no valid output");
    return {
      success: false,
      message: "Failed to generate template - no valid output produced",
      versions,
      conversationHistory,
    };
  } catch (error) {
    log.error("Template generation EXCEPTION", error);
    return {
      success: false,
      message: `Generation failed: ${error}`,
      versions,
      conversationHistory,
    };
  }
}

// Re-export for compatibility
export { runTemplateGeneratorAgent as runTemplateGenerator };
