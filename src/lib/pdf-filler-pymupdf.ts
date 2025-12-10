/**
 * PDF Form Filler using PyMuPDF (via Python subprocess)
 * Uses proper redaction to remove original content before drawing new content
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// Logger
const log = {
  info: (msg: string, data?: unknown) => {
    console.log(`[pdf-filler-pymupdf] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    console.error(`[pdf-filler-pymupdf] ERROR: ${msg}`, data !== undefined ? data : "");
  },
  debug: (msg: string, data?: unknown) => {
    console.log(`[pdf-filler-pymupdf] DEBUG: ${msg}`, data !== undefined ? data : "");
  },
};

export interface SchemaField {
  name: string;
  type: "text" | "image";
  bbox: { x: number; y: number; width: number; height: number };
  style?: {
    fontSize?: number;
    fontWeight?: number;
    color?: string;
    alignment?: "left" | "center" | "right";
  };
}

export interface PageSchema {
  pageNumber: number;
  fields: SchemaField[];
}

export interface FormSchema {
  pages: PageSchema[];
}

export interface FillData {
  fields: Record<string, string | null>;
  assets: Record<string, string | null>; // base64 data URLs or file paths
}

export interface FillResult {
  success: boolean;
  pdfBuffer?: Buffer;
  pngBase64?: string;
  error?: string;
}

/**
 * Fill a PDF template using schema-based coordinates
 * Uses PyMuPDF redaction to properly remove original content before drawing new content
 */
