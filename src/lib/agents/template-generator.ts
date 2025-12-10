/**
 * Template Generator Agent - PDF Form-Fill Approach
 * Analyzes PDFs to identify dynamic regions, creates schema.json + base.pdf
 */

import {
  Agent,
  run,
  tool,
  setDefaultModelProvider,
} from "@openai/agents-core";
import { OpenAIProvider, codeInterpreterTool } from "@openai/agents-openai";
import { z } from "zod";
import OpenAI from "openai";
import { fillPdfTemplate, FormTemplateSchema } from "@/lib/pdf-filler";
import { blankPdfRegions, BlankRegion } from "@/lib/pdf-analyzer";
import path from "path";
import fsSync from "fs";
import fs from "fs/promises";
import os from "os";

// Logger
const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [template-generator] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [template-generator] ERROR: ${msg}`, data !== undefined ? data : "");
  },
  debug: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [template-generator] DEBUG: ${msg}`, data !== undefined ? data : "");
  },
};

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

// Lazy-load the OpenAI client
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

// Types
export interface GeneratorTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status" | "version" | "schema_updated";
  content: string;
  toolName?: string;
  version?: number;
  previewUrl?: string;
  pdfUrl?: string;
  schema?: FormTemplateSchema;
}

export type GeneratorEventCallback = (event: GeneratorTrace) => void;

export interface TemplateGeneratorResult {
  success: boolean;
  schema?: FormTemplateSchema;
  basePdfBuffer?: Buffer;
  originalPdfBuffer?: Buffer;
  message: string;
  versions?: Array<{ version: number; previewBase64: string; pdfBase64?: string }>;
}

// Legacy types for backward compat with frontend
export interface TemplateJsonField {
  name: string;
  type: string;
  description: string;
  example?: unknown;
}

export interface TemplateJson {
  id: string;
  name: string;
  canvas: { width: number; height: number };
  fields: TemplateJsonField[];
  assetSlots: Array<{ name: string; kind: string; description: string }>;
}

