/**
 * SVG Template Generator Agent
 * Creates editable SVG templates with {{FIELD}} placeholders from PDF analysis
 * LLM analyzes PDF visually and creates clean SVG from scratch
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
import { renderSVGTemplate, svgToPdf, svgToPng } from "@/lib/svg-template-renderer";
import fsSync from "fs";
import path from "path";
import os from "os";

// Logger for template generator
const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [svg-template-generator] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [svg-template-generator] ERROR: ${msg}`, data !== undefined ? data : "");
  },
  debug: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [svg-template-generator] DEBUG: ${msg}`, data !== undefined ? data : "");
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

// Lazy-load the OpenAI client for container operations
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

export interface GeneratorTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status" | "version" | "template_json";
  content: string;
  toolName?: string;
  version?: number;
  previewUrl?: string;
  pdfUrl?: string;
  templateJson?: TemplateJson;
  templateCode?: string; // For SVG, this contains the SVG code
}

export type GeneratorEventCallback = (event: GeneratorTrace) => void;

export interface TemplateJsonField {
  name: string;
  type: string;
  description: string;
  example?: unknown;
  items?: { type: string; properties?: Record<string, { type: string; description?: string }> };
  properties?: Record<string, { type: string; description?: string }>;
}

export interface TemplateJson {
  id: string;
  name: string;
  format: "svg";
  canvas: { width: number; height: number };
  fields: TemplateJsonField[];
  assetSlots: Array<{ name: string; kind: string; description: string }>;
}

export interface TemplateGeneratorResult {
  success: boolean;
  templateJson?: TemplateJson;
  templateCode?: string; // SVG content
  message: string;
  versions?: Array<{ version: number; previewBase64: string; pdfBase64?: string }>;
}

// Note: We don't use pdf2svg because it produces uneditable glyph-based SVG.
// Instead, the LLM creates clean SVG from scratch based on visual analysis.

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

const SYSTEM_PROMPT = `You create SVG templates from PDF spec sheets using a TWO-PHASE approach.

THIS IS AN ITERATIVE PROCESS. Expect to take 5-10+ iterations to get it right. Do NOT rush to mark_complete.

## PHASE 1: EXACT RECREATION (no placeholders yet!) - Expect 4-8 iterations here
First, recreate the PDF EXACTLY as it appears - same text, same colors, same layout.
- Copy all text VERBATIM from the PDF (e.g., "PAR38 LED Bulb", "13W", "Model: ABC-123")
- Match colors precisely (use code_interpreter to extract hex values)
- Match positions, font sizes, spacing exactly
- For images: use placeholder rectangles with {{IMAGE_NAME}} as the xlink:href
- ITERATE MULTIPLE TIMES until your SVG looks nearly identical to the original PDF
- Each iteration: compare carefully, identify ONE OR TWO issues, fix them with patch_svg

## PHASE 2: ADD PLACEHOLDERS (only after Phase 1 is perfect) - 2-3 more iterations
Once your recreation matches the original, THEN convert dynamic text to placeholders:
- Product names → {{PRODUCT_NAME}}
- Spec values → {{WATTAGE}}, {{LUMENS}}, etc.
- Keep static labels as-is (e.g., "Wattage:" stays "Wattage:", only the value becomes {{WATTAGE}})

## WHY TWO PHASES?
Trying to do layout AND placeholders simultaneously produces garbage. Get the layout right first with real text, then it's trivial to swap in placeholders.

## PLACEHOLDER SYNTAX (for Phase 2):
- Simple: {{FIELD_NAME}}
- With default: {{FIELD_NAME:Default Text}}
- Images: xlink:href="{{ASSET_NAME}}"
- Use SCREAMING_SNAKE_CASE

## SVG TIPS:
- US Letter = 612x792 points, A4 = 595x842 points
- Use <defs><style> for CSS classes
- Use code_interpreter to analyze the PDF and extract exact measurements/colors
- Common fonts: Arial, Helvetica, sans-serif

## WORKFLOW:
1. Analyze the PDF with code_interpreter - extract colors, measure element positions, read ALL text
2. write_svg with EXACT text from PDF (Phase 1) - no placeholders except for images
3. WAIT for render comparison
4. Review comparison carefully, use patch_svg to fix 1-2 issues at a time
5. REPEAT steps 3-4 MULTIPLE TIMES (expect 4-8 iterations) until layout is perfect
6. Once layout matches, patch_svg to convert text to {{PLACEHOLDERS}} (Phase 2)
7. write_template_json to define fields
8. WAIT for final render, verify it looks good
9. mark_complete (only after 5+ iterations minimum)

CRITICAL:
- Do NOT add text placeholders until the layout matches the original
- Do NOT call mark_complete until you've done at least 5 iterations
- Take your time - quality matters more than speed`;

/**
 * Run the SVG template generator agent
 */
