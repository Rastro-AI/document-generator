/**
 * SVG Template Renderer
 *
 * Renders SVG templates by substituting placeholders with field values.
 * Supports:
 * - {{FIELD_NAME}} - Simple field substitution
 * - {{FIELD_NAME:default}} - Field with default value
 * - {{#ARRAY_FIELD}}...{{/ARRAY_FIELD}} - Array iteration
 * - {{ASSET_NAME}} - Image asset embedding (as base64 data URL in image href)
 */

import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";

// Chromium pack URL - served from production domain to avoid auth on preview deployments
const CHROMIUM_PACK_URL = "https://document-generator-lac.vercel.app/chromium-pack.tar";

const execAsync = promisify(exec);

// Logger
const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [svg-renderer] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [svg-renderer] ERROR: ${msg}`, data !== undefined ? data : "");
  },
};

export interface SVGRenderResult {
  success: boolean;
  svg?: string;           // Rendered SVG string
  pdfBuffer?: Buffer;     // PDF buffer (if requested)
  pngBase64?: string;     // PNG preview as base64 data URL
  error?: string;
}

export interface SVGRenderOptions {
  fields?: Record<string, unknown>;
  assets?: Record<string, string | null>;  // Asset paths or data URLs
  outputFormat?: "svg" | "pdf" | "png" | "all";
  width?: number;
  height?: number;
}

/**
 * Escape special characters for safe SVG text content
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Sanitize SVG content by removing invalid XML characters
 * This includes null bytes, control characters, and other non-printable characters
 */
function sanitizeSvg(svgContent: string): string {
  // Remove null bytes and other control characters that are invalid in XML
  // Valid XML characters: #x9 | #xA | #xD | [#x20-#xD7FF] | [#xE000-#xFFFD] | [#x10000-#x10FFFF]
  // eslint-disable-next-line no-control-regex
  return svgContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Get nested value from object using dot notation
 * e.g., getValue(obj, "user.name") returns obj.user.name
 */
function getValue(obj: Record<string, unknown>, pathStr: string): unknown {
  const parts = pathStr.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Format a value for display in SVG
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return escapeXml(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(v => formatValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Ensure SVG has required namespaces for xlink:href
 */
function ensureNamespaces(svgContent: string): string {
  // Check if SVG uses xlink:href
  if (!svgContent.includes("xlink:href")) {
    return svgContent;
  }

  // Check if xmlns:xlink is already defined
  if (svgContent.includes('xmlns:xlink')) {
    return svgContent;
  }

  // Add xlink namespace to SVG root element
  return svgContent.replace(
    /<svg([^>]*)>/i,
    '<svg$1 xmlns:xlink="http://www.w3.org/1999/xlink">'
  );
}

/**
 * Render an SVG template with field values
 */
export function renderSVGTemplate(
  svgContent: string,
  fields: Record<string, unknown> = {},
  assets: Record<string, string | null> = {}
): string {
  let rendered = svgContent;

  // Process array blocks: {{#ARRAY_FIELD}}...{{/ARRAY_FIELD}}
  // This is a simple implementation - for each array item, duplicate the block
  const arrayBlockRegex = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  rendered = rendered.replace(arrayBlockRegex, (match, fieldName, blockContent) => {
    const arrayValue = getValue(fields, fieldName);
    if (!Array.isArray(arrayValue) || arrayValue.length === 0) {
      return ""; // Remove block if not an array or empty
    }

    // For each array item, render the block with item-specific placeholders
    return arrayValue.map((item, index) => {
      let itemContent = blockContent;

      // Replace {{.}} with the item itself (for string arrays)
      itemContent = itemContent.replace(/\{\{\.\}\}/g, formatValue(item));

      // Replace {{@index}} with the current index
      itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));

      // Replace {{property}} with item.property (for object arrays)
      if (typeof item === "object" && item !== null) {
        const itemObj = item as Record<string, unknown>;
        itemContent = itemContent.replace(/\{\{(\w+)\}\}/g, (matchStr: string, prop: string) => {
          if (prop in itemObj) {
            return formatValue(itemObj[prop]);
          }
          return matchStr; // Keep original if not found
        });
      }

      return itemContent;
    }).join("");
  });

  // Process simple field placeholders: {{FIELD_NAME}} or {{FIELD_NAME:default}}
  const placeholderRegex = /\{\{(\w+(?:\.\w+)*)(?::([^}]*))?\}\}/g;
  rendered = rendered.replace(placeholderRegex, (match, fieldPath, defaultValue) => {
    const value = getValue(fields, fieldPath);
    if (value !== undefined && value !== null && value !== "") {
      return formatValue(value);
    }
    // Use default value if provided, otherwise show placeholder
    return defaultValue !== undefined ? escapeXml(defaultValue) : `{{${fieldPath}}}`;
  });

  // Process asset placeholders in xlink:href or href attributes
  // Look for patterns like href="{{ASSET_NAME}}" or xlink:href="{{ASSET_NAME}}"
  const assetHrefRegex = /(xlink:href|href)=["']\{\{(\w+)\}\}["']/g;
  rendered = rendered.replace(assetHrefRegex, (match, attr, assetName) => {
    const assetValue = assets[assetName];
    if (assetValue) {
      // If it's already a data URL, use it directly
      if (assetValue.startsWith("data:")) {
        // Use href instead of xlink:href for better compatibility
        return `href="${assetValue}"`;
      }
      // Otherwise it's a file path - we'll handle this in the render function
      return `href="${assetValue}"`;
    }
    // No asset - use a transparent 1x1 PNG to avoid empty href issues with some renderers
    return `href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="`;
  });

  // Ensure namespaces are defined
  rendered = ensureNamespaces(rendered);

  return rendered;
}

