/**
 * SVG Template Generator Agent
 * Creates editable SVG templates with {{FIELD}} placeholders from PDF analysis
 * LLM analyzes PDF visually and creates clean SVG from scratch
 */

import {
  Agent,
  Runner,
  tool,
  setDefaultModelProvider,
  applyPatchTool,
  applyDiff,
  shellTool,
} from "@openai/agents-core";
import type { Editor, ApplyPatchResult, Shell, ShellAction, ShellResult } from "@openai/agents-core";

// Local types for apply_patch operations
type CreateFileOperation = { type: "create_file"; path: string; diff: string };
type UpdateFileOperation = { type: "update_file"; path: string; diff: string };
type DeleteFileOperation = { type: "delete_file"; path: string };
import { OpenAIProvider, codeInterpreterTool } from "@openai/agents-openai";
import { z } from "zod";
import OpenAI from "openai";
import { renderSVGTemplate, svgToPdf, svgToPng } from "@/lib/svg-template-renderer";
import fsSync from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";

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
  optional?: boolean;
  default?: unknown;
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
  // Full conversation history for resuming later
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conversationHistory?: any[];
}

// Note: We don't use pdf2svg because it produces uneditable glyph-based SVG.
// Instead, the LLM creates clean SVG from scratch based on visual analysis.

/**
 * Local shell executor for the shell tool
 * Runs commands in the local environment with timeout support
 */
class LocalShell implements Shell {
  private defaultTimeout = 60000; // 60 seconds

  async run(action: ShellAction): Promise<ShellResult> {
    const timeout = action.timeoutMs ?? this.defaultTimeout;
    const results: ShellResult["output"] = [];

    for (const cmd of action.commands) {
      log.info(`[SHELL] Executing: ${cmd}`);
      try {
        const result = await new Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>((resolve) => {
          const childProcess = exec(cmd, { timeout }, (error, stdout, stderr) => {
            // Check if killed (timeout) - use type assertion for ExecException
            const execError = error as { killed?: boolean; code?: number } | null;
            if (execError?.killed) {
              resolve({ stdout: stdout || "", stderr: stderr || "", exitCode: -1, timedOut: true });
            } else {
              resolve({
                stdout: stdout || "",
                stderr: stderr || "",
                exitCode: execError?.code ?? 0,
                timedOut: false,
              });
            }
          });
          childProcess.on("error", (err) => {
            resolve({ stdout: "", stderr: err.message, exitCode: 1, timedOut: false });
          });
        });

        log.info(`[SHELL] Exit code: ${result.exitCode}, stdout: ${result.stdout.substring(0, 100)}...`);
        results.push({
          stdout: result.stdout,
          stderr: result.stderr,
          outcome: result.timedOut
            ? { type: "timeout" }
            : { type: "exit", exitCode: result.exitCode },
        });
      } catch (err) {
        log.error(`[SHELL] Error executing command`, err);
        results.push({
          stdout: "",
          stderr: String(err),
          outcome: { type: "exit", exitCode: 1 },
        });
      }
    }

    return {
      output: results,
      maxOutputLength: action.maxOutputLength,
    };
  }
}

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
 * Virtual file path for the SVG template in apply_patch operations
 */
const SVG_TEMPLATE_PATH = "template.svg";

