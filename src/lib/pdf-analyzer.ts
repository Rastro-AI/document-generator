/**
 * PDF Analyzer - analyzes PDFs and creates blanked base templates
 * Uses PyMuPDF for proper redaction (removes content without filling)
 */

import { PDFDocument } from "pdf-lib";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";

const execAsync = promisify(exec);

// Logger
const log = {
  info: (msg: string, data?: unknown) => {
    console.log(`[pdf-analyzer] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    console.error(`[pdf-analyzer] ERROR: ${msg}`, data !== undefined ? data : "");
  },
};

export interface BlankRegion {
  pageNumber: number;
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Field name for placeholder label (used for images) */
  fieldName?: string;
  /** Type of field - images get gray placeholder, text just gets removed */
  fieldType?: "text" | "image";
}

export interface AnalysisResult {
  pageCount: number;
  pageDimensions: Array<{ width: number; height: number }>;
}

/**
 * Analyze a PDF to get basic structure info
 */
export async function analyzePdf(pdfBuffer: Buffer): Promise<AnalysisResult> {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pages = pdfDoc.getPages();

  const pageDimensions = pages.map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });

  return {
    pageCount: pages.length,
    pageDimensions,
  };
}

/**
 * Blank out specified regions in a PDF using PyMuPDF redaction
 * This properly removes content without filling with any color (transparent)
 *
 * @param pdfBuffer - The original PDF buffer
 * @param regions - Array of regions to blank out (bbox uses TOP-LEFT origin from PyMuPDF)
 * @returns Buffer with blanked regions
 */
export async function blankPdfRegions(
  pdfBuffer: Buffer,
  regions: BlankRegion[]
): Promise<Buffer> {
  if (regions.length === 0) {
    return pdfBuffer;
  }

  log.info(`Blanking ${regions.length} regions in PDF using PyMuPDF redaction`);

  // Create temp files for PyMuPDF processing
  const tempDir = path.join(os.tmpdir(), `pdf-blank-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  const inputPath = path.join(tempDir, "input.pdf");
  const outputPath = path.join(tempDir, "output.pdf");
  const regionsPath = path.join(tempDir, "regions.json");

  try {
    // Write input files
    await fs.writeFile(inputPath, pdfBuffer);
    await fs.writeFile(regionsPath, JSON.stringify(regions));

    // Python script that uses PyMuPDF for proper redaction
    // Text fields: redact with fill=False (transparent - preserves background)
    // Image fields: redact and draw gray placeholder with field name
    const pythonScript = `
import fitz
import json
import sys

def blank_regions(input_path, output_path, regions_path):
    with open(regions_path, 'r') as f:
        regions = json.load(f)

    doc = fitz.open(input_path)

    # Group regions by page
    by_page = {}
    for region in regions:
        page_num = region['pageNumber'] - 1
        if page_num not in by_page:
            by_page[page_num] = []
        by_page[page_num].append(region)

    # Process each page
    for page_num, page_regions in by_page.items():
        if page_num >= len(doc):
            continue

        page = doc[page_num]

        # Separate text and image regions
        text_regions = [r for r in page_regions if r.get('fieldType') != 'image']
        image_regions = [r for r in page_regions if r.get('fieldType') == 'image']

        # First: Add redaction annotations for text fields (no fill - transparent)
        for region in text_regions:
            bbox = region['bbox']
            rect = fitz.Rect(
                bbox['x'],
                bbox['y'],
                bbox['x'] + bbox['width'],
                bbox['y'] + bbox['height']
            )
            page.add_redact_annot(rect, fill=False)

        # Add redaction annotations for image fields (light gray fill)
        for region in image_regions:
            bbox = region['bbox']
            rect = fitz.Rect(
                bbox['x'],
                bbox['y'],
                bbox['x'] + bbox['width'],
                bbox['y'] + bbox['height']
            )
            # Light gray fill for image placeholders
            page.add_redact_annot(rect, fill=(0.95, 0.95, 0.95))

        # Apply all redactions at once
        page.apply_redactions()

        # Draw placeholder labels for image fields
        for region in image_regions:
            bbox = region['bbox']
            field_name = region.get('fieldName', 'IMAGE')
            rect = fitz.Rect(
                bbox['x'],
                bbox['y'],
                bbox['x'] + bbox['width'],
                bbox['y'] + bbox['height']
            )

            # Draw border
            page.draw_rect(rect, color=(0.8, 0.8, 0.8), width=1)

            # Add field name label in center
            label = '{{' + field_name + '}}'
            fontsize = min(10, bbox['width'] / len(label) * 1.5)  # Scale font to fit
            fontsize = max(6, min(fontsize, 12))  # Clamp between 6-12

            # Calculate center position
            text_width = fitz.get_text_length(label, fontname='helv', fontsize=fontsize)
            x = bbox['x'] + (bbox['width'] - text_width) / 2
            y = bbox['y'] + bbox['height'] / 2 + fontsize / 3  # Roughly center vertically

            page.insert_text((x, y), label, fontsize=fontsize, fontname='helv', color=(0.5, 0.5, 0.5))

    doc.save(output_path)
    doc.close()

if __name__ == '__main__':
    blank_regions(sys.argv[1], sys.argv[2], sys.argv[3])
`;

    // Write and execute Python script
    const scriptPath = path.join(tempDir, "blank.py");
    await fs.writeFile(scriptPath, pythonScript);

    await execAsync(`python3 "${scriptPath}" "${inputPath}" "${outputPath}" "${regionsPath}"`);

    // Read result
    const resultBuffer = await fs.readFile(outputPath);
    return resultBuffer;
  } finally {
    // Cleanup
    await fs.rm(tempDir, { recursive: true }).catch(() => {});
  }
}

/**
 * Save both original and blanked PDF versions
 */
export async function saveTemplateBase(
  originalPdfBuffer: Buffer,
  blankedPdfBuffer: Buffer,
  templateDir: string
): Promise<void> {
  await fs.mkdir(templateDir, { recursive: true });

  await Promise.all([
    fs.writeFile(`${templateDir}/original.pdf`, originalPdfBuffer),
    fs.writeFile(`${templateDir}/base.pdf`, blankedPdfBuffer),
  ]);

  log.info(`Saved template base to ${templateDir}`);
}
