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
 * Get nested value from object using dot notation
 * e.g., getValue(obj, "user.name") returns obj.user.name
 */
function getValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
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
        itemContent = itemContent.replace(/\{\{(\w+)\}\}/g, (match: string, prop: string) => {
          if (prop in itemObj) {
            return formatValue(itemObj[prop]);
          }
          return match; // Keep original if not found
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
        return `${attr}="${assetValue}"`;
      }
      // Otherwise it's a file path - we'll handle this in the render function
      return `${attr}="${assetValue}"`;
    }
    // No asset - use a transparent 1x1 PNG to avoid empty href issues with some renderers
    return `${attr}="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="`;
  });

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
 * Convert SVG to PDF using Inkscape (common tool, good quality)
 * Falls back to rsvg-convert if available
 */
export async function svgToPdf(svgContent: string): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const tempId = `svg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const svgPath = path.join(tempDir, `${tempId}.svg`);
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);

  try {
    await fs.writeFile(svgPath, svgContent);
    const errors: string[] = [];

    // Try Inkscape first (best quality)
    try {
      await execAsync(`inkscape "${svgPath}" --export-filename="${pdfPath}" --export-type=pdf 2>/dev/null`);
      const pdfBuffer = await fs.readFile(pdfPath);
      return pdfBuffer;
    } catch (err) {
      errors.push(`inkscape: ${err}`);
    }

    // Try rsvg-convert (librsvg) - use full path on macOS
    try {
      const rsvgCmd = process.platform === "darwin" ? "/opt/homebrew/bin/rsvg-convert" : "rsvg-convert";
      await execAsync(`${rsvgCmd} -f pdf -o "${pdfPath}" "${svgPath}"`);
      const pdfBuffer = await fs.readFile(pdfPath);
      return pdfBuffer;
    } catch (err) {
      errors.push(`rsvg-convert: ${err}`);
    }

    // Try cairosvg (Python)
    try {
      await execAsync(`cairosvg "${svgPath}" -o "${pdfPath}"`);
      const pdfBuffer = await fs.readFile(pdfPath);
      return pdfBuffer;
    } catch (err) {
      errors.push(`cairosvg: ${err}`);
    }

    log.error("All SVG to PDF converters failed:", errors);
    throw new Error(`No SVG to PDF converter available. Install inkscape, librsvg, or cairosvg. Errors: ${errors.join("; ")}`);
  } finally {
    await fs.unlink(svgPath).catch(() => {});
    await fs.unlink(pdfPath).catch(() => {});
  }
}

/**
 * Convert SVG to PNG using various tools
 */
export async function svgToPng(svgContent: string, width?: number, height?: number): Promise<Buffer> {
  const tempDir = os.tmpdir();
  const tempId = `svg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const svgPath = path.join(tempDir, `${tempId}.svg`);
  const pngPath = path.join(tempDir, `${tempId}.png`);

  try {
    await fs.writeFile(svgPath, svgContent);

    const sizeArgs = width && height ? `-w ${width} -h ${height}` : "";

    const errors: string[] = [];

    // Try rsvg-convert first (fast and reliable)
    try {
      // Use full path for homebrew on macOS
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
    throw new Error(`No SVG to PNG converter available. Install librsvg, inkscape, or cairosvg. Errors: ${errors.join("; ")}`);
  } finally {
    await fs.unlink(svgPath).catch(() => {});
    await fs.unlink(pngPath).catch(() => {});
  }
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