export async function fillPdfWithPyMuPDF(
  templatePdfPath: string,
  schema: FormSchema,
  fillData: FillData
): Promise<FillResult> {
  const tempDir = path.join(os.tmpdir(), `pdf-fill-${Date.now()}`);

  try {
    await fs.mkdir(tempDir, { recursive: true });

    const outputPdfPath = path.join(tempDir, "filled.pdf");
    const outputPngPath = path.join(tempDir, "preview.png");
    const schemaPath = path.join(tempDir, "schema.json");
    const fillDataPath = path.join(tempDir, "fill_data.json");

    // Save images to temp files and update paths
    const processedAssets: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(fillData.assets)) {
      if (value && value.startsWith("data:")) {
        const matches = value.match(/^data:image\/(\w+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
          const imgPath = path.join(tempDir, `${key}.${ext}`);
          await fs.writeFile(imgPath, Buffer.from(matches[2], "base64"));
          processedAssets[key] = imgPath;
        } else {
          processedAssets[key] = null;
        }
      } else {
        processedAssets[key] = value;
      }
    }

    // Write schema and fill data
    await fs.writeFile(schemaPath, JSON.stringify(schema));
    await fs.writeFile(fillDataPath, JSON.stringify({
      fields: fillData.fields,
      assets: processedAssets,
    }));

    // Python script that uses schema coordinates with proper redaction
    const pythonScript = `
import fitz
import json
import sys
import os

def hex_to_rgb(hex_color):
    """Convert hex color to RGB tuple (0-1 range)"""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) / 255 for i in (0, 2, 4))

def fill_pdf(template_path, output_path, schema_path, fill_data_path, png_output_path):
    # Load schema and fill data
    with open(schema_path, 'r') as f:
        schema = json.load(f)
    with open(fill_data_path, 'r') as f:
        fill_data = json.load(f)

    fields = fill_data.get('fields', {})
    assets = fill_data.get('assets', {})

    # Open the template
    doc = fitz.open(template_path)

    # Process each page
    for page_schema in schema.get('pages', []):
        page_num = page_schema.get('pageNumber', 1) - 1
        if page_num >= len(doc):
            continue

        page = doc[page_num]
        page_height = page.rect.height

        # Collect fields that have values to fill
        fields_to_fill = []
        for field in page_schema.get('fields', []):
            field_name = field['name']
            field_type = field['type']

            if field_type == 'text':
                value = fields.get(field_name)
                if value is not None:
                    fields_to_fill.append((field, value, 'text'))
            elif field_type == 'image':
                asset_path = assets.get(field_name)
                if asset_path and os.path.exists(asset_path):
                    fields_to_fill.append((field, asset_path, 'image'))

        # First pass: add redaction annotations for all fields we're filling
        for field, value, ftype in fields_to_fill:
            bbox = field['bbox']
            # Schema coordinates use TOP-LEFT origin (same as PyMuPDF)
            # Use coordinates directly
            rect = fitz.Rect(
                bbox['x'],
                bbox['y'],
                bbox['x'] + bbox['width'],
                bbox['y'] + bbox['height']
            )
            # Add redaction with no fill (transparent) - this removes content
            page.add_redact_annot(rect, fill=False)

        # Apply all redactions at once (this actually removes the content)
        page.apply_redactions()

        # Second pass: draw new content
        for field, value, ftype in fields_to_fill:
            bbox = field['bbox']
            # Schema coordinates use TOP-LEFT origin (same as PyMuPDF)
            # Use coordinates directly

            if ftype == 'image':
                rect = fitz.Rect(
                    bbox['x'],
                    bbox['y'],
                    bbox['x'] + bbox['width'],
                    bbox['y'] + bbox['height']
                )
                try:
                    page.insert_image(rect, filename=value)
                except Exception as e:
                    print(f"Failed to insert image {field['name']}: {e}", file=sys.stderr)
            else:
                # Text field
                style = field.get('style', {})
                fontsize = style.get('fontSize', 10)
                fontweight = style.get('fontWeight', 400)
                color = hex_to_rgb(style.get('color', '#000000'))
                alignment = style.get('alignment', 'left')

                # Choose font based on weight
                fontname = "hebo" if fontweight >= 700 else "helv"

                # Check if text needs wrapping (bbox height > 1.5x font size suggests multi-line)
                is_multiline = bbox['height'] > fontsize * 1.5

                if is_multiline:
                    # Use textbox for multi-line text with automatic wrapping
                    rect = fitz.Rect(
                        bbox['x'],
                        bbox['y'],
                        bbox['x'] + bbox['width'],
                        bbox['y'] + bbox['height']
                    )

                    # Map alignment to textbox align parameter
                    align_map = {'left': fitz.TEXT_ALIGN_LEFT, 'center': fitz.TEXT_ALIGN_CENTER, 'right': fitz.TEXT_ALIGN_RIGHT}
                    align = align_map.get(alignment, fitz.TEXT_ALIGN_LEFT)

                    try:
                        page.insert_textbox(
                            rect,
                            value,
                            fontsize=fontsize,
                            fontname=fontname,
                            color=color,
                            align=align
                        )
                    except Exception as e:
                        print(f"Failed to insert textbox {field['name']}: {e}", file=sys.stderr)
                        # Fallback to simple text
                        try:
                            page.insert_text((bbox['x'], bbox['y'] + fontsize), value, fontsize=fontsize, color=color)
                        except:
                            pass
                else:
                    # Single line text - use insert_text for precise positioning
                    x = bbox['x']
                    y = bbox['y'] + fontsize  # baseline position within the box

                    # Handle alignment
                    if alignment == 'center':
                        text_width = fitz.get_text_length(value, fontname=fontname, fontsize=fontsize)
                        x = bbox['x'] + (bbox['width'] - text_width) / 2
                    elif alignment == 'right':
                        text_width = fitz.get_text_length(value, fontname=fontname, fontsize=fontsize)
                        x = bbox['x'] + bbox['width'] - text_width

                    try:
                        page.insert_text(
                            (x, y),
                            value,
                            fontsize=fontsize,
                            fontname=fontname,
                            color=color
                        )
                    except Exception as e:
                        print(f"Failed to insert text {field['name']}: {e}", file=sys.stderr)
                        # Fallback with default font
                        try:
                            page.insert_text((x, y), value, fontsize=fontsize, color=color)
                        except:
                            pass

    # Save the filled PDF
    doc.save(output_path)

    # Generate PNG preview
    page = doc[0]
    pix = page.get_pixmap(dpi=150)
    pix.save(png_output_path)

    doc.close()
    print("SUCCESS")

if __name__ == "__main__":
    fill_pdf(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
`;

    const scriptPath = path.join(tempDir, "fill_script.py");
    await fs.writeFile(scriptPath, pythonScript);

    log.info(`Filling PDF with PyMuPDF: ${templatePdfPath}`);
    log.debug(`Fields: ${Object.keys(fillData.fields).length}, Assets: ${Object.keys(fillData.assets).length}`);

    // Run the Python script
    const { stdout, stderr } = await execAsync(
      `python3 "${scriptPath}" "${templatePdfPath}" "${outputPdfPath}" "${schemaPath}" "${fillDataPath}" "${outputPngPath}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );

    if (stderr) {
      log.debug(`Python stderr: ${stderr}`);
    }

    if (!stdout.includes("SUCCESS")) {
      throw new Error(`Fill script failed: ${stderr || stdout}`);
    }

    const pdfBuffer = await fs.readFile(outputPdfPath);
    const pngBuffer = await fs.readFile(outputPngPath);
    const pngBase64 = `data:image/png;base64,${pngBuffer.toString("base64")}`;

    log.info("PDF filled successfully with PyMuPDF");

    await fs.rm(tempDir, { recursive: true }).catch(() => {});

    return {
      success: true,
      pdfBuffer,
      pngBase64,
    };
  } catch (error) {
    log.error("Failed to fill PDF with PyMuPDF", error);
    await fs.rm(tempDir, { recursive: true }).catch(() => {});
    return {
      success: false,
      error: `Failed to fill PDF: ${error}`,
    };
  }
}

/**
 * Convert PDF to PNG using pdftoppm (faster for simple preview)
 */
export async function pdfToPng(pdfBuffer: Buffer, dpi: number = 150): Promise<string> {
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