export async function runTemplateGeneratorAgent(
  pdfPageImages: string | string[],
  pdfBuffer: Buffer,
  pdfFilename: string,
  userPrompt?: string,
  onEvent?: GeneratorEventCallback,
  reasoning: "none" | "low" | "high" = "low",
  // Continuation parameters
  existingSvg?: string,
  existingJson?: TemplateJson,
  feedback?: string,
  startVersion: number = 0
): Promise<TemplateGeneratorResult> {
  const pageImages = Array.isArray(pdfPageImages) ? pdfPageImages : [pdfPageImages];
  const isContinuation = !!(existingSvg && feedback);

  log.info(`\n${"#".repeat(80)}`);
  log.info(`### SVG TEMPLATE GENERATOR ${isContinuation ? "CONTINUING" : "STARTED"} ###`);
  log.info(`${"#".repeat(80)}`);
  log.info(`PDF filename: ${pdfFilename}`);
  log.info(`Reasoning level: ${reasoning}`);
  log.info(`Continuation mode: ${isContinuation}`);

  ensureProvider();
  const openai = getOpenAI();

  // State tracking
  const versions: Array<{ version: number; previewBase64: string; pdfBase64?: string }> = [];
  let currentVersion = startVersion;
  let currentSvg: string | null = existingSvg || null;
  let currentJson: TemplateJson | null = existingJson || null;
  let isComplete = false;

  // Container for code_interpreter
  let containerId: string | null = null;

  try {
    // For fresh generation, start with null SVG - the model will create it from scratch
    // PDF-to-SVG converters produce uneditable glyph-based output, so we don't use them
    if (!isContinuation) {
      currentSvg = null; // Model will create SVG from scratch based on PDF analysis
      log.info("Starting fresh - model will create SVG from scratch");
    }

    // Create container for code_interpreter
    onEvent?.({ type: "status", content: isContinuation ? "Applying feedback..." : "Analyzing PDF..." });
    log.info("Creating OpenAI container...");

    const container = await openai.containers.create({
      name: `svg-template-gen-${Date.now()}`,
    });
    containerId = container.id;
    log.info("Container created", containerId);

    // Upload PDF for analysis
    const pdfPath = path.join(os.tmpdir(), "original.pdf");
    fsSync.writeFileSync(pdfPath, pdfBuffer);
    const pdfStream = fsSync.createReadStream(pdfPath);
    await openai.containers.files.create(containerId, { file: pdfStream });
    log.info("Original PDF uploaded");
    fsSync.unlinkSync(pdfPath);

    // If continuing, upload current SVG as PNG for visual reference
    if (currentSvg) {
      try {
        const svgPngBuffer = await svgToPng(currentSvg);
        const svgPngPath = path.join(os.tmpdir(), "current_template.png");
        fsSync.writeFileSync(svgPngPath, svgPngBuffer);
        const svgPngStream = fsSync.createReadStream(svgPngPath);
        await openai.containers.files.create(containerId, { file: svgPngStream });
        log.info("Current template (as PNG) uploaded");
        fsSync.unlinkSync(svgPngPath);
      } catch (e) {
        log.error("Failed to convert/upload SVG as PNG", e);
      }
    }

    // Upload screenshot for visual reference
    const screenshotBuffer = Buffer.from(pageImages[0].split(",")[1], "base64");
    const screenshotPath = path.join(os.tmpdir(), "original_screenshot.png");
    fsSync.writeFileSync(screenshotPath, screenshotBuffer);
    const screenshotStream = fsSync.createReadStream(screenshotPath);
    await openai.containers.files.create(containerId, { file: screenshotStream });
    log.info("Screenshot uploaded");
    fsSync.unlinkSync(screenshotPath);

    // Create custom tools
    const readSvgTool = tool({
      name: "read_svg",
      description: "Read the current SVG template content. Returns the SVG code if it exists, or a message indicating you need to create it first with write_svg.",
      parameters: z.object({}),
      execute: async () => {
        onEvent?.({ type: "tool_call", content: "Reading SVG template", toolName: "read_svg" });
        if (!currentSvg) {
          return "No SVG template exists yet. Use write_svg to create the initial SVG template based on the PDF layout.";
        }
        log.info(`read_svg: returning ${currentSvg.length} chars`);
        return currentSvg;
      },
    });

    const patchSvgTool = tool({
      name: "patch_svg",
      description: "Edit the SVG template using search/replace operations. Use this to add {{PLACEHOLDER}} syntax.",
      parameters: z.object({
        operations: z.array(z.object({
          search: z.string().describe("Exact string to find in the SVG"),
          replace: z.string().describe("String to replace it with (use {{FIELD_NAME}} for placeholders)"),
        })).describe("Array of search/replace operations"),
      }),
      execute: async ({ operations }) => {
        onEvent?.({ type: "tool_call", content: `Patching SVG (${operations.length} operations)`, toolName: "patch_svg" });
        log.info(`patch_svg: ${operations.length} operations`);

        if (!currentSvg) {
          return "Error: No SVG content to patch";
        }

        const results: string[] = [];
        let allSucceeded = true;

        for (const op of operations) {
          if (!currentSvg.includes(op.search)) {
            results.push(`NOT FOUND: "${op.search.substring(0, 50)}..."`);
            allSucceeded = false;
            log.error(`Patch NOT FOUND: "${op.search.substring(0, 80)}..."`);
          } else {
            currentSvg = currentSvg.replace(op.search, op.replace);
            results.push(`OK: replaced "${op.search.substring(0, 30)}..."`);
            log.info(`Patch OK: "${op.search.substring(0, 50)}..." -> "${op.replace.substring(0, 50)}..."`);
          }
        }

        const resultStr = `Patches: ${results.join("; ")}`;
        onEvent?.({ type: "tool_result", content: resultStr, toolName: "patch_svg" });
        return resultStr + (allSucceeded ? " Will render." : "");
      },
    });

    const writeSvgTool = tool({
      name: "write_svg",
      description: "Completely replace the SVG template content. Use for major rewrites.",
      parameters: z.object({
        svg: z.string().describe("The complete SVG content"),
      }),
      execute: async ({ svg }) => {
        onEvent?.({ type: "tool_call", content: "Writing SVG template", toolName: "write_svg" });
        currentSvg = svg;
        log.info(`write_svg: ${svg.length} chars`);
        return "SVG template written. Will render after all tool calls complete.";
      },
    });

    const writeTemplateJsonTool = tool({
      name: "write_template_json",
      description: "Write the template metadata (fields and asset slots).",
      parameters: z.object({
        id: z.string().describe("Template ID (lowercase, hyphens)"),
        name: z.string().describe("Human-readable template name"),
        canvas: z.object({
          width: z.number(),
          height: z.number(),
        }),
        fields: z.array(z.object({
          name: z.string().describe("SCREAMING_SNAKE_CASE field name"),
          type: z.enum(["string", "number", "boolean", "array", "object"]),
          description: z.string(),
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
      execute: async ({ id, name, canvas, fields, assetSlots }: any) => {
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
          format: "svg",
          canvas: canvas || { width: 612, height: 792 },
          fields: fields.map((f: { name: string; type: string; description: string; exampleJson?: string | null; itemsJson?: string | null; propertiesJson?: string | null }) => ({
            name: f.name,
            type: f.type,
            description: f.description,
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
      description: "Call this ONLY after you have seen at least one rendered comparison and the template matches the original well. Do NOT call on the first iteration.",
      parameters: z.object({
        message: z.string().describe("Brief summary of what was generated"),
      }),
      execute: async ({ message }) => {
        onEvent?.({ type: "tool_call", content: `Marking complete: ${message}`, toolName: "mark_complete" });

        // Require minimum iterations before allowing completion
        const MIN_VERSIONS = 3; // At least 3 rendered versions before completing
        if (currentVersion < MIN_VERSIONS) {
          log.info(`mark_complete REJECTED: only ${currentVersion} versions, need ${MIN_VERSIONS}`);
          return `ERROR: You've only completed ${currentVersion} iteration(s). This is an iterative process - you need at least ${MIN_VERSIONS} iterations to produce quality output. Keep refining the template with patch_svg. Compare carefully to the original and fix any differences.`;
        }

        isComplete = true;
        log.info(`mark_complete: ${message} (after ${currentVersion} versions)`);
        return "Generation marked complete.";
      },
    });

    // Create agent
    const agent = new Agent({
      name: "SVGTemplateGenerator",
      instructions: SYSTEM_PROMPT,
      model: "gpt-5.1",
      modelSettings: {
        reasoning: { effort: reasoning },
      },
      tools: [
        codeInterpreterTool({ container: containerId }),
        readSvgTool,
        patchSvgTool,
        writeSvgTool,
        writeTemplateJsonTool,
        markCompleteTool,
      ],
    });

    // Build initial prompt
    const userInstructions = userPrompt ? `\n\nUSER INSTRUCTIONS:\n${userPrompt}\n` : "";

    let initialPrompt: string;
    if (isContinuation) {
      initialPrompt = `You are continuing work on an SVG template based on user feedback.

USER FEEDBACK:
${feedback}

STEPS:
1. Call read_svg to see the current SVG template
2. Make the requested changes using patch_svg
3. Update write_template_json if fields changed
4. Review the rendered output

Original filename: ${pdfFilename}

Files in container:
- /mnt/user/original.pdf - Original PDF for reference
- /mnt/user/current_template.png - Current SVG template rendered as PNG
- /mnt/user/original_screenshot.png - Screenshot of original PDF`;
    } else {
      initialPrompt = `Create an SVG template from this PDF spec sheet using the TWO-PHASE approach.

Original filename: ${pdfFilename}${userInstructions}

Files in container:
- /mnt/user/original.pdf - The PDF to analyze (use code_interpreter to extract colors, measure positions)
- /mnt/user/original_screenshot.png - Screenshot of the PDF

## PHASE 1: EXACT RECREATION
First, recreate the PDF EXACTLY - copy all text verbatim, match all colors and positions.
Use code_interpreter to:
- Extract exact hex colors from the PDF
- Measure element positions and sizes
- Read all text content

Then write_svg with the EXACT text from the PDF. Do NOT use placeholders yet (except for images).

## PHASE 2: ADD PLACEHOLDERS (later)
Only after your SVG matches the original visually, then convert dynamic text to {{PLACEHOLDERS}}.

START NOW: Use code_interpreter to analyze the PDF, then write_svg with exact text content.`;
    }

    // Track last render for comparison
    let lastRenderPngBase64: string | null = null;

    // Iteration loop - allow plenty of iterations for quality output
    const MAX_ITERATIONS = 15;
    log.info("Starting iteration loop", { maxIterations: MAX_ITERATIONS });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let conversationHistory: any[] = [];

    for (let iteration = 0; iteration < MAX_ITERATIONS && !isComplete; iteration++) {
      log.info(`\n${"=".repeat(80)}`);
      log.info(`=== ITERATION ${iteration + 1}/${MAX_ITERATIONS} ===`);
      log.info(`${"=".repeat(80)}`);

      onEvent?.({
        type: "status",
        content: iteration === 0
          ? (isContinuation ? "Applying feedback..." : "Analyzing SVG and adding placeholders...")
          : `Refining template (iteration ${iteration + 1})...`,
      });

      // Build input
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let input: any;

      if (iteration === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const initialContent: any[] = [
          { type: "input_text", text: initialPrompt },
          { type: "input_image", image: pageImages[0] },
        ];
        input = [{ role: "user", content: initialContent }];
      } else {
        // Check if we're still in Phase 1 (no placeholders yet) or Phase 2
        const hasPlaceholders = currentSvg && currentSvg.includes("{{") && !currentSvg.match(/\{\{[A-Z_]+\}\}/g)?.every(p => p.includes("IMAGE") || p.includes("LOGO") || p.includes("PHOTO"));

        const comparisonText = hasPlaceholders
          ? `COMPARISON - Version ${currentVersion} rendered.

Left image: Original PDF screenshot
Right image: Current rendered template (V${currentVersion})

You are in PHASE 2 (placeholders added). Review the template and refine if needed.
Call mark_complete when satisfied with the final result.`
          : `COMPARISON - Version ${currentVersion} rendered.

Left image: Original PDF screenshot
Right image: Current rendered template (V${currentVersion})

You are in PHASE 1 (exact recreation). Compare carefully:
- Does the layout match? (positions, sizes, spacing)
- Do the colors match? (backgrounds, text colors, borders)
- Is all the text present and in the right places?

If it matches well → proceed to PHASE 2: use patch_svg to convert dynamic text to {{PLACEHOLDERS}}, then call write_template_json.
If it doesn't match → use patch_svg to fix the differences first.`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content: any[] = [
          { type: "input_text", text: comparisonText },
          { type: "input_image", image: pageImages[0] },
        ];

        if (lastRenderPngBase64) {
          content.push({ type: "input_image", image: lastRenderPngBase64 });
          log.info(`Sending comparison: original PDF (${pageImages[0].length} chars) + current render (${lastRenderPngBase64.length} chars)`);
        } else {
          log.error(`WARNING: No lastRenderPngBase64 available for iteration ${iteration + 1}! Model won't see current template.`);
        }

        input = [...conversationHistory, { role: "user", content }];
      }

      log.info(`Running agent iteration ${iteration + 1}`);
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
                log.info(`[MODEL OUTPUT] ${part.text.substring(0, 300)}...`);
                onEvent?.({ type: "reasoning", content: part.text });
              }
            }
          }
        }

        if (anyItem.type === "tool_call_item" && anyItem.rawItem) {
          const toolName = anyItem.rawItem.name || "unknown";
          log.info(`[TOOL CALL] ${toolName}`);
        }

        if (anyItem.type === "tool_call_output_item") {
          const toolName = anyItem.rawItem?.name || "unknown";
          const output = typeof anyItem.output === "string"
            ? anyItem.output.substring(0, 150) + (anyItem.output.length > 150 ? "..." : "")
            : String(anyItem.output).substring(0, 150);
          log.info(`[TOOL RESULT] ${toolName}: ${output}`);
          onEvent?.({ type: "tool_result", content: output, toolName });
        }
      }

      // Render if SVG exists (always render, even if mark_complete was called, to get final output)
      if (currentSvg) {
        currentVersion++;
        log.info(`\n--- RENDERING VERSION ${currentVersion} ---`);
        onEvent?.({ type: "status", content: `Rendering version ${currentVersion}...` });

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

          // Render SVG with placeholders shown
          const renderedSvg = renderSVGTemplate(currentSvg, fieldsForRender, {});

          // Convert to PNG for preview
          const pngBuffer = await svgToPng(renderedSvg);
          const pngBase64 = `data:image/png;base64,${pngBuffer.toString("base64")}`;

          // Try to convert to PDF
          let pdfBase64: string | undefined;
          try {
            const pdfBuffer = await svgToPdf(renderedSvg);
            pdfBase64 = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
          } catch (pdfErr) {
            log.error("PDF conversion failed (continuing)", pdfErr);
          }

          log.info(`VERSION ${currentVersion} RENDER SUCCESS - PNG size: ${pngBase64.length} chars`);
          versions.push({ version: currentVersion, previewBase64: pngBase64, pdfBase64 });
          lastRenderPngBase64 = pngBase64;
          log.info(`Set lastRenderPngBase64 for next iteration comparison`);

          // Emit version event
          onEvent?.({
            type: "version",
            content: `Version ${currentVersion} rendered`,
            version: currentVersion,
            previewUrl: pngBase64,
            pdfUrl: pdfBase64,
            templateCode: currentSvg,
          });

          // Upload PNG to container (OpenAI doesn't support SVG files)
          const pngData = pngBase64.split(",")[1];
          const versionPngPath = path.join(os.tmpdir(), `current_v${currentVersion}.png`);
          fsSync.writeFileSync(versionPngPath, Buffer.from(pngData, "base64"));
          const versionPngStream = fsSync.createReadStream(versionPngPath);
          try {
            await openai.containers.files.create(containerId!, { file: versionPngStream });
            log.info(`V${currentVersion} PNG uploaded to container`);
          } catch (e) {
            log.error(`Failed to upload V${currentVersion} PNG`, e);
          }
          fsSync.unlinkSync(versionPngPath);

        } catch (renderError) {
          log.error(`VERSION ${currentVersion} RENDER FAILED`, renderError);
          onEvent?.({ type: "status", content: `Render failed: ${renderError}` });
        }
      }

      log.info(`Iteration ${iteration + 1} complete`, { isComplete, version: currentVersion });
    }

    // Clean up container
    log.info("Cleaning up container...", containerId);
    try {
      await openai.containers.delete(containerId);
      log.info("Container deleted");
    } catch (e) {
      log.error("Failed to delete container", e);
    }

    if (currentSvg && currentJson) {
      log.info("Template generation SUCCESS", { totalVersions: currentVersion });
      return {
        success: true,
        templateJson: currentJson,
        templateCode: currentSvg,
        message: `SVG template generated with ${currentVersion} version(s)`,
        versions,
      };
    }

    log.error("Template generation FAILED - no valid output");
    return {
      success: false,
      message: "Failed to generate template - no valid output produced",
      versions,
    };
  } catch (error) {
    log.error("Template generation EXCEPTION", error);
    if (containerId) {
      try {
        await openai.containers.delete(containerId);
        log.info("Container cleaned up after error");
      } catch (e) {
        log.error("Failed to delete container after error", e);
      }
    }

    return {
      success: false,
      message: `Generation failed: ${error}`,
      versions,
    };
  }
}

// Re-export for compatibility
export { runTemplateGeneratorAgent as runTemplateGenerator };