const SYSTEM_PROMPT = `You create reusable PDF templates by replacing dynamic content with placeholders.

YOUR GOAL: Edit the PDF directly to replace variable content with {{PLACEHOLDER}} markers.

WHAT TO REPLACE:
- DYNAMIC text (product names, specs, prices) → {{FIELD_NAME}} placeholder text
- DYNAMIC images (product photos, charts) → remove image, leave placeholder box

WHAT TO KEEP:
- STATIC text: Company name, section headers, labels like "Voltage:"
- STATIC images: Company logo, certification badges

COORDINATE SYSTEM:
- PyMuPDF uses TOP-LEFT origin (y=0 at top of page, y increases downward)
- Letter size: 612 x 792 points (width x height)

WORKFLOW:
1. Use code_interpreter to analyze the PDF with PyMuPDF:
   \`\`\`python
   import fitz
   doc = fitz.open("/mnt/user/original.pdf")
   page = doc[0]

   # Get all text with positions
   text_dict = page.get_text("dict")
   for block in text_dict["blocks"]:
       if block["type"] == 0:  # text block
           for line in block["lines"]:
               for span in line["spans"]:
                   print(f"Text: {span['text']}, Bbox: {span['bbox']}, Font: {span['font']}, Size: {span['size']}")

   # Get all images
   for img in page.get_images(full=True):
       xref = img[0]
       rects = page.get_image_rects(xref)
       print(f"Image xref={xref}, rects={rects}")
   \`\`\`

2. Classify content as DYNAMIC or STATIC

3. Replace dynamic content with placeholders:
   \`\`\`python
   import fitz
   doc = fitz.open("/mnt/user/original.pdf")
   page = doc[0]

   # Replace text - find and redact, then insert placeholder
   # For each dynamic text span:
   text_to_replace = "PAR38 LED BULB"  # example
   placeholder = "{{PRODUCT_TITLE}}"

   for block in page.get_text("dict")["blocks"]:
       if block["type"] == 0:
           for line in block["lines"]:
               for span in line["spans"]:
                   if text_to_replace in span["text"]:
                       rect = fitz.Rect(span["bbox"])
                       # Redact the original text (white fill)
                       page.add_redact_annot(rect, fill=(1, 1, 1))

   page.apply_redactions()

   # Insert placeholder text at same position
   # (Re-read positions after redaction if needed)
   page.insert_text((x, y), placeholder, fontsize=size, color=(0.3, 0.3, 0.3))

   # For images - redact and draw placeholder box
   img_rect = fitz.Rect(x0, y0, x1, y1)
   page.add_redact_annot(img_rect, fill=(0.95, 0.95, 0.95))  # Light gray
   page.apply_redactions()
   page.draw_rect(img_rect, color=(0.7, 0.7, 0.7), width=1)
   page.insert_text((x0+5, y1-15), "{{IMAGE_FIELD}}", fontsize=10, color=(0.5, 0.5, 0.5))

   doc.save("/mnt/user/edited.pdf")
   doc.close()
   \`\`\`

4. Call save_edited_pdf to use your edited PDF

5. Call write_form_schema with field definitions (for fill-time use)

6. WAIT for preview - compare to original

7. Iterate if needed, then call mark_complete

TIPS:
- Process ALL dynamic fields in ONE code_interpreter call
- Use page.apply_redactions() ONCE after all redact annotations
- Insert placeholder text AFTER applying redactions
- For multi-line text, may need to redact multiple spans
- Group related spans into single fields (e.g., model list)

FULL PDF EDITING CAPABILITIES:
You have full control to edit the PDF however needed:

\`\`\`python
import fitz
doc = fitz.open("/mnt/user/original.pdf")
page = doc[0]

# REMOVE anything with redaction (text, images, lines, shapes):
page.add_redact_annot(fitz.Rect(x0, y0, x1, y1), fill=(1,1,1))  # white fill
page.apply_redactions()

# ADD text anywhere:
page.insert_text((x, y), "New text", fontsize=12, color=(0,0,0))

# ADD shapes:
page.draw_rect(fitz.Rect(x0, y0, x1, y1), color=(0,0,0), width=1)
page.draw_line((x0, y0), (x1, y1), color=(0,0,0), width=1)
page.draw_circle((cx, cy), radius, color=(0,0,0), width=1)

# ADD images:
img_rect = fitz.Rect(x0, y0, x1, y1)
page.insert_image(img_rect, filename="image.png")

# CHANGE page background or fill areas:
shape = page.new_shape()
shape.draw_rect(fitz.Rect(x0, y0, x1, y1))
shape.finish(color=(1,1,1), fill=(1,1,1))
shape.commit()

doc.save("/mnt/user/edited.pdf")
\`\`\`

REMOVING LINES AND VECTOR GRAPHICS:
Lines/borders in PDFs are vector paths. The write_blank_regions tool CANNOT remove lines - you MUST use code_interpreter to edit the PDF directly.

WORKFLOW FOR LINE REMOVAL:
1. Use code_interpreter to find and remove lines:
   \`\`\`python
   import fitz
   doc = fitz.open("/mnt/user/original.pdf")
   page = doc[0]

   # Find all drawings/paths on the page
   drawings = page.get_drawings()
   for d in drawings:
       print(f"Drawing: rect={d['rect']}, type={d.get('type')}")

   # Remove lines by redacting with oversized rect (add padding)
   line_rect = fitz.Rect(x0-2, y0-2, x1+2, y1+2)  # Add 2pt padding
   page.add_redact_annot(line_rect, fill=(1,1,1))  # White fill
   page.apply_redactions()

   # OR for stubborn lines, draw white over them:
   shape = page.new_shape()
   shape.draw_rect(fitz.Rect(x0-2, y0-2, x1+2, y1+2))
   shape.finish(color=(1,1,1), fill=(1,1,1))
   shape.commit()

   # IMPORTANT: Save to edited.pdf
   doc.save("/mnt/user/edited.pdf")
   doc.close()
   \`\`\`

2. THEN call save_edited_pdf to use your edited version

Use these capabilities to:
- Remove unwanted borders, lines, decorative elements
- Clean up the template layout
- Add placeholder boxes for images
- Fix any visual issues

FIELD NAMING: SCREAMING_SNAKE_CASE (PRODUCT_NAME, HERO_IMAGE)

FIELD DESCRIPTIONS (CRITICAL):
Each field needs a semantic description for another LLM to fill:
- GOOD: "The main product title displayed as bold heading (e.g., 'PAR38 LED BULB')"
- GOOD: "Operating voltage spec value (e.g., '120V')"
- BAD: "Text at position (100, 200)"`;


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
 * Run the template generator agent
 */