const SYSTEM_PROMPT = `You create SVG templates from PDF spec sheets. This is an iterative process.

## YOUR GOAL
Create an SVG template that:
1. Matches the PDF layout (colors, positions, fonts, spacing)
2. Has {{PLACEHOLDER}} fields for dynamic content
3. Has {{ASSET_NAME}} references for images

## TEXT WRAPPING
For multiline text that needs to wrap, you have TWO options:

### Option 1: foreignObject (RECOMMENDED for wrapping text)
Use for paragraphs or text that needs automatic wrapping:
<foreignObject x="48" y="120" width="252" height="60">
  <div xmlns="http://www.w3.org/1999/xhtml"
       style="font-family: Arial, sans-serif; font-size: 14px; color: #000;">
    {{DESCRIPTION:This is a long description that will wrap automatically within the width.}}
  </div>
</foreignObject>

### Option 2: Native SVG text with tspan (for short/single-line text)
Use for headings, labels, or when you need precise positioning:
<text x="48" y="140" style="font-family: Arial, sans-serif; font-size: 24px; font-weight: 700; fill: #000;">
  {{TITLE:Product Name}}
</text>

Or for manually broken lines:
<text x="48" y="140" style="font-family: Arial, sans-serif; font-size: 14px; fill: #000;">
  <tspan x="48" dy="0">First line</tspan>
  <tspan x="48" dy="18">Second line</tspan>
</text>

NOTE: Our system automatically converts foreignObject to native SVG text when exporting for Figma.

## PLACEHOLDER SYNTAX
- Text fields: {{FIELD_NAME}} or {{FIELD_NAME:Default Text}}
- Images: xlink:href="{{ASSET_NAME}}"
- Use SCREAMING_SNAKE_CASE (e.g., PRODUCT_NAME, WATTAGE, LOGO_IMAGE)
- Static labels stay as-is (e.g., "Wattage:" is static, but the value becomes {{WATTAGE}})
- For image placeholder boxes, use GRAY (#CCCCCC or similar) background, NOT green

## SVG BASICS
- US Letter = 612x792 points, A4 = 595x842 points
- Use inline styles for best compatibility
- Common fonts: Arial, Helvetica, sans-serif

## TOOLS
- code_interpreter: Analyze PDFs, extract colors/measurements
- shell: Run shell commands (e.g., for file operations, image processing)
- write_svg: Create or completely replace SVG content
- apply_patch: Edit SVG via unified diff (target: template.svg) - use for incremental changes
- read_svg: Read current SVG content
- write_template_json: Define template fields and asset slots
- mark_complete: Finish generation (ONLY after verifying the rendered preview)

## WORKFLOW
1. Analyze the PDF with code_interpreter - extract colors, positions, text
2. write_svg to create the template with placeholders already in place
3. STOP and WAIT - the system will render your SVG and show you a comparison
4. LOOK at the rendered output carefully, compare with the original
5. If issues exist, use apply_patch to fix them, then WAIT for next render
6. REPEAT until the template matches well
7. write_template_json to define fields
8. mark_complete ONLY after you have SEEN and VERIFIED the latest render

CRITICAL RULES:
- After ANY SVG change, STOP and WAIT for the render comparison before continuing
- NEVER call mark_complete in the same turn as write_svg or apply_patch
- You MUST see the rendered preview image before marking complete
- If you haven't seen a preview of your latest changes, DO NOT mark complete
- Be careful with text wrapping - use foreignObject for text that needs to wrap within a container`;

/**
 * Run the SVG template generator agent
 */
