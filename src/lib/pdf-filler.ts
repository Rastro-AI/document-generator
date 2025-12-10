/**
 * PDF Form Filler - fills a base PDF template with dynamic content
 * Uses pdf-lib for server-side PDF manipulation
 */

import { PDFDocument, PDFFont, PDFPage, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

// Logger
const log = {
  info: (msg: string, data?: unknown) => {
    console.log(`[pdf-filler] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    console.error(`[pdf-filler] ERROR: ${msg}`, data !== undefined ? data : "");
  },
  debug: (msg: string, data?: unknown) => {
    console.log(`[pdf-filler] DEBUG: ${msg}`, data !== undefined ? data : "");
  },
};

// Types
export interface FieldBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextFieldStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  color?: string;
  alignment?: "left" | "center" | "right";
  lineHeight?: number;
}

export interface TextField {
  name: string;
  type: "text";
  description?: string; // Semantic description for LLM to understand what content to fill
  bbox: FieldBbox;
  style?: TextFieldStyle;
}

export interface ImageField {
  name: string;
  type: "image";
  description?: string; // Semantic description for LLM to understand what image to use
  bbox: FieldBbox;
  objectFit?: "contain" | "cover" | "fill";
}

export type SchemaField = TextField | ImageField;

export interface PageSchema {
  pageNumber: number;
  fields: SchemaField[];
}

export interface FontDefinition {
  name: string;
  regular?: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

export interface FormTemplateSchema {
  version: number;
  pages: PageSchema[];
  fonts?: FontDefinition[];
}

export interface FillOptions {
  fields: Record<string, unknown>;
  assets: Record<string, string | null>;
  templateRoot: string;
  /** If true, draws white rectangles to erase existing content before drawing new content */
  eraseBeforeDraw?: boolean;
}

export interface FillResult {
  success: boolean;
  pdfBuffer?: Buffer;
  pngBase64?: string;
  error?: string;
}

/**
 * Parse hex color to RGB values (0-1 range)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

/**
 * Load a PDF template and fill it with dynamic content
 */
export async function fillPdfTemplate(
  basePdfPath: string,
  schema: FormTemplateSchema,
  options: FillOptions
): Promise<FillResult> {
  try {
    log.info("Loading base PDF", basePdfPath);

    // Load the base PDF
    const basePdfBytes = await fs.readFile(basePdfPath);
    const pdfDoc = await PDFDocument.load(basePdfBytes);

    // Register fontkit for custom fonts
    pdfDoc.registerFontkit(fontkit);

    // Load custom fonts
    const loadedFonts: Map<string, { regular?: PDFFont; bold?: PDFFont }> = new Map();

    for (const fontDef of schema.fonts || []) {
      const fonts: { regular?: PDFFont; bold?: PDFFont } = {};

      if (fontDef.regular) {
        try {
          const fontPath = path.join(options.templateRoot, fontDef.regular);
          const fontBytes = await fs.readFile(fontPath);
          fonts.regular = await pdfDoc.embedFont(fontBytes);
          log.debug(`Loaded font ${fontDef.name} regular`);
        } catch (e) {
          log.error(`Failed to load font ${fontDef.name} regular`, e);
        }
      }

      if (fontDef.bold) {
        try {
          const fontPath = path.join(options.templateRoot, fontDef.bold);
          const fontBytes = await fs.readFile(fontPath);
          fonts.bold = await pdfDoc.embedFont(fontBytes);
          log.debug(`Loaded font ${fontDef.name} bold`);
        } catch (e) {
          log.error(`Failed to load font ${fontDef.name} bold`, e);
        }
      }

      loadedFonts.set(fontDef.name, fonts);
    }

    // Get standard fonts as fallback
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Process each page
    const pages = pdfDoc.getPages();
    log.info(`Processing ${schema.pages.length} page schemas across ${pages.length} PDF pages`);

    for (const pageSchema of schema.pages) {
      const pageIndex = pageSchema.pageNumber - 1;
      if (pageIndex >= pages.length) {
        log.error(`Page ${pageSchema.pageNumber} not found in PDF`);
        continue;
      }

      const page = pages[pageIndex];
      const { height: pageHeight } = page.getSize();
      log.debug(`Processing page ${pageSchema.pageNumber}, height=${pageHeight}`);

      for (const field of pageSchema.fields) {
        const fieldValue = field.type === "text"
          ? options.fields[field.name]
          : options.assets[field.name];

        if (field.type === "text") {
          if (fieldValue === null || fieldValue === undefined) {
            log.debug(`Skipping empty text field ${field.name}`);
            continue;
          }
          // For text, always erase first to cover original text
          await drawTextField(
            page,
            field,
            String(fieldValue),
            loadedFonts,
            helvetica,
            helveticaBold,
            pageHeight,
            options.eraseBeforeDraw ?? false
          );
        } else if (field.type === "image") {
          if (fieldValue === null || fieldValue === undefined) {
            // Skip empty image fields entirely - leave original content visible
            log.debug(`Skipping empty image field ${field.name}`);
            continue;
          } else {
            // For images, always erase first to get clean background
            await drawImageField(
              page,
              field,
              String(fieldValue),
              pdfDoc,
              pageHeight,
              options.eraseBeforeDraw ?? false
            );
          }
        }
      }
    }

    // Save the filled PDF
    log.info("Saving filled PDF");
    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = Buffer.from(pdfBytes);

    // Convert to PNG for preview
    log.info("Converting to PNG preview");
    const pngBase64 = await pdfToPng(pdfBuffer);

    return {
      success: true,
      pdfBuffer,
      pngBase64,
    };
  } catch (error) {
    log.error("Failed to fill PDF", error);
    return {
      success: false,
      error: `Failed to fill PDF: ${error}`,
    };
  }
}

async function drawTextField(
  page: PDFPage,
  field: TextField,
  text: string,
  loadedFonts: Map<string, { regular?: PDFFont; bold?: PDFFont }>,
  fallbackRegular: PDFFont,
  fallbackBold: PDFFont,
  pageHeight: number,
  eraseFirst: boolean = false
): Promise<void> {
  const { bbox, style = {} } = field;
  const {
    fontFamily = "Helvetica",
    fontWeight = 400,
    fontSize = 12,
    color = "#000000",
    alignment = "left",
  } = style;

  log.debug(`Drawing text field ${field.name}: "${text.substring(0, 30)}..."`);

  // Get font
  const fontFamilyFonts = loadedFonts.get(fontFamily);
  let font: PDFFont;
  if (fontFamilyFonts) {
    font = fontWeight >= 700
      ? fontFamilyFonts.bold || fontFamilyFonts.regular || fallbackBold
      : fontFamilyFonts.regular || fallbackRegular;
  } else {
    font = fontWeight >= 700 ? fallbackBold : fallbackRegular;
  }

  // Parse color
  const colorRgb = hexToRgb(color);

  // Schema coordinates use TOP-LEFT origin (y=0 at top, from PyMuPDF)
  // pdf-lib uses BOTTOM-LEFT origin (y=0 at bottom)
  // Convert: bottom_y = pageHeight - top_y - height
  const rectY = pageHeight - bbox.y - bbox.height;

  // Erase existing content by drawing white rectangle first (when using original PDF)
  if (eraseFirst) {
    page.drawRectangle({
      x: bbox.x,
      y: rectY,
      width: bbox.width,
      height: bbox.height,
      color: rgb(1, 1, 1), // White
    });
  }

  // Check if this is a multi-line text field (bbox height > 1.5x font size)
  const isMultiline = bbox.height > fontSize * 1.5;

  if (isMultiline) {
    // Word-wrap text to fit within bbox width
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth <= bbox.width) {
        currentLine = testLine;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        currentLine = word;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }

    // Calculate line height (typically 1.2x font size)
    const lineHeight = fontSize * 1.2;
    const maxLines = Math.floor(bbox.height / lineHeight);

    // Truncate if too many lines
    if (lines.length > maxLines) {
      lines.length = maxLines;
      // Add ellipsis to last line if truncated
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        const ellipsis = "...";
        let truncatedLine = lastLine;
        while (font.widthOfTextAtSize(truncatedLine + ellipsis, fontSize) > bbox.width && truncatedLine.length > 0) {
          truncatedLine = truncatedLine.slice(0, -1);
        }
        lines[lines.length - 1] = truncatedLine + ellipsis;
      }
    }

    // Draw each line
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineWidth = font.widthOfTextAtSize(line, fontSize);

      // Calculate X based on alignment
      let x = bbox.x;
      if (alignment === "center") {
        x = bbox.x + (bbox.width - lineWidth) / 2;
      } else if (alignment === "right") {
        x = bbox.x + bbox.width - lineWidth;
      }

      // Y position: start from top of bbox, move down for each line
      // In pdf-lib: higher Y = higher on page, so we subtract
      const y = pageHeight - bbox.y - fontSize - (i * lineHeight);

      page.drawText(line, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
      });
    }
  } else {
    // Single line - truncate if needed
    let displayText = text;
    const maxWidth = bbox.width;
    let textWidth = font.widthOfTextAtSize(displayText, fontSize);

    if (textWidth > maxWidth) {
      const ellipsis = "...";
      const ellipsisWidth = font.widthOfTextAtSize(ellipsis, fontSize);
      const availableWidth = maxWidth - ellipsisWidth;

      // Binary search for the right truncation point
      let lo = 0;
      let hi = displayText.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const truncated = displayText.substring(0, mid);
        const truncatedWidth = font.widthOfTextAtSize(truncated, fontSize);
        if (truncatedWidth <= availableWidth) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      displayText = displayText.substring(0, lo) + ellipsis;
      textWidth = font.widthOfTextAtSize(displayText, fontSize);
    }

    // Text baseline is near the top of the bbox
    const y = pageHeight - bbox.y - fontSize;

    // Calculate X based on alignment
    let x = bbox.x;
    if (alignment === "center") {
      x = bbox.x + (bbox.width - textWidth) / 2;
    } else if (alignment === "right") {
      x = bbox.x + bbox.width - textWidth;
    }

    page.drawText(displayText, {
      x,
      y,
      size: fontSize,
      font,
      color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
    });
  }
}

/**
 * Draw a placeholder box for empty image fields
 */
async function drawImagePlaceholder(
  page: PDFPage,
  field: ImageField,
  pageHeight: number
): Promise<void> {
  const { bbox } = field;
  log.debug(`Drawing image placeholder for ${field.name}`);

  // Schema coordinates use TOP-LEFT origin (from PyMuPDF)
  // pdf-lib uses BOTTOM-LEFT origin, so convert
  const pdfY = pageHeight - bbox.y - bbox.height;

  // Draw a light gray rectangle - no text, just a clean placeholder
  page.drawRectangle({
    x: bbox.x,
    y: pdfY,
    width: bbox.width,
    height: bbox.height,
    color: rgb(0.97, 0.97, 0.97), // Very light gray fill
    borderColor: rgb(0.85, 0.85, 0.85), // Light gray border
    borderWidth: 0.5,
  });
}

async function drawImageField(
  page: PDFPage,
  field: ImageField,
  assetPath: string,
  pdfDoc: PDFDocument,
  pageHeight: number,
  eraseFirst: boolean = false
): Promise<void> {
  log.debug(`Drawing image field ${field.name}: ${assetPath.substring(0, 50)}...`);

  try {
    let imageBytes: Uint8Array;

    if (assetPath.startsWith("data:")) {
      // Data URL
      const base64Data = assetPath.split(",")[1];
      imageBytes = Uint8Array.from(Buffer.from(base64Data, "base64"));
    } else {
      // File path
      imageBytes = await fs.readFile(assetPath);
    }

    // Detect image type and embed
    const isPng = assetPath.includes("png") || assetPath.startsWith("data:image/png");
    const image = isPng
      ? await pdfDoc.embedPng(imageBytes)
      : await pdfDoc.embedJpg(imageBytes);

    const { bbox, objectFit = "contain" } = field;

    // Schema coordinates use TOP-LEFT origin (from PyMuPDF)
    // pdf-lib uses BOTTOM-LEFT origin, so convert
    const baseY = pageHeight - bbox.y - bbox.height;

    let drawWidth = bbox.width;
    let drawHeight = bbox.height;
    let drawX = bbox.x;
    let drawY = baseY;

    // Erase existing content for image area (images need clean background)
    if (eraseFirst) {
      page.drawRectangle({
        x: bbox.x,
        y: baseY,
        width: bbox.width,
        height: bbox.height,
        color: rgb(1, 1, 1), // White
      });
    }

    if (objectFit === "contain") {
      const imageAspect = image.width / image.height;
      const boxAspect = bbox.width / bbox.height;

      if (imageAspect > boxAspect) {
        // Image is wider, fit to width
        drawWidth = bbox.width;
        drawHeight = bbox.width / imageAspect;
        drawY = baseY + (bbox.height - drawHeight) / 2;
      } else {
        // Image is taller, fit to height
        drawHeight = bbox.height;
        drawWidth = bbox.height * imageAspect;
        drawX = bbox.x + (bbox.width - drawWidth) / 2;
      }
    } else if (objectFit === "cover") {
      const imageAspect = image.width / image.height;
      const boxAspect = bbox.width / bbox.height;

      if (imageAspect > boxAspect) {
        // Image is wider, fit to height and crop width
        drawHeight = bbox.height;
        drawWidth = bbox.height * imageAspect;
        drawX = bbox.x - (drawWidth - bbox.width) / 2;
      } else {
        // Image is taller, fit to width and crop height
        drawWidth = bbox.width;
        drawHeight = bbox.width / imageAspect;
        drawY = baseY - (drawHeight - bbox.height) / 2;
      }
    }
    // objectFit === "fill" uses bbox dimensions directly

    page.drawImage(image, {
      x: drawX,
      y: drawY,
      width: drawWidth,
      height: drawHeight,
    });
  } catch (error) {
    log.error(`Failed to draw image ${field.name}`, error);
  }
}

/**
 * Convert PDF buffer to PNG base64
 */
async function pdfToPng(pdfBuffer: Buffer, dpi: number = 150): Promise<string> {
  const tempDir = os.tmpdir();
  const tempId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);
  const pngPathBase = path.join(tempDir, tempId);

  try {
    await fs.writeFile(pdfPath, pdfBuffer);
    await execAsync(`pdftoppm -png -f 1 -l 1 -r ${dpi} "${pdfPath}" "${pngPathBase}"`);
    const pngBuffer = await fs.readFile(`${pngPathBase}-1.png`);

    // Cleanup
    await fs.unlink(pdfPath).catch(() => {});
    await fs.unlink(`${pngPathBase}-1.png`).catch(() => {});

    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  } catch (error) {
    await fs.unlink(pdfPath).catch(() => {});
    throw new Error(`PDF to PNG conversion failed: ${error}`);
  }
}

/**
 * Fill template with placeholder values for preview
 */
export function generatePlaceholderFields(
  schema: FormTemplateSchema
): { fields: Record<string, string>; assets: Record<string, string | null> } {
  const fields: Record<string, string> = {};
  const assets: Record<string, string | null> = {};

  for (const page of schema.pages) {
    for (const field of page.fields) {
      if (field.type === "text") {
        fields[field.name] = `{{${field.name}}}`;
      } else if (field.type === "image") {
        // Use null for image placeholders - they won't be drawn
        assets[field.name] = null;
      }
    }
  }

  return { fields, assets };
}