export async function runTemplateGeneratorAgent(
  pdfPageImages: string | string[],
  pdfBuffer: Buffer,  // The PDF to work from - for continuations this is the current edited base
  pdfFilename: string,
  userPrompt?: string,
  onEvent?: GeneratorEventCallback,
  reasoning: "none" | "low" | "high" = "low",
  // Continuation parameters
  existingSchema?: FormTemplateSchema,
  feedback?: string,
  startVersion: number = 0
): Promise<TemplateGeneratorResult> {
  const pageImages = Array.isArray(pdfPageImages) ? pdfPageImages : [pdfPageImages];
  const isContinuation = !!(existingSchema && feedback);

  log.info(`\n${"#".repeat(80)}`);
  log.info(`### TEMPLATE GENERATOR ${isContinuation ? "CONTINUING" : "STARTED"} ###`);
  log.info(`${"#".repeat(80)}`);
  log.info(`PDF filename: ${pdfFilename}`);
  log.info(`Reasoning level: ${reasoning}`);
  log.info(`User prompt: ${userPrompt || "(none)"}`);
  log.info(`Continuation mode: ${isContinuation}`);
  log.info(`PDF pages: ${pageImages.length}`);
  log.info(`PDF buffer size: ${pdfBuffer.length} bytes`);

  ensureProvider();
  const openai = getOpenAI();

  // State tracking
  const versions: Array<{ version: number; previewBase64: string; pdfBase64?: string }> = [];
  let currentVersion = startVersion;
  let currentSchema: FormTemplateSchema | null = existingSchema || null;

  // If continuing with existing schema, auto-derive blank regions from field bboxes
  let blankRegions: BlankRegion[] = [];
  if (existingSchema) {
    for (const page of existingSchema.pages) {
      for (const field of page.fields) {
        blankRegions.push({
          pageNumber: page.pageNumber,
          bbox: field.bbox,
          fieldName: field.name,
          fieldType: field.type as "text" | "image",
        });
      }
    }
    log.info(`Continuation mode: derived ${blankRegions.length} blank regions from existing schema`);
  }

  let isComplete = false;
  let needsPreview = isContinuation; // If continuing, generate preview immediately with existing schema
  let containerId: string | null = null;

  try {
    // Create container and upload files
    onEvent?.({ type: "status", content: isContinuation ? "Applying feedback..." : "Creating container..." });
    log.info("Creating OpenAI container...");

    const container = await openai.containers.create({
      name: `template-gen-${Date.now()}`,
    });
    containerId = container.id;
    log.info("Container created", containerId);

    // Upload PDF
    onEvent?.({ type: "status", content: "Uploading PDF to container..." });
    const pdfPath = path.join(os.tmpdir(), "original.pdf");
    fsSync.writeFileSync(pdfPath, pdfBuffer);
    const pdfStream = fsSync.createReadStream(pdfPath);
    await openai.containers.files.create(containerId, { file: pdfStream });
    log.info("Original PDF uploaded to container");
    fsSync.unlinkSync(pdfPath);

    // Upload screenshots
    for (let i = 0; i < pageImages.length; i++) {
      const pageNum = i + 1;
      const screenshotBuffer = Buffer.from(pageImages[i].split(",")[1], "base64");
      const screenshotPath = path.join(os.tmpdir(), `original_screenshot_page${pageNum}.png`);
      fsSync.writeFileSync(screenshotPath, screenshotBuffer);
      const screenshotStream = fsSync.createReadStream(screenshotPath);
      await openai.containers.files.create(containerId, { file: screenshotStream });
      log.info(`Screenshot page ${pageNum}/${pageImages.length} uploaded`);
      fsSync.unlinkSync(screenshotPath);
    }

    onEvent?.({ type: "status", content: "Analyzing PDF structure..." });

    // Create tools
    const writeFormSchemaTool = tool({
      name: "write_form_schema",
      description: "Write the form schema defining dynamic field positions. Coordinates use TOP-LEFT origin (y increases downward).",
      parameters: z.object({
        pages: z.array(z.object({
          pageNumber: z.number(),
          fields: z.array(z.object({
            name: z.string().describe("SCREAMING_SNAKE_CASE field name"),
            type: z.enum(["text", "image"]),
            description: z.string().describe("Semantic description of what content this field should contain - be specific so another LLM can fill it correctly. E.g. 'The main product name/title displayed prominently' or 'Product hero image showing the item from front angle'"),
            bbox: z.object({
              x: z.number().describe("Left edge in points from left"),
              y: z.number().describe("Top edge in points from TOP of page"),
              width: z.number(),
              height: z.number(),
            }),
            style: z.object({
              fontFamily: z.string().nullable().optional(),
              fontWeight: z.number().nullable().optional(),
              fontSize: z.number().nullable().optional(),
              color: z.string().nullable().optional().describe("Hex color like #000000"),
              alignment: z.enum(["left", "center", "right"]).nullable().optional(),
            }).nullable().optional().describe("For text fields only"),
            objectFit: z.enum(["contain", "cover", "fill"]).nullable().optional().describe("For image fields only"),
          })),
        })),
      }),
      execute: async ({ pages }) => {
        onEvent?.({ type: "tool_call", content: `Writing form schema (${pages.reduce((sum: number, p: { fields: unknown[] }) => sum + p.fields.length, 0)} fields)`, toolName: "write_form_schema" });

        currentSchema = { version: 1, pages, fonts: [] };
        needsPreview = true; // Trigger preview generation
        log.info(`write_form_schema: ${pages.length} pages, ${pages.reduce((sum: number, p: { fields: unknown[] }) => sum + p.fields.length, 0)} fields`);

        onEvent?.({
          type: "schema_updated",
          content: `Schema updated: ${pages.reduce((sum: number, p: { fields: unknown[] }) => sum + p.fields.length, 0)} fields`,
          schema: currentSchema ?? undefined,
        });

        return `Schema written with ${pages.reduce((sum: number, p: { fields: unknown[] }) => sum + p.fields.length, 0)} fields. Call write_blank_regions next to specify which areas to blank out.`;
      },
    });

    const writeBlankRegionsTool = tool({
      name: "write_blank_regions",
      description: "Specify regions to blank out in the base PDF. Include: (1) regions matching dynamic field areas, (2) any unwanted visual elements like borders, lines, or decorative graphics that should be removed. Coordinates use TOP-LEFT origin. Text fields are removed transparently (background preserved). Image fields get gray placeholder with field name.",
      parameters: z.object({
        regions: z.array(z.object({
          pageNumber: z.number(),
          bbox: z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
          }),
          reason: z.string().nullable().describe("Why this region is being blanked (e.g., 'dynamic field', 'unwanted border', 'decorative line to remove'). Can be null."),
        })),
      }),
      execute: async ({ regions }) => {
        onEvent?.({ type: "tool_call", content: `Marking ${regions.length} regions for blanking`, toolName: "write_blank_regions" });

        // Enrich regions with field type info from schema (for proper placeholder rendering)
        // Text fields: transparent removal, Image fields: gray placeholder with name
        const enrichedRegions: BlankRegion[] = regions.map((region: { pageNumber: number; bbox: { x: number; y: number; width: number; height: number }; reason: string | null }) => {
          // Try to find matching field in schema by bbox overlap
          let fieldName: string | undefined;
          let fieldType: "text" | "image" | undefined;

          if (currentSchema) {
            for (const page of currentSchema.pages) {
              if (page.pageNumber === region.pageNumber) {
                for (const field of page.fields) {
                  // Check if bboxes are similar (within 5pt tolerance)
                  const tolerance = 5;
                  if (
                    Math.abs(field.bbox.x - region.bbox.x) < tolerance &&
                    Math.abs(field.bbox.y - region.bbox.y) < tolerance &&
                    Math.abs(field.bbox.width - region.bbox.width) < tolerance &&
                    Math.abs(field.bbox.height - region.bbox.height) < tolerance
                  ) {
                    fieldName = field.name;
                    fieldType = field.type as "text" | "image";
                    break;
                  }
                }
              }
            }
          }

          return {
            pageNumber: region.pageNumber,
            bbox: region.bbox,
            fieldName,
            fieldType,
          };
        });

        blankRegions = enrichedRegions;
        needsPreview = true; // Trigger preview generation
        log.info(`write_blank_regions: ${regions.length} regions`);
        return `Marked ${regions.length} regions for blanking. Will generate preview.`;
      },
    });

    const readFormSchemaTool = tool({
      name: "read_form_schema",
      description: "Read the current form schema to see field definitions",
      parameters: z.object({}),
      execute: async () => {
        onEvent?.({ type: "tool_call", content: "Reading form schema", toolName: "read_form_schema" });
        if (!currentSchema) {
          return "No schema defined yet. Use write_form_schema to create one.";
        }
        return JSON.stringify(currentSchema, null, 2);
      },
    });

    // Track if we're using an edited PDF
    let editedPdfBuffer: Buffer | null = null;

    const saveEditedPdfTool = tool({
      name: "save_edited_pdf",
      description: `ONLY call this AFTER you have used code_interpreter to edit the PDF and save it to /mnt/user/edited.pdf.

REQUIRED WORKFLOW:
1. Use code_interpreter with PyMuPDF to edit the PDF:
   \`\`\`python
   import fitz
   doc = fitz.open("/mnt/user/original.pdf")
   page = doc[0]
   # ... make edits (remove lines, text, etc.) ...
   doc.save("/mnt/user/edited.pdf")
   doc.close()
   \`\`\`
2. THEN call save_edited_pdf to use your edited version.

This tool reads /mnt/user/edited.pdf from the container - if you haven't created that file, it will fail.`,
      parameters: z.object({
        description: z.string().describe("Brief description of what edits were made to the PDF"),
      }),
      execute: async ({ description }) => {
        onEvent?.({ type: "tool_call", content: `Saving edited PDF: ${description}`, toolName: "save_edited_pdf" });

        try {
          // Download the edited PDF from the container
          const filesResponse = await openai.containers.files.list(containerId!);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const editedFile = (filesResponse.data as any[]).find((f) => f.name === "edited.pdf");

          if (!editedFile) {
            return "Error: No edited.pdf found in container. Make sure to save your edited PDF to /mnt/user/edited.pdf";
          }

          // Download the file content
          const fileContent = await openai.containers.files.content.retrieve(editedFile.id, { container_id: containerId! });
          const arrayBuffer = await fileContent.arrayBuffer();
          editedPdfBuffer = Buffer.from(arrayBuffer);

          needsPreview = true; // Trigger preview with edited PDF
          log.info(`save_edited_pdf: Loaded edited PDF (${editedPdfBuffer.length} bytes) - ${description}`);

          return `Edited PDF saved (${editedPdfBuffer.length} bytes). Will use this as the base template. Preview will be generated.`;
        } catch (error) {
          log.error("Failed to load edited PDF", error);
          return `Error loading edited PDF: ${error}`;
        }
      },
    });

    const markCompleteTool = tool({
      name: "mark_complete",
      description: "Call ONLY after you have seen and reviewed the preview image. Do NOT call this on your first turn - wait until you've compared the preview with the original.",
      parameters: z.object({
        message: z.string().describe("Brief summary of what looks correct in the preview"),
      }),
      execute: async ({ message }) => {
        // Don't allow completion until at least one preview has been generated
        if (currentVersion === 0) {
          log.info("mark_complete REJECTED: No preview generated yet");
          return "Cannot mark complete yet - no preview has been generated. Call write_form_schema and write_blank_regions first, then wait for the preview to be generated before calling mark_complete.";
        }
        onEvent?.({ type: "tool_call", content: `Marking complete: ${message}`, toolName: "mark_complete" });
        isComplete = true;
        log.info(`mark_complete: ${message}`);
        return "Generation marked complete.";
      },
    });

    // Create agent
    const agent = new Agent({
      name: "TemplateGenerator",
      instructions: SYSTEM_PROMPT,
      model: "gpt-5.1",
      modelSettings: {
        reasoning: { effort: reasoning },
      },
      tools: [
        codeInterpreterTool({ container: containerId }),
        writeFormSchemaTool,
        writeBlankRegionsTool,
        readFormSchemaTool,
        saveEditedPdfTool,
        markCompleteTool,
      ],
    });

    // Build initial prompt
    const pageFileList = pageImages.length > 1
      ? pageImages.map((_, i) => `- /mnt/user/original_screenshot_page${i + 1}.png`).join("\n")
      : "- /mnt/user/original_screenshot_page1.png";

    let initialPrompt: string;
    if (isContinuation) {
      initialPrompt = `You are refining a form schema based on user feedback.

USER FEEDBACK:
${feedback}

Current schema:
${JSON.stringify(existingSchema, null, 2)}

Use read_form_schema to see current state, then update with write_form_schema.
Files: /mnt/user/original.pdf
${pageFileList}`;
    } else {
      initialPrompt = `Analyze this PDF and create a form schema identifying dynamic fields.

Original filename: ${pdfFilename}
${userPrompt ? `\nUSER INSTRUCTIONS:\n${userPrompt}\n` : ""}
Files in container:
- /mnt/user/original.pdf
${pageFileList}

Steps:
1. Use code_interpreter with PyMuPDF (fitz) to analyze the PDF structure
2. Identify DYNAMIC text (product data) vs STATIC text (labels, headers)
3. Identify DYNAMIC images (product photos) vs STATIC images (logos)
4. Call write_form_schema with field definitions
5. Call write_blank_regions with areas to white-out
6. Review the preview and refine if needed`;
    }

    // Iteration loop
    const MAX_ITERATIONS = 10;
    log.info("Starting iteration loop", { maxIterations: MAX_ITERATIONS });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let conversationHistory: any[] = [];
    let lastPreviewPng: string | null = null;

    for (let iteration = 0; iteration < MAX_ITERATIONS && !isComplete; iteration++) {
      log.info(`\n=== ITERATION ${iteration + 1}/${MAX_ITERATIONS} ===`);
      onEvent?.({
        type: "status",
        content: iteration === 0
          ? (isContinuation ? "Applying feedback..." : "Analyzing PDF...")
          : `Refining schema (iteration ${iteration + 1})...`,
      });

      // Build input
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let input: any;

      if (iteration === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const initialContent: any[] = [{ type: "input_text", text: initialPrompt }];
        for (let i = 0; i < pageImages.length; i++) {
          initialContent.push({ type: "input_text", text: `\n--- Page ${i + 1} ---` });
          initialContent.push({ type: "input_image", image: pageImages[i] });
        }
        input = [{ role: "user", content: initialContent }];
      } else {
        // Show comparison
        const comparisonText = `PREVIEW - Version ${currentVersion}

Left: Original PDF
Right: Your filled template preview

Compare the field placements. Are all dynamic regions correctly identified?
- Text fields should cover product-specific text
- Image fields should cover product images
- Blank regions should match field positions

Use write_form_schema to adjust field positions if needed.
Call mark_complete when satisfied.`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content: any[] = [
          { type: "input_text", text: comparisonText },
          { type: "input_image", image: pageImages[0] },
        ];
        if (lastPreviewPng) {
          content.push({ type: "input_image", image: lastPreviewPng });
        }
        input = [...conversationHistory, { role: "user", content }];
      }

      // Run agent
      const result = await run(agent, input, { maxTurns: 15 });
      conversationHistory = result.history || [];

      // Process traces
      for (const item of result.newItems || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyItem = item as any;

        if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
          const reasoningText = extractReasoningText(anyItem.rawItem);
          if (reasoningText) {
            log.info(`[REASONING] ${reasoningText.substring(0, 200)}...`);
            onEvent?.({ type: "reasoning", content: reasoningText });
          }
        }

        if (anyItem.type === "message_output_item" && anyItem.rawItem) {
          const content = anyItem.rawItem.content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === "output_text" && part.text) {
                log.info(`[MODEL] ${part.text.substring(0, 200)}...`);
                onEvent?.({ type: "reasoning", content: part.text });
              }
            }
          }
        }

        if (anyItem.type === "tool_call_output_item") {
          const toolName = anyItem.rawItem?.name || "unknown";
          const output = typeof anyItem.output === "string"
            ? anyItem.output.substring(0, 150)
            : String(anyItem.output).substring(0, 150);
          log.info(`[TOOL RESULT] ${toolName}: ${output}`);
          onEvent?.({ type: "tool_result", content: output, toolName });
        }
      }

      // Generate preview if edited PDF is available OR schema + regions are defined
      const canGeneratePreview = needsPreview && (editedPdfBuffer || (currentSchema && blankRegions.length > 0));
      if (canGeneratePreview) {
        needsPreview = false; // Reset flag
        currentVersion++;
        log.info(`\n--- RENDERING VERSION ${currentVersion} ---`);
        onEvent?.({ type: "status", content: `Rendering version ${currentVersion}...` });

        try {
          const tempDir = path.join(os.tmpdir(), `template-preview-${Date.now()}`);
          await fs.mkdir(tempDir, { recursive: true });

          let previewPdfBuffer: Buffer;
          let pngBase64: string;

          if (editedPdfBuffer) {
            // New approach: Agent edited PDF directly with placeholders
            // Apply any additional blank regions if specified
            log.info("Using agent-edited PDF (already has placeholders)");
            previewPdfBuffer = blankRegions.length > 0
              ? await blankPdfRegions(editedPdfBuffer, blankRegions)
              : editedPdfBuffer;

            // Convert to PNG using pdftoppm
            const pdfPath = path.join(tempDir, "preview.pdf");
            const pngPathBase = path.join(tempDir, "preview");
            await fs.writeFile(pdfPath, previewPdfBuffer);

            const { exec } = await import("child_process");
            const { promisify } = await import("util");
            const execAsync = promisify(exec);
            await execAsync(`pdftoppm -png -f 1 -l 1 -r 150 "${pdfPath}" "${pngPathBase}"`);
            const pngBuffer = await fs.readFile(`${pngPathBase}-1.png`);
            pngBase64 = `data:image/png;base64,${pngBuffer.toString("base64")}`;
          } else {
            // Legacy approach: Blank regions + fill with placeholders
            log.info("Using blank regions + placeholder fill approach");
            const basePdf = await blankPdfRegions(pdfBuffer, blankRegions);
            const basePdfPath = path.join(tempDir, "base.pdf");
            await fs.writeFile(basePdfPath, basePdf);

            // Generate placeholder values
            const fields: Record<string, string> = {};
            const assets: Record<string, string | null> = {};
            const schema = currentSchema!;
            for (const page of schema.pages) {
              for (const field of page.fields) {
                if (field.type === "text") {
                  fields[field.name] = `{{${field.name}}}`;
                } else {
                  assets[field.name] = null;
                }
              }
            }

            const fillResult = await fillPdfTemplate(basePdfPath, schema, {
              fields,
              assets,
              templateRoot: tempDir,
            });

            if (!fillResult.success || !fillResult.pngBase64) {
              throw new Error(fillResult.error || "Fill failed");
            }

            previewPdfBuffer = fillResult.pdfBuffer!;
            pngBase64 = fillResult.pngBase64;
          }

          // Cleanup temp dir
          await fs.rm(tempDir, { recursive: true }).catch(() => {});

          // Process successful render
          log.info(`VERSION ${currentVersion} SUCCESS`);
          const pdfBase64 = previewPdfBuffer
            ? `data:application/pdf;base64,${previewPdfBuffer.toString("base64")}`
            : undefined;

          versions.push({ version: currentVersion, previewBase64: pngBase64, pdfBase64 });
          lastPreviewPng = pngBase64;

          onEvent?.({
            type: "version",
            content: `Version ${currentVersion} rendered`,
            version: currentVersion,
            previewUrl: pngBase64,
            pdfUrl: pdfBase64,
            schema: currentSchema ?? undefined,
          });

          // Upload preview PDF to container for agent to see
          if (previewPdfBuffer) {
            const previewPdfPath = path.join(os.tmpdir(), `preview_v${currentVersion}.pdf`);
            fsSync.writeFileSync(previewPdfPath, previewPdfBuffer);
            const previewStream = fsSync.createReadStream(previewPdfPath);
            try {
              await openai.containers.files.create(containerId!, { file: previewStream });
            } catch (e) {
              log.error("Failed to upload preview", e);
            }
            fsSync.unlinkSync(previewPdfPath);
          }
        } catch (error) {
          log.error(`VERSION ${currentVersion} ERROR: ${error}`);
          onEvent?.({ type: "status", content: `Render error: ${error}` });
        }
      }

      log.info(`Iteration ${iteration + 1} complete`, { isComplete, version: currentVersion });
    }

    // Cleanup container
    log.info("Cleaning up container...");
    try {
      await openai.containers.delete(containerId);
    } catch (e) {
      log.error("Failed to delete container", e);
    }

    // Generate final outputs
    if (currentSchema && (blankRegions.length > 0 || editedPdfBuffer)) {
      log.info("Generating final base PDF...");

      // Use edited PDF if available, otherwise blank the original
      let finalBasePdf: Buffer;
      if (editedPdfBuffer) {
        log.info("Using edited PDF as final base");
        finalBasePdf = blankRegions.length > 0
          ? await blankPdfRegions(editedPdfBuffer, blankRegions)
          : editedPdfBuffer;
      } else {
        finalBasePdf = await blankPdfRegions(pdfBuffer, blankRegions);
      }

      return {
        success: true,
        schema: currentSchema,
        basePdfBuffer: finalBasePdf,
        originalPdfBuffer: pdfBuffer,
        message: `Template generated with ${currentSchema.pages.reduce((sum: number, p) => sum + p.fields.length, 0)} fields`,
        versions,
      };
    }

    return {
      success: false,
      message: "Failed to generate template - no schema produced",
      versions,
    };
  } catch (error) {
    log.error("Template generation EXCEPTION", error);
    if (containerId) {
      try {
        await getOpenAI().containers.delete(containerId);
      } catch (e) {
        log.error("Failed to cleanup container", e);
      }
    }
    return {
      success: false,
      message: `Generation failed: ${error}`,
      versions,
    };
  }
}

// Compatibility alias
export { runTemplateGeneratorAgent as runTemplateGenerator };