export async function runTemplateGeneratorAgent(
  pdfPageImages: string | string[],
  pdfFilename: string,
  pdfBuffer?: Buffer | null,
  userPrompt?: string,
  onEvent?: GeneratorEventCallback,
  reasoning: "none" | "low" | "high" = "low",
  // Continuation parameters
  existingSvg?: string,
  existingJson?: TemplateJson,
  feedback?: string,
  startVersion: number = 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingConversationHistory?: any[]
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conversationHistory: any[] = existingConversationHistory || [];

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

    // Upload PDF for analysis (if provided)
    if (pdfBuffer && pdfBuffer.length > 0) {
      const pdfPath = path.join(os.tmpdir(), "original.pdf");
      fsSync.writeFileSync(pdfPath, pdfBuffer);
      const pdfStream = fsSync.createReadStream(pdfPath);
      await openai.containers.files.create(containerId, { file: pdfStream });
      log.info("Original PDF uploaded");
      fsSync.unlinkSync(pdfPath);
    } else {
      log.info("No PDF provided (prompt-only mode)");
    }

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

    // Upload screenshot for visual reference (if we have one)
    if (pageImages[0]) {
      try {
        const commaIdx = pageImages[0].indexOf(",");
        const base64Data = commaIdx >= 0 ? pageImages[0].slice(commaIdx + 1) : pageImages[0];
        const screenshotBuffer = Buffer.from(base64Data, "base64");
        const screenshotPath = path.join(os.tmpdir(), "original_screenshot.png");
        fsSync.writeFileSync(screenshotPath, screenshotBuffer);
        const screenshotStream = fsSync.createReadStream(screenshotPath);
        await openai.containers.files.create(containerId, { file: screenshotStream });
        log.info("Screenshot uploaded");
        fsSync.unlinkSync(screenshotPath);
      } catch (e) {
        log.error("Failed to upload screenshot", e);
      }
    } else {
      log.info("No screenshot provided");
    }

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

    // Create an in-memory editor for apply_patch
    const svgEditor: Editor = {
      async createFile(operation: CreateFileOperation): Promise<ApplyPatchResult> {
        if (operation.path !== SVG_TEMPLATE_PATH) {
          return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
        }
        onEvent?.({ type: "tool_call", content: "Creating SVG template", toolName: "apply_patch" });
        try {
          const newContent = applyDiff("", operation.diff, "create");
          currentSvg = newContent;
          log.info(`apply_patch:create - Created SVG (${newContent.length} chars)`);
          return { status: "completed", output: `Created ${SVG_TEMPLATE_PATH}. Will render after all tool calls complete.` };
        } catch (error) {
          log.error(`apply_patch:create failed`, error);
          return { status: "failed", output: String(error) };
        }
      },

      async updateFile(operation: UpdateFileOperation): Promise<ApplyPatchResult> {
        if (operation.path !== SVG_TEMPLATE_PATH) {
          return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
        }
        if (!currentSvg) {
          return { status: "failed", output: "No SVG content to patch. Use write_svg first." };
        }
        onEvent?.({ type: "tool_call", content: "Patching SVG template", toolName: "apply_patch" });
        try {
          const newContent = applyDiff(currentSvg, operation.diff);
          currentSvg = newContent;
          log.info(`apply_patch:update - Updated SVG (${newContent.length} chars)`);
          onEvent?.({ type: "tool_result", content: "SVG patched successfully", toolName: "apply_patch" });
          return { status: "completed", output: `Updated ${SVG_TEMPLATE_PATH}. Will render after all tool calls complete.` };
        } catch (error) {
          log.error(`apply_patch:update failed`, error);
          return { status: "failed", output: String(error) };
        }
      },

      async deleteFile(operation: DeleteFileOperation): Promise<ApplyPatchResult> {
        return { status: "failed", output: `Cannot delete ${operation.path}` };
      },
    };

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
      description: "Call this ONLY after you have seen at least one rendered comparison and the template matches the original well. Do NOT call on the first iteration.",
      parameters: z.object({
        message: z.string().describe("Brief summary of what was generated"),
      }),
      execute: async ({ message }) => {
        onEvent?.({ type: "tool_call", content: `Marking complete: ${message}`, toolName: "mark_complete" });

        // Require minimum iterations before allowing completion
        const MIN_VERSIONS = 2; // At least 2 rendered versions before completing
        if (currentVersion < MIN_VERSIONS) {
          log.info(`mark_complete REJECTED: only ${currentVersion} versions, need ${MIN_VERSIONS}`);
          return `ERROR: You've only completed ${currentVersion} iteration(s). You need at least ${MIN_VERSIONS} iterations. Keep refining the template with apply_patch.`;
        }

        isComplete = true;
        log.info(`mark_complete: ${message} (after ${currentVersion} versions)`);
        return "Generation marked complete.";
      },
    });

    // Create shell executor for the shell tool
    const localShell = new LocalShell();

    // Create agent
    const agent = new Agent({
      name: "SVGTemplateGenerator",
      instructions: SYSTEM_PROMPT,
      model: "gpt-5.2",
      modelSettings: {
        reasoning: { effort: reasoning },
      },
      tools: [
        codeInterpreterTool({ container: containerId }),
        shellTool({ shell: localShell }),
        readSvgTool,
        applyPatchTool({ editor: svgEditor }),
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
2. Make the requested changes using apply_patch
3. Update write_template_json if fields changed
4. Review the rendered output

Original filename: ${pdfFilename}

Files in container:
- /mnt/user/original.pdf - Original PDF for reference
- /mnt/user/current_template.png - Current SVG template rendered as PNG
- /mnt/user/original_screenshot.png - Screenshot of original PDF`;
    } else {
      initialPrompt = `Create an SVG template from this PDF spec sheet.

Original filename: ${pdfFilename}${userInstructions}

${pdfBuffer && pdfBuffer.length > 0 ? `Files in container:
- /mnt/user/original.pdf - The PDF to analyze (use code_interpreter to extract colors, measure positions)
${pageImages[0] ? "- /mnt/user/original_screenshot.png - Screenshot of the PDF" : ""}

Use code_interpreter to analyze the PDF - extract colors, positions, and text content.
Then write_svg to create the template WITH {{PLACEHOLDERS}} for dynamic content.

START NOW: Analyze the PDF, then create the SVG template.` : `PROMPT-ONLY MODE
No PDF reference provided. Create a clean, production-grade SVG layout based on the user's instructions.

Best practices:
- Use consistent grid, spacing, and typography
- Define CSS classes in <defs><style>
- Use {{PLACEHOLDER}} syntax for dynamic content
- Use xlink:href="{{ASSET_NAME}}" for image placeholders

START NOW: Create the SVG template based on the prompt.`}`;
    }

    // Track last render for comparison
    let lastRenderPngBase64: string | null = null;

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
    log.info("Starting iteration loop", { maxIterations: MAX_ITERATIONS });

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

      if (iteration === 0 && existingConversationHistory && existingConversationHistory.length > 0) {
        // Resuming with existing history - inject user feedback into the conversation
        log.info(`Resuming with existing conversation history (${existingConversationHistory.length} items)`);

        const feedbackContent = `USER FEEDBACK (please address this):
${feedback}

The current template state has been preserved. Please:
1. Review the feedback carefully
2. Use read_svg to see the current template if needed
3. Make the requested changes using patch_svg
4. Update write_template_json if fields changed`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const feedbackMessage: any[] = [
          { type: "input_text", text: feedbackContent },
        ];
        if (pageImages[0]) {
          feedbackMessage.push({ type: "input_image", image: pageImages[0] });
        }

        input = [...existingConversationHistory, { role: "user", content: feedbackMessage }];
      } else if (iteration === 0) {
        // Fresh start
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const initialContent: any[] = [
          { type: "input_text", text: initialPrompt },
        ];
        if (pageImages[0]) {
          initialContent.push({ type: "input_image", image: pageImages[0] });
        }
        input = [{ role: "user", content: initialContent }];
      } else {
        const hasOriginalRef = !!pageImages[0];

        const comparisonText = `COMPARISON - Version ${currentVersion} rendered.

${hasOriginalRef ? "Left image: Original reference\nRight image: Current rendered template (V" + currentVersion + ")" : "Reference: Current rendered template (V" + currentVersion + ")"}

Compare carefully:
- Does the layout match? (positions, sizes, spacing)
- Do the colors match? (backgrounds, text colors, borders)
- Are placeholders correctly placed?

If template looks good → call write_template_json (if not done) and mark_complete.
If issues remain → use apply_patch to fix them.`;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content: any[] = [
          { type: "input_text", text: comparisonText },
        ];
        if (pageImages[0]) {
          content.push({ type: "input_image", image: pageImages[0] });
        }

        if (lastRenderPngBase64) {
          content.push({ type: "input_image", image: lastRenderPngBase64 });
          const originalLen = pageImages[0] ? pageImages[0].length : 0;
          log.info(`Sending comparison: original reference (${originalLen} chars) + current render (${lastRenderPngBase64.length} chars)`);
        } else {
          log.error(`WARNING: No lastRenderPngBase64 available for iteration ${iteration + 1}! Model won't see current template.`);
        }

        input = [...conversationHistory, { role: "user", content }];
      }

      log.info(`Running agent iteration ${iteration + 1}`);
      const result = await runner.run(agent, input, { maxTurns: 15 });
      conversationHistory = result.history || [];

      // Process reasoning and message output traces
      // (tool_call and tool_result are now handled via Runner hooks for real-time updates)
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
      conversationHistory,
    };
  }
}

// Re-export for compatibility
export { runTemplateGeneratorAgent as runTemplateGenerator };