/**
 * Load asset files and convert to data URLs
 */
export async function prepareAssets(
  assets: Record<string, string | null>
): Promise<Record<string, string | null>> {
  const prepared: Record<string, string | null> = {};

  for (const [name, value] of Object.entries(assets)) {
    if (!value) {
      prepared[name] = null;
      continue;
    }

    // Already a data URL
    if (value.startsWith("data:")) {
      prepared[name] = value;
      continue;
    }

    // Load from file path
    try {
      const buffer = await fs.readFile(value);
      const ext = path.extname(value).toLowerCase().slice(1);
      const mimeTypes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
      };
      const mimeType = mimeTypes[ext] || "application/octet-stream";
      prepared[name] = `data:${mimeType};base64,${buffer.toString("base64")}`;
    } catch (err) {
      log.error(`Failed to load asset ${name} from ${value}:`, err);
      prepared[name] = null;
    }
  }

  return prepared;
}

/**
 * Convert SVG to PNG using resvg-js (pure Rust, works on Vercel)
 * Falls back to system tools if resvg fails
 */
export async function svgToPng(svgContent: string, width?: number, height?: number): Promise<Buffer> {
  const errors: string[] = [];

  // Sanitize SVG content to remove invalid XML characters (null bytes, control chars)
  const sanitizedSvg = sanitizeSvg(svgContent);

  // Try resvg-js first (works on Vercel, no system dependencies)
  try {
    const opts: { fitTo?: { mode: "width" | "height"; value: number } } = {};
    if (width) {
      opts.fitTo = { mode: "width", value: width };
    } else if (height) {
      opts.fitTo = { mode: "height", value: height };
    }

    const resvg = new Resvg(sanitizedSvg, opts);
    const pngData = resvg.render();
    const pngBuffer = pngData.asPng();
    log.info("PNG generated with resvg-js", { size: pngBuffer.length });
    return Buffer.from(pngBuffer);
  } catch (err) {
    errors.push(`resvg-js: ${err}`);
    log.error("resvg-js failed:", err);
  }

  // Fall back to system tools
  const tempDir = os.tmpdir();
  const tempId = `svg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const svgPath = path.join(tempDir, `${tempId}.svg`);
  const pngPath = path.join(tempDir, `${tempId}.png`);

  try {
    await fs.writeFile(svgPath, sanitizedSvg);

    const sizeArgs = width && height ? `-w ${width} -h ${height}` : "";

    // Try rsvg-convert
    try {
      const rsvgCmd = process.platform === "darwin" ? "/opt/homebrew/bin/rsvg-convert" : "rsvg-convert";
      await execAsync(`${rsvgCmd} ${sizeArgs} -o "${pngPath}" "${svgPath}"`);
      const pngBuffer = await fs.readFile(pngPath);
      return pngBuffer;
    } catch (err) {
      errors.push(`rsvg-convert: ${err}`);
    }

    // Try Inkscape
    try {
      const inkscapeSizeArgs = width && height ? `--export-width=${width} --export-height=${height}` : "";
      await execAsync(`inkscape "${svgPath}" --export-filename="${pngPath}" --export-type=png ${inkscapeSizeArgs} 2>/dev/null`);
      const pngBuffer = await fs.readFile(pngPath);
      return pngBuffer;
    } catch (err) {
      errors.push(`inkscape: ${err}`);
    }

    // Try cairosvg
    try {
      const cairoSizeArgs = width && height ? `--output-width ${width} --output-height ${height}` : "";
      await execAsync(`cairosvg "${svgPath}" -o "${pngPath}" ${cairoSizeArgs}`);
      const pngBuffer = await fs.readFile(pngPath);
      return pngBuffer;
    } catch (err) {
      errors.push(`cairosvg: ${err}`);
    }

    log.error("All SVG to PNG converters failed:", errors);
    throw new Error(`No SVG to PNG converter available. Errors: ${errors.join("; ")}`);
  } finally {
    await fs.unlink(svgPath).catch(() => {});
    await fs.unlink(pngPath).catch(() => {});
  }
}

/**
 * Convert SVG to PDF using Puppeteer (best foreignObject support)
 * Falls back to system tools or PNG-based PDF if Puppeteer fails
 */
export async function svgToPdf(svgContent: string): Promise<Buffer> {
  // Sanitize SVG content to remove invalid XML characters (null bytes, control chars)
  const sanitizedSvg = sanitizeSvg(svgContent);
  const errors: string[] = [];

  // Extract dimensions from SVG
  const widthMatch = sanitizedSvg.match(/width="(\d+)"/);
  const heightMatch = sanitizedSvg.match(/height="(\d+)"/);
  const width = widthMatch ? parseInt(widthMatch[1]) : 612;
  const height = heightMatch ? parseInt(heightMatch[1]) : 792;

  // Try Puppeteer first (best quality, full foreignObject support)
  try {
    log.info("Converting SVG to PDF with Puppeteer");

    // Use @sparticuz/chromium for serverless, local Chrome for dev
    const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;

    let browser;
    if (isServerless) {
      browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
        headless: true,
      });
    } else {
      browser = await puppeteer.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        executablePath: process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : "/usr/bin/google-chrome",
        headless: true,
      });
    }

    try {
      const page = await browser.newPage();

      // Create HTML page with SVG
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              * { margin: 0; padding: 0; }
              body { width: ${width}px; height: ${height}px; }
              svg { display: block; }
            </style>
          </head>
          <body>${sanitizedSvg}</body>
        </html>
      `;

      await page.setContent(html, { waitUntil: "networkidle0" });
      await page.setViewport({ width, height });

      const pdfBuffer = await page.pdf({
        width: `${width}px`,
        height: `${height}px`,
        printBackground: true,
        pageRanges: "1",
      });

      log.info("PDF generated with Puppeteer", { size: pdfBuffer.length });
      return Buffer.from(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (err) {
    errors.push(`puppeteer: ${err}`);
    log.error("Puppeteer failed:", err);
  }

  // Fallback to system tools
  const tempDir = os.tmpdir();
  const tempId = `svg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const svgPath = path.join(tempDir, `${tempId}.svg`);
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);

  try {
    await fs.writeFile(svgPath, sanitizedSvg);

    // Try Inkscape
    try {
      await execAsync(`inkscape "${svgPath}" --export-filename="${pdfPath}" --export-type=pdf 2>/dev/null`);
      const pdfBuffer = await fs.readFile(pdfPath);
      log.info("PDF generated with Inkscape", { size: pdfBuffer.length });
      return pdfBuffer;
    } catch (err) {
      errors.push(`inkscape: ${err}`);
    }

    // Try rsvg-convert (librsvg)
    try {
      const rsvgCmd = process.platform === "darwin" ? "/opt/homebrew/bin/rsvg-convert" : "rsvg-convert";
      await execAsync(`${rsvgCmd} -f pdf -o "${pdfPath}" "${svgPath}"`);
      const pdfBuffer = await fs.readFile(pdfPath);
      log.info("PDF generated with rsvg-convert", { size: pdfBuffer.length });
      return pdfBuffer;
    } catch (err) {
      errors.push(`rsvg-convert: ${err}`);
    }

    // Try cairosvg (Python)
    try {
      await execAsync(`cairosvg "${svgPath}" -o "${pdfPath}"`);
      const pdfBuffer = await fs.readFile(pdfPath);
      log.info("PDF generated with cairosvg", { size: pdfBuffer.length });
      return pdfBuffer;
    } catch (err) {
      errors.push(`cairosvg: ${err}`);
    }

    // Last resort: PNG + pdf-lib (no foreignObject support but works everywhere)
    try {
      log.info("Falling back to PNG-based PDF generation");
      const pngBuffer = await svgToPng(sanitizedSvg, 2400, undefined);
      const pdfContent = await createSimplePdfWithImage(pngBuffer);
      log.info("PDF generated with png+pdf-lib fallback", { size: pdfContent.length });
      return pdfContent;
    } catch (pngErr) {
      errors.push(`png-fallback: ${pngErr}`);
    }

    log.error("All SVG to PDF converters failed:", errors);
    throw new Error(`No SVG to PDF converter available. Errors: ${errors.join("; ")}`);
  } finally {
    await fs.unlink(svgPath).catch(() => {});
    await fs.unlink(pdfPath).catch(() => {});
  }
}

/**
 * Create a simple PDF with an embedded PNG image
 * This is a fallback when no proper SVG-to-PDF converter is available
 * Uses pdf-lib which works on Vercel (pure JavaScript, no native dependencies)
 */
async function createSimplePdfWithImage(pngBuffer: Buffer): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  // Embed the PNG image
  const pngImage = await pdfDoc.embedPng(pngBuffer);

  // Get image dimensions
  const imgWidth = pngImage.width;
  const imgHeight = pngImage.height;

  // Create a page with the same aspect ratio as the image
  // Scale to fit on a US Letter page (612x792 points) if needed
  const maxWidth = 612;
  const maxHeight = 792;

  let pageWidth = imgWidth;
  let pageHeight = imgHeight;

  // Scale down if image is larger than max page size
  if (imgWidth > maxWidth || imgHeight > maxHeight) {
    const scaleX = maxWidth / imgWidth;
    const scaleY = maxHeight / imgHeight;
    const scale = Math.min(scaleX, scaleY);
    pageWidth = imgWidth * scale;
    pageHeight = imgHeight * scale;
  }

  // Create page and draw the image
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  // Serialize PDF to bytes
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Full render pipeline: SVG template -> rendered SVG -> PDF/PNG
 */
export async function renderSVG(
  svgTemplate: string,
  options: SVGRenderOptions = {}
): Promise<SVGRenderResult> {
  const {
    fields = {},
    assets = {},
    outputFormat = "svg",
    width,
    height,
  } = options;

  try {
    log.info("Starting SVG render", { outputFormat, fieldCount: Object.keys(fields).length });

    // Prepare assets (load files, convert to data URLs)
    const preparedAssets = await prepareAssets(assets);

    // Render the SVG template
    const renderedSvg = renderSVGTemplate(svgTemplate, fields, preparedAssets);
    log.info("SVG template rendered", { svgLength: renderedSvg.length });

    const result: SVGRenderResult = {
      success: true,
      svg: renderedSvg,
    };

    // Generate PDF if requested
    if (outputFormat === "pdf" || outputFormat === "all") {
      try {
        result.pdfBuffer = await svgToPdf(renderedSvg);
        log.info("PDF generated", { pdfSize: result.pdfBuffer.length });
      } catch (pdfError) {
        log.error("PDF generation failed", pdfError);
        if (outputFormat === "pdf") {
          return { success: false, error: `PDF generation failed: ${pdfError}` };
        }
        // For "all", continue without PDF
      }
    }

    // Generate PNG if requested
    if (outputFormat === "png" || outputFormat === "all") {
      try {
        const pngBuffer = await svgToPng(renderedSvg, width, height);
        result.pngBase64 = `data:image/png;base64,${pngBuffer.toString("base64")}`;
        log.info("PNG generated", { pngSize: pngBuffer.length });
      } catch (pngError) {
        log.error("PNG generation failed", pngError);
        if (outputFormat === "png") {
          return { success: false, error: `PNG generation failed: ${pngError}` };
        }
        // For "all", continue without PNG
      }
    }

    return result;
  } catch (error) {
    log.error("SVG render failed", error);
    return {
      success: false,
      error: `SVG render failed: ${error}`,
    };
  }
}

/**
 * Parse SVG to extract dimensions
 */
export function parseSVGDimensions(svgContent: string): { width: number; height: number } | null {
  // Try to get width/height from SVG root element
  const widthMatch = svgContent.match(/width=["']([^"']+)["']/);
  const heightMatch = svgContent.match(/height=["']([^"']+)["']/);

  if (widthMatch && heightMatch) {
    const width = parseFloat(widthMatch[1]);
    const height = parseFloat(heightMatch[1]);
    if (!isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
  }

  // Try to get from viewBox
  const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/);
  if (viewBoxMatch) {
    const [, , w, h] = viewBoxMatch[1].split(/\s+/).map(parseFloat);
    if (!isNaN(w) && !isNaN(h)) {
      return { width: w, height: h };
    }
  }

  return null;
}

/**
 * Extract field placeholders from SVG template
 */
export function extractPlaceholders(svgContent: string): string[] {
  const placeholders = new Set<string>();

  // Simple placeholders: {{FIELD_NAME}}
  const simpleRegex = /\{\{(\w+(?:\.\w+)*)(?::[^}]*)?\}\}/g;
  let match;
  while ((match = simpleRegex.exec(svgContent)) !== null) {
    placeholders.add(match[1]);
  }

  // Array blocks: {{#ARRAY_NAME}}...{{/ARRAY_NAME}}
  const arrayRegex = /\{\{#(\w+)\}\}/g;
  while ((match = arrayRegex.exec(svgContent)) !== null) {
    placeholders.add(match[1]);
  }

  return Array.from(placeholders);
}

/**
 * Generate a high-resolution thumbnail from SVG
 * Uses 2x scale for retina displays
 */
export async function generateThumbnail(svgContent: string, maxWidth: number = 800): Promise<Buffer> {
  // Use 2x resolution for high quality thumbnails
  const thumbnailWidth = maxWidth * 2;
  return await svgToPng(svgContent, thumbnailWidth);
}

/**
 * Convert foreignObject elements to native SVG text elements
 * This makes the SVG compatible with Figma and other tools that don't support foreignObject
 *
 * Parses the HTML content inside foreignObject and converts it to <text> with <tspan> elements
 */
export function convertForeignObjectToText(svgContent: string): string {
  // Match foreignObject elements with their content
  const foreignObjectRegex = /<foreignObject([^>]*)>([\s\S]*?)<\/foreignObject>/gi;

  return svgContent.replace(foreignObjectRegex, (match, attrs, innerContent) => {
    // Extract position and dimensions from foreignObject attributes
    const xMatch = attrs.match(/x=["']([^"']+)["']/);
    const yMatch = attrs.match(/y=["']([^"']+)["']/);
    const widthMatch = attrs.match(/width=["']([^"']+)["']/);

    const x = xMatch ? parseFloat(xMatch[1]) : 0;
    const y = yMatch ? parseFloat(yMatch[1]) : 0;
    const width = widthMatch ? parseFloat(widthMatch[1]) : 200;

    // Extract style from the inner div
    const divStyleMatch = innerContent.match(/style=["']([^"']+)["']/);
    const divStyle = divStyleMatch ? divStyleMatch[1] : "";

    // Parse style properties
    const fontFamilyMatch = divStyle.match(/font-family:\s*([^;]+)/i);
    const fontSizeMatch = divStyle.match(/font-size:\s*(\d+)px/i);
    const fontWeightMatch = divStyle.match(/font-weight:\s*(\d+|bold|normal)/i);
    const colorMatch = divStyle.match(/color:\s*([^;]+)/i);
    const lineHeightMatch = divStyle.match(/line-height:\s*([^;]+)/i);

    const fontFamily = fontFamilyMatch ? fontFamilyMatch[1].trim() : "Arial, sans-serif";
    const fontSize = fontSizeMatch ? parseInt(fontSizeMatch[1]) : 14;
    const fontWeight = fontWeightMatch ? fontWeightMatch[1] : "normal";
    const fill = colorMatch ? colorMatch[1].trim() : "#000";
    const lineHeight = lineHeightMatch ? parseFloat(lineHeightMatch[1]) : 1.4;

    // Extract text content (strip HTML tags but preserve the text)
    let textContent = innerContent
      .replace(/<[^>]*>/g, "") // Remove HTML tags
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .trim();

    // Calculate approximate characters per line based on font size and width
    // Rough estimate: average character width is about 0.5-0.6 of font size for most fonts
    const avgCharWidth = fontSize * 0.55;
    const charsPerLine = Math.floor(width / avgCharWidth);

    // Word-wrap the text into lines, preserving placeholders intact
    const lines = wrapTextPreservingPlaceholders(textContent, charsPerLine);

    // Calculate line spacing in pixels
    const lineSpacing = fontSize * lineHeight;

    // Build the text element with tspan children
    // First tspan uses dy="0" (or the font size to account for baseline), subsequent use line spacing
    const tspans = lines.map((line, index) => {
      const dy = index === 0 ? fontSize : lineSpacing;
      return `<tspan x="${x}" dy="${dy}">${escapeXml(line)}</tspan>`;
    }).join("\n    ");

    const style = `font-family: ${fontFamily}; font-size: ${fontSize}px; font-weight: ${fontWeight}; fill: ${fill};`;

    return `<text x="${x}" y="${y}" style="${style}">
    ${tspans}
  </text>`;
  });
}

/**
 * Word-wrap text to fit within a character limit per line
 * Preserves {{PLACEHOLDER}} tokens intact (never splits them across lines)
 */
function wrapTextPreservingPlaceholders(text: string, charsPerLine: number): string[] {
  if (charsPerLine <= 0) return [text];

  // Tokenize: split into words and placeholders
  // Placeholders like {{FOO:bar baz}} should be treated as single tokens
  const tokens: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Check if we're at a placeholder
    const placeholderMatch = remaining.match(/^\{\{[^}]+\}\}/);
    if (placeholderMatch) {
      tokens.push(placeholderMatch[0]);
      remaining = remaining.slice(placeholderMatch[0].length).trimStart();
    } else {
      // Get the next word (up to whitespace or placeholder)
      const wordMatch = remaining.match(/^[^\s{]+/);
      if (wordMatch) {
        tokens.push(wordMatch[0]);
        remaining = remaining.slice(wordMatch[0].length).trimStart();
      } else if (remaining.startsWith('{') && !remaining.startsWith('{{')) {
        // Single brace, treat as word
        const braceWord = remaining.match(/^[^\s]+/);
        if (braceWord) {
          tokens.push(braceWord[0]);
          remaining = remaining.slice(braceWord[0].length).trimStart();
        } else {
          break;
        }
      } else {
        // Skip whitespace
        remaining = remaining.trimStart();
        if (remaining.length === 0) break;
        // Safety: if nothing matches, take one character
        if (remaining === text) {
          tokens.push(remaining[0]);
          remaining = remaining.slice(1);
        }
      }
    }
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const token of tokens) {
    if (currentLine.length === 0) {
      currentLine = token;
    } else if (currentLine.length + 1 + token.length <= charsPerLine) {
      currentLine += " " + token;
    } else {
      lines.push(currentLine);
      currentLine = token;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

/**
 * Convert CSS class-based styles to inline styles for Figma compatibility
 * Extracts styles from <defs><style> and applies them inline
 */
export function convertCssClassesToInline(svgContent: string): string {
  // Extract style definitions from <defs><style>
  const styleBlockMatch = svgContent.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  if (!styleBlockMatch) return svgContent;

  const styleContent = styleBlockMatch[1];

  // Parse CSS rules into a map
  const styleMap: Record<string, string> = {};
  const ruleRegex = /\.([a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
  let ruleMatch;

  while ((ruleMatch = ruleRegex.exec(styleContent)) !== null) {
    const className = ruleMatch[1];
    const properties = ruleMatch[2]
      .trim()
      .replace(/\n/g, " ")
      .replace(/\s+/g, " ");
    styleMap[className] = properties;
  }

  // Apply inline styles to elements with class attributes
  let result = svgContent;

  // Find all elements with class attributes
  const classAttrRegex = /(<\w+[^>]*)\sclass=["']([^"']+)["']([^>]*>)/g;

  result = result.replace(classAttrRegex, (match, before, classes, after) => {
    const classNames = classes.split(/\s+/);
    const combinedStyles: string[] = [];

    for (const className of classNames) {
      if (styleMap[className]) {
        combinedStyles.push(styleMap[className]);
      }
    }

    if (combinedStyles.length === 0) {
      return match; // No matching styles found, keep original
    }

    const inlineStyle = combinedStyles.join(" ").trim();

    // Check if element already has a style attribute
    const existingStyleMatch = (before + after).match(/style=["']([^"']+)["']/);
    if (existingStyleMatch) {
      // Merge with existing style
      const mergedStyle = existingStyleMatch[1] + " " + inlineStyle;
      const withoutOldStyle = (before + after).replace(/\s*style=["'][^"']+["']/, "");
      return `${withoutOldStyle.slice(0, -1)} style="${mergedStyle}">`;
    }

    // Add new style attribute (remove class attribute)
    return `${before} style="${inlineStyle}"${after}`;
  });

  // Remove the <style> block since styles are now inline
  result = result.replace(/<style[^>]*>[\s\S]*?<\/style>\s*/gi, "");

  // Remove empty <defs> block if it only contained the style
  result = result.replace(/<defs>\s*<\/defs>\s*/gi, "");

  return result;
}

/**
 * Export SVG in Figma-compatible format (sync version - uses estimation)
 * Converts foreignObject to native text and CSS classes to inline styles
 * Note: For exact text layout matching, use exportFigmaCompatibleSvgAsync instead
 */
export function exportFigmaCompatibleSvg(svgContent: string): string {
  let result = svgContent;

  // First convert CSS classes to inline styles
  result = convertCssClassesToInline(result);

  // Then convert foreignObject elements to native text
  result = convertForeignObjectToText(result);

  return result;
}

/**
 * Export SVG in Figma-compatible format (async version - uses Puppeteer for exact text layout)
 * Renders the SVG in a browser to get exact line breaks, then converts to native SVG
 */
export async function exportFigmaCompatibleSvgAsync(svgContent: string): Promise<string> {
  // First convert CSS classes to inline styles (this doesn't affect layout)
  let result = convertCssClassesToInline(svgContent);

  // Check if there are any foreignObject elements to convert
  if (!result.includes('<foreignObject')) {
    return result;
  }

  // Extract dimensions from SVG
  const widthMatch = result.match(/width="(\d+)"/);
  const heightMatch = result.match(/height="(\d+)"/);
  const width = widthMatch ? parseInt(widthMatch[1]) : 612;
  const height = heightMatch ? parseInt(heightMatch[1]) : 792;

  try {
    // Use Puppeteer to render and measure actual text layout
    const isVercel = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
    const browser = await puppeteer.launch({
      args: isVercel ? chromium.args : ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: isVercel
        ? await chromium.executablePath()
        : process.platform === "darwin"
          ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
          : "/usr/bin/google-chrome",
      headless: true,
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });

      // Create HTML page with SVG
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>
              * { margin: 0; padding: 0; }
              body { width: ${width}px; height: ${height}px; }
            </style>
          </head>
          <body>${result}</body>
        </html>
      `;

      await page.setContent(html, { waitUntil: "networkidle0" });

      // Extract text layout from each foreignObject
      const textLayouts = await page.evaluate(() => {
        const layouts: Array<{
          index: number;
          x: number;
          y: number;
          width: number;
          lines: Array<{ text: string; y: number }>;
          style: {
            fontFamily: string;
            fontSize: number;
            fontWeight: string;
            color: string;
            lineHeight: number;
          };
        }> = [];

        const foreignObjects = document.querySelectorAll('foreignObject');
        foreignObjects.forEach((fo, index) => {
          const rect = fo.getBoundingClientRect();
          const div = fo.querySelector('div');
          if (!div) return;

          const computedStyle = window.getComputedStyle(div);
          const fontSize = parseFloat(computedStyle.fontSize);
          const lineHeight = parseFloat(computedStyle.lineHeight) || fontSize * 1.4;

          // Get the actual rendered text with line breaks
          // Create a range to measure each line
          const text = div.textContent || '';
          const lines: Array<{ text: string; y: number }> = [];

          // Use a temporary element to measure text
          const temp = document.createElement('div');
          temp.style.cssText = `
            position: absolute;
            visibility: hidden;
            white-space: nowrap;
            font-family: ${computedStyle.fontFamily};
            font-size: ${computedStyle.fontSize};
            font-weight: ${computedStyle.fontWeight};
          `;
          document.body.appendChild(temp);

          // Word wrap manually using actual measurements
          const words = text.trim().split(/\s+/);
          const maxWidth = rect.width;
          let currentLine = '';
          let currentY = fontSize; // First line starts at fontSize (baseline)

          for (const word of words) {
            const testLine = currentLine ? currentLine + ' ' + word : word;
            temp.textContent = testLine;

            if (temp.offsetWidth <= maxWidth || !currentLine) {
              currentLine = testLine;
            } else {
              lines.push({ text: currentLine, y: currentY });
              currentLine = word;
              currentY += lineHeight;
            }
          }
          if (currentLine) {
            lines.push({ text: currentLine, y: currentY });
          }

          document.body.removeChild(temp);

          layouts.push({
            index,
            x: parseFloat(fo.getAttribute('x') || '0'),
            y: parseFloat(fo.getAttribute('y') || '0'),
            width: rect.width,
            lines,
            style: {
              fontFamily: computedStyle.fontFamily,
              fontSize,
              fontWeight: computedStyle.fontWeight,
              color: computedStyle.color,
              lineHeight,
            },
          });
        });

        return layouts;
      });

      // Now replace foreignObject elements with text elements using exact layouts
      let foreignObjectIndex = 0;
      result = result.replace(/<foreignObject([^>]*)>[\s\S]*?<\/foreignObject>/gi, (match, attrs) => {
        const layout = textLayouts[foreignObjectIndex++];
        if (!layout || layout.lines.length === 0) {
          return ''; // Remove empty foreignObjects
        }

        // Convert RGB color to hex if needed
        let fill = layout.style.color;
        const rgbMatch = fill.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
          const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
          const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
          fill = `#${r}${g}${b}`;
        }

        const style = `font-family: ${layout.style.fontFamily}; font-size: ${layout.style.fontSize}px; font-weight: ${layout.style.fontWeight}; fill: ${fill};`;

        const tspans = layout.lines.map((line, i) => {
          const dy = i === 0 ? layout.style.fontSize : layout.style.lineHeight;
          return `<tspan x="${layout.x}" dy="${dy}">${escapeXml(line.text)}</tspan>`;
        }).join('\n    ');

        return `<text x="${layout.x}" y="${layout.y}" style="${style}">
    ${tspans}
  </text>`;
      });

      return result;
    } finally {
      await browser.close();
    }
  } catch (error) {
    log.error("Puppeteer text measurement failed, falling back to estimation", error);
    // Fall back to sync version with estimation
    return convertForeignObjectToText(result);
  }
}
