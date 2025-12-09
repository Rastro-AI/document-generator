/**
 * Template Generator Agent
 * Uses OpenAI Agents SDK with code_interpreter and containers
 * Full feature parity with the original Responses API version
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
import { renderTemplateCode } from "@/lib/template-renderer";
import path from "path";
import fsSync from "fs";
import os from "os";

// Logger for template generator
const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [template-generator-agent] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [template-generator-agent] ERROR: ${msg}`, data !== undefined ? data : "");
  },
  debug: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [template-generator-agent] DEBUG: ${msg}`, data !== undefined ? data : "");
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
  templateCode?: string;
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
  canvas: { width: number; height: number };
  fields: TemplateJsonField[];
  assetSlots: Array<{ name: string; kind: string; description: string }>;
}

/**
 * Generate placeholder value for a field based on its type
 * For previews, we want to show meaningful placeholders that work with .map(), etc.
 */
function generatePlaceholderValue(field: TemplateJsonField): unknown {
  const placeholder = `{{${field.name}}}`;

  switch (field.type) {
    case "array":
      // Generate array with placeholder items
      if (field.items?.type === "object" && field.items.properties) {
        // Array of objects - generate 2 sample items with placeholder properties
        const sampleObject: Record<string, string> = {};
        for (const [key] of Object.entries(field.items.properties)) {
          sampleObject[key] = `{{${field.name}[].${key}}}`;
        }
        return [sampleObject, sampleObject];
      } else {
        // Array of primitives
        return [`{{${field.name}[0]}}`, `{{${field.name}[1]}}`];
      }

    case "object":
      // Generate object with placeholder properties
      if (field.properties) {
        const sampleObject: Record<string, unknown> = {};
        for (const [key, prop] of Object.entries(field.properties)) {
          if (prop.type === "array") {
            sampleObject[key] = [`{{${field.name}.${key}[0]}}`, `{{${field.name}.${key}[1]}}`];
          } else {
            sampleObject[key] = `{{${field.name}.${key}}}`;
          }
        }
        return sampleObject;
      }
      return { value: placeholder };

    case "number":
      return placeholder;

    case "boolean":
      return true; // Show truthy state for preview

    case "string":
    default:
      return placeholder;
  }
}

export interface TemplateGeneratorResult {
  success: boolean;
  templateJson?: TemplateJson;
  templateCode?: string;
  message: string;
  versions?: Array<{ version: number; previewBase64: string; pdfBase64?: string }>;
}

const SYSTEM_PROMPT = `You generate @react-pdf/renderer templates for product spec sheets.

These templates will be reused across different products. Branding/layout stays consistent; product data and section content are dynamic fields.

YOUR GOAL: Create a template that renders IDENTICALLY to the input PDF - same margins, colors, fonts, spacing, layout.

FUNCTION SIGNATURE (required):
\`\`\`tsx
export function render(
  fields: Record<string, any>,
  assets: Record<string, string | null>,
  templateRoot: string
): React.ReactElement
\`\`\`

FIELD TYPES - Use appropriate types for the data:
- "string": Simple text (TITLE, PRODUCT_NAME)
- "number": Numeric values (PRICE, QUANTITY)
- "array": Lists of items - use for repeated content like model numbers, features, specs
- "object": Grouped data with named properties - use for structured sections

USING FIELDS IN CODE:
- String: \`{fields.TITLE || "{{TITLE}}"}\`
- Array: \`{(fields.MODELS as string[] || []).map((m, i) => <Text key={i}>{m}</Text>)}\`
- Object with array:
  \`\`\`tsx
  {(fields.SPECIFICATIONS as {title: string, items: {label: string, value: string}[]})?.items?.map((item, i) => (
    <View key={i} style={styles.specRow}>
      <Text>{item.label}</Text>
      <Text>{item.value}</Text>
    </View>
  ))}
  \`\`\`

ASSETS (images): Show placeholder when not provided:
\`\`\`tsx
{assets.LOGO ? (
  <Image src={assets.LOGO} style={{width: 100, height: 50}} />
) : (
  <View style={{width: 100, height: 50, backgroundColor: "#e0e0e0"}} />
)}
\`\`\`

TECHNICAL CONSTRAINTS (will crash if violated):
- Only import from "react" and "@react-pdf/renderer"
- Only use: Document, Page, View, Text, Image, StyleSheet
- fontFamily: "Helvetica" (no Font.register - it crashes)
- Borders require ALL THREE props together: borderWidth + borderColor + borderStyle
- For partial borders (e.g. bottom only): borderBottomWidth + borderBottomColor + borderBottomStyle
- NEVER use borderWidth: 0 - just omit border props if no border needed
- Use paddingTop/Bottom/Left/Right (NOT paddingHorizontal/paddingVertical)
- Dimensions in points (72pt = 1in)

WORKFLOW:
1. Analyze the PDF - measure margins, colors, spacing, fonts from the original
2. Call write_template_code AND write_template_json in parallel
3. BEFORE making any changes, ALWAYS carefully compare the latest rendered screenshot to the original - describe specific differences you see
4. Refine until they match, then call mark_complete

CRITICAL: Never make changes blindly. Always examine the current rendered output first and describe what's different before deciding what to fix.

FIELD NAMING: SCREAMING_SNAKE_CASE (TITLE, PRODUCT_NAME, SPECIFICATIONS)`;

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
 *
 * Can be called in two modes:
 * 1. Fresh generation: Just pass pdf, screenshot(s), filename, prompt
 * 2. Continuation with feedback: Also pass existingCode, existingJson, feedback
 *
 * @param pdfPageImages - Array of base64 images, one per page (or single string for backwards compat)
 */
export async function runTemplateGeneratorAgent(
  pdfPageImages: string | string[],
  pdfBuffer: Buffer,
  pdfFilename: string,
  userPrompt?: string,
  onEvent?: GeneratorEventCallback,
  reasoning: "none" | "low" | "high" = "low",
  // Continuation parameters
  existingCode?: string,
  existingJson?: TemplateJson,
  feedback?: string,
  startVersion: number = 0
): Promise<TemplateGeneratorResult> {
  // Normalize to array for multi-page support (backwards compatible with single string)
  const pageImages = Array.isArray(pdfPageImages) ? pdfPageImages : [pdfPageImages];
  const isContinuation = !!(existingCode && feedback);

  log.info(`\n${"#".repeat(80)}`);
  log.info(`### TEMPLATE GENERATOR AGENT ${isContinuation ? "CONTINUING" : "STARTED"} ###`);
  log.info(`${"#".repeat(80)}`);
  log.info(`PDF filename: ${pdfFilename}`);
  log.info(`Reasoning level: ${reasoning}`);
  log.info(`User prompt: ${userPrompt || "(none)"}`);
  log.info(`Continuation mode: ${isContinuation}`);
  if (isContinuation) {
    log.info(`Feedback: ${feedback}`);
    log.info(`Existing code: ${existingCode?.length || 0} chars`);
  }
  log.info(`PDF pages: ${pageImages.length}`);
  log.info(`Total screenshot size: ${pageImages.reduce((sum, img) => sum + img.length, 0)} chars`);
  log.info(`PDF buffer size: ${pdfBuffer.length} bytes`);

  ensureProvider();
  const openai = getOpenAI();

  // State tracking - initialize from existing state if continuing
  const versions: Array<{ version: number; previewBase64: string; pdfBase64?: string }> = [];
  let currentVersion = startVersion; // Continue from existing version count
  let currentCode: string | null = existingCode || null;
  let currentJson: TemplateJson | null = existingJson || null;
  let isComplete = false;

  // Container management
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

    if (!isContinuation) {
      onEvent?.({ type: "status", content: "Uploading files to container..." });
    }

    // Upload PDF
    const pdfPath = path.join(os.tmpdir(), "original.pdf");
    fsSync.writeFileSync(pdfPath, pdfBuffer);
    const pdfStream = fsSync.createReadStream(pdfPath);
    await openai.containers.files.create(containerId, { file: pdfStream });
    log.info("Original PDF uploaded to container");
    fsSync.unlinkSync(pdfPath);

    // Upload all page screenshots as PNGs
    for (let i = 0; i < pageImages.length; i++) {
      const pageNum = i + 1;
      const screenshotBuffer = Buffer.from(pageImages[i].split(",")[1], "base64");
      const screenshotPath = path.join(os.tmpdir(), `original_screenshot_page${pageNum}.png`);
      fsSync.writeFileSync(screenshotPath, screenshotBuffer);
      const screenshotStream = fsSync.createReadStream(screenshotPath);
      await openai.containers.files.create(containerId, { file: screenshotStream });
      log.info(`Screenshot page ${pageNum}/${pageImages.length} uploaded to container`);
      fsSync.unlinkSync(screenshotPath);
    }
    // Also upload first page as original_screenshot.png for backwards compatibility
    const firstScreenshotBuffer = Buffer.from(pageImages[0].split(",")[1], "base64");
    const firstScreenshotPath = path.join(os.tmpdir(), "original_screenshot.png");
    fsSync.writeFileSync(firstScreenshotPath, firstScreenshotBuffer);
    const firstScreenshotStream = fsSync.createReadStream(firstScreenshotPath);
    await openai.containers.files.create(containerId, { file: firstScreenshotStream });
    log.info("First page also uploaded as original_screenshot.png");
    fsSync.unlinkSync(firstScreenshotPath);

    if (!isContinuation) {
      onEvent?.({ type: "status", content: "Analyzing PDF structure..." });
    }

    // Create custom tools with closures for state management
    const writeTemplateCodeTool = tool({
      name: "write_template_code",
      description: "Write or replace the complete template code. Use for initial generation or major rewrites.",
      parameters: z.object({
        code: z.string().describe("The complete @react-pdf/renderer template code"),
      }),
      execute: async ({ code }) => {
        onEvent?.({ type: "tool_call", content: "Writing template code", toolName: "write_template_code" });
        currentCode = code;
        log.info(`write_template_code: ${code.length} chars`);
        return "Template code written. Will render after all tool calls complete.";
      },
    });

    const readTemplateTool = tool({
      name: "read_template",
      description: "Read the current template code AND template JSON (fields/assets). Use this to see the exact current state, find correct search strings for patches, or debug issues.",
      parameters: z.object({}),
      execute: async () => {
        onEvent?.({ type: "tool_call", content: "Reading template", toolName: "read_template" });

        const parts: string[] = [];

        if (currentCode) {
          parts.push("=== TEMPLATE CODE ===\n" + currentCode);
        } else {
          parts.push("=== TEMPLATE CODE ===\n(none yet)");
        }

        if (currentJson) {
          parts.push("\n\n=== TEMPLATE JSON ===\n" + JSON.stringify(currentJson, null, 2));
        } else {
          parts.push("\n\n=== TEMPLATE JSON ===\n(none yet)");
        }

        const result = parts.join("");
        log.info(`read_template: returning code=${currentCode?.length || 0} chars, json=${currentJson ? 'yes' : 'no'}`);
        return result;
      },
    });

    const patchTemplateCodeTool = tool({
      name: "patch_template_code",
      description: "Make small edits to existing template code using search/replace. More efficient than rewriting. If a patch fails, use read_template to see the actual current code and fields.",
      parameters: z.object({
        operations: z.array(z.object({
          search: z.string().describe("Exact string to find"),
          replace: z.string().describe("String to replace it with"),
        })).describe("Array of search/replace operations"),
      }),
      execute: async ({ operations }) => {
        onEvent?.({ type: "tool_call", content: `Patching template (${operations.length} operations)`, toolName: "patch_template_code" });
        log.info(`patch_template_code: ${operations.length} operations`);

        if (!currentCode) {
          return "Error: No template code to patch. Use write_template_code first.";
        }

        const results: string[] = [];
        let allPatchesSucceeded = true;

        for (const op of operations) {
          const escapedSearch = op.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const matchCount = (currentCode.match(new RegExp(escapedSearch, 'g')) || []).length;

          if (matchCount === 0) {
            // Try to find similar content to help debug
            const firstLine = op.search.split('\n')[0].trim();
            const similarFound = currentCode.includes(firstLine.substring(0, 30));
            const hint = similarFound
              ? " The first line exists but full match failed - check whitespace/indentation."
              : " First line not found either - use read_template to see current code.";
            results.push(`ERROR: No match found for "${op.search.substring(0, 40)}...".${hint}`);
            log.error(`Patch ERROR: "${op.search.substring(0, 80)}..." NOT FOUND`);
            allPatchesSucceeded = false;
          } else if (matchCount > 1) {
            results.push(`ERROR: Found ${matchCount} matches for "${op.search.substring(0, 30)}...". Include more surrounding context to make it unique.`);
            log.error(`Patch ERROR: ${matchCount} matches for "${op.search.substring(0, 50)}..."`);
            allPatchesSucceeded = false;
          } else {
            currentCode = currentCode.replace(op.search, op.replace);
            results.push(`OK: replaced "${op.search.substring(0, 25)}..."`);
            log.info(`Patch OK: "${op.search.substring(0, 50)}..." -> "${op.replace.substring(0, 50)}..."`);
          }
        }

        const resultStr = `Patches: ${results.join("; ")}${allPatchesSucceeded ? " Will render." : ""}`;
        onEvent?.({ type: "tool_result", content: resultStr, toolName: "patch_template_code" });
        return resultStr;
      },
    });

    const writeTemplateJsonTool = tool({
      name: "write_template_json",
      description: "Write or update the template metadata (fields and asset slots).",
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
          exampleJson: z.string().nullable().describe("JSON-encoded example value. For string: '\"hello\"', for array: '[\"a\",\"b\"]', for object: '{\"key\":\"value\"}'. Use null if no example."),
          itemsJson: z.string().nullable().describe("For array types only: JSON schema of array items, e.g. '{\"type\":\"string\"}' or '{\"type\":\"object\",\"properties\":{\"label\":{\"type\":\"string\"},\"value\":{\"type\":\"string\"}}}'. Use null if not an array."),
          propertiesJson: z.string().nullable().describe("For object types only: JSON schema of properties, e.g. '{\"title\":{\"type\":\"string\"},\"items\":{\"type\":\"array\"}}'. Use null if not an object."),
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

        // Parse JSON strings back to values
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

        // Emit template_json event for frontend
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
      description: "ONLY call this after at least 3 refinement iterations AND when template closely matches original. Be thorough!",
      parameters: z.object({
        message: z.string().describe("Brief summary of what was generated"),
      }),
      execute: async ({ message }) => {
        onEvent?.({ type: "tool_call", content: `Marking complete: ${message}`, toolName: "mark_complete" });
        isComplete = true;
        log.info(`mark_complete: ${message}`);
        return "Generation marked complete.";
      },
    });

    // Create agent with code_interpreter + custom tools
    const agent = new Agent({
      name: "TemplateGenerator",
      instructions: SYSTEM_PROMPT,
      model: "gpt-5.1",
      modelSettings: {
        reasoning: { effort: reasoning },
      },
      tools: [
        codeInterpreterTool({ container: containerId }),
        writeTemplateCodeTool,
        readTemplateTool,
        patchTemplateCodeTool,
        writeTemplateJsonTool,
        markCompleteTool,
      ],
    });

    // Build initial prompt - different for fresh vs continuation
    const userInstructions = userPrompt ? `\n\nUSER INSTRUCTIONS:\n${userPrompt}\n` : "";

    // Build page file list for prompts
    const pageFileList = pageImages.length > 1
      ? pageImages.map((_, i) => `- /mnt/user/original_screenshot_page${i + 1}.png - Page ${i + 1} screenshot`).join("\n")
      : "- /mnt/user/original_screenshot.png - Screenshot";

    const pageCountNote = pageImages.length > 1
      ? `\n\nIMPORTANT: This is a ${pageImages.length}-page PDF. I'm showing you screenshots of all ${pageImages.length} pages. Your template should generate ALL pages to match the original.`
      : "";

    let initialPrompt: string;
    if (isContinuation) {
      // Continuation mode: we already have code/json, user is providing feedback
      initialPrompt = `You are continuing work on a @react-pdf/renderer template based on user feedback.

USER FEEDBACK:
${feedback}

IMPORTANT STEPS:
1. FIRST, call read_template to see the CURRENT template code and JSON
2. Then make the changes the user requested using patch_template_code (for small fixes) or write_template_code (for major rewrites)
3. The template will be automatically rendered after your changes

Original filename: ${pdfFilename}${pageCountNote}

Files in container:
- /mnt/user/original.pdf - The original PDF to match
${pageFileList}`;
    } else {
      // Fresh generation mode
      initialPrompt = `Analyze this PDF and generate a @react-pdf/renderer template.
Original filename: ${pdfFilename}${pageCountNote}
${userInstructions}
Files in container:
- /mnt/user/original.pdf - The PDF to analyze (${pageImages.length} page${pageImages.length > 1 ? "s" : ""})
${pageFileList}

Steps:
1. Use code_interpreter to analyze the PDF structure
2. Call BOTH write_template_code AND write_template_json IN PARALLEL (same response)
3. I'll render and show you the comparison for refinement`;
    }

    // Track last render for comparison images
    let lastRenderPngBase64: string | null = null;
    let lastRenderError: string | null = null; // Track render errors to tell the model

    // Iterative generation loop
    const MAX_ITERATIONS = 15;
    log.info("Starting iteration loop", { maxIterations: MAX_ITERATIONS, isContinuation });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let conversationHistory: any[] = [];

    for (let iteration = 0; iteration < MAX_ITERATIONS && !isComplete; iteration++) {
      log.info(`\n${"=".repeat(80)}`);
      log.info(`=== ITERATION ${iteration + 1}/${MAX_ITERATIONS} ===`);
      log.info(`${"=".repeat(80)}`);

      onEvent?.({
        type: "status",
        content: iteration === 0
          ? (isContinuation ? "Applying feedback..." : "Generating initial template...")
          : `Refining template (iteration ${iteration + 1})...`,
      });

      // Build input for this iteration
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let input: any;

      if (iteration === 0) {
        // Initial input with all PDF page screenshots
        // The Agents SDK uses `image` property (not `image_url`) for InputImage type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const initialContent: any[] = [
          { type: "input_text", text: initialPrompt },
        ];
        // Add all page images with labels
        for (let i = 0; i < pageImages.length; i++) {
          if (pageImages.length > 1) {
            initialContent.push({ type: "input_text", text: `\n--- Page ${i + 1} of ${pageImages.length} ---` });
          }
          initialContent.push({ type: "input_image", image: pageImages[i] });
        }
        input = [
          {
            role: "user",
            content: initialContent,
          },
        ];
      } else {
        // Continuation with comparison images or error feedback
        let comparisonText: string;

        if (lastRenderError) {
          // Last render FAILED - tell the model to fix it
          comparisonText = `ERROR - Version ${currentVersion} FAILED TO RENDER!

The template code has a compilation/syntax error:
${lastRenderError}

DO NOT call mark_complete - the template is broken!
You MUST fix this error first using write_template_code (full rewrite recommended for JSX structure errors) or patch_template_code.

The right image shows the LAST SUCCESSFUL render (V${currentVersion - 1}), not your broken V${currentVersion}.`;
        } else {
          // Last render succeeded - normal comparison
          comparisonText = `COMPARISON - Version ${currentVersion} rendered successfully.

Left image: Original PDF (/mnt/user/original.pdf, /mnt/user/original_screenshot.png)
Right image: Your V${currentVersion} (/mnt/user/current_v${currentVersion}.pdf, /mnt/user/current_v${currentVersion}.png)

Compare:
- Layout and positioning
- Font sizes and colors
- Spacing and margins
- Missing elements

Use patch_template_code for small fixes, write_template_code for major changes.
Call mark_complete when it matches well.`;
        }

        // Build content array with comparison images
        // The Agents SDK uses `image` property (not `image_url`) for InputImage type
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content: any[] = [
          { type: "input_text", text: comparisonText },
          { type: "input_image", image: pageImages[0] }, // First page for comparison
        ];

        if (lastRenderPngBase64) {
          content.push({ type: "input_image", image: lastRenderPngBase64 });
        }

        input = [
          ...conversationHistory,
          { role: "user", content },
        ];
      }

      log.info(`Running agent iteration ${iteration + 1}`, { inputLength: Array.isArray(input) ? input.length : 1 });
      if (iteration === 0 && isContinuation) {
        onEvent?.({ type: "status", content: "Processing feedback..." });
      } else if (iteration === 0) {
        onEvent?.({ type: "status", content: "Analyzing PDF and generating template..." });
      } else {
        onEvent?.({ type: "status", content: `Refining template (iteration ${iteration + 1})...` });
      }

      // Run agent - maxTurns is tool calls per run, not total iterations
      const result = await run(agent, input, { maxTurns: 15 });

      // Update conversation history
      conversationHistory = result.history || [];

      // Extract traces for UI - log everything for debugging
      log.info(`Processing ${result.newItems?.length || 0} new items from agent`);

      for (const item of result.newItems || []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyItem = item as any;

        // Log the item type for debugging
        log.debug(`Item type: ${anyItem.type}`);

        // Handle reasoning items
        if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
          const reasoningText = extractReasoningText(anyItem.rawItem);
          if (reasoningText) {
            log.info(`[REASONING] ${reasoningText.substring(0, 200)}${reasoningText.length > 200 ? "..." : ""}`);
            onEvent?.({ type: "reasoning", content: reasoningText });
          }
        }

        // Handle message items (text output from the model)
        if (anyItem.type === "message_output_item" && anyItem.rawItem) {
          const content = anyItem.rawItem.content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === "output_text" && part.text) {
                log.info(`[MODEL OUTPUT] ${part.text.substring(0, 300)}${part.text.length > 300 ? "..." : ""}`);
                onEvent?.({ type: "reasoning", content: part.text });
              }
            }
          }
        }

        // Handle tool calls
        if (anyItem.type === "tool_call_item" && anyItem.rawItem) {
          const toolName = anyItem.rawItem.name || "unknown";
          const args = anyItem.rawItem.arguments ? JSON.stringify(anyItem.rawItem.arguments).substring(0, 200) : "";
          log.info(`[TOOL CALL] ${toolName}: ${args}${args.length >= 200 ? "..." : ""}`);
        }

        // Handle tool outputs
        if (anyItem.type === "tool_call_output_item") {
          const toolName = anyItem.rawItem?.name || "unknown";
          const output = typeof anyItem.output === "string"
            ? anyItem.output.substring(0, 150) + (anyItem.output.length > 150 ? "..." : "")
            : String(anyItem.output).substring(0, 150);
          log.info(`[TOOL RESULT] ${toolName}: ${output}`);
          onEvent?.({ type: "tool_result", content: output, toolName });
        }
      }

      // Render if code was updated
      if (currentCode && !isComplete) {
        currentVersion++;
        log.info(`\n--- RENDERING VERSION ${currentVersion} ---`);
        onEvent?.({ type: "status", content: `Rendering version ${currentVersion}...` });

        // Build fields object for render - generate type-appropriate placeholders
        const fieldsForRender: Record<string, unknown> = currentJson
          ? Object.fromEntries((currentJson as TemplateJson).fields.map((f) => [f.name, generatePlaceholderValue(f)]))
          : {};
        log.info(`Render fields: ${JSON.stringify(fieldsForRender)}`);

        const renderStartTime = Date.now();
        const renderResult = await renderTemplateCode(currentCode, {
          fields: fieldsForRender,
          assets: {},
          templateRoot: path.join(process.cwd(), "templates", "default"),
          outputFormat: "both",
          dpi: 150,
        });
        const renderDuration = Date.now() - renderStartTime;
        log.info(`Render completed in ${renderDuration}ms`, { success: renderResult.success });

        if (renderResult.success && renderResult.pngBase64) {
          log.info(`VERSION ${currentVersion} RENDER SUCCESS`);
          const pdfBase64 = renderResult.pdfBuffer
            ? `data:application/pdf;base64,${renderResult.pdfBuffer.toString("base64")}`
            : undefined;
          versions.push({ version: currentVersion, previewBase64: renderResult.pngBase64, pdfBase64 });
          lastRenderPngBase64 = renderResult.pngBase64;
          lastRenderError = null; // Clear any previous error

          // Emit version event for frontend (includes code so Accept can use it)
          onEvent?.({
            type: "version",
            content: `Version ${currentVersion} rendered`,
            version: currentVersion,
            previewUrl: renderResult.pngBase64,
            pdfUrl: pdfBase64,
            templateCode: currentCode,
          });

          // Upload current version to container for code_interpreter access
          if (renderResult.pdfBuffer) {
            log.info(`Uploading V${currentVersion} files to container...`);

            // Upload PDF
            const currentPdfPath = path.join(os.tmpdir(), `current_v${currentVersion}.pdf`);
            fsSync.writeFileSync(currentPdfPath, renderResult.pdfBuffer);
            const pdfStream = fsSync.createReadStream(currentPdfPath);
            try {
              await openai.containers.files.create(containerId!, { file: pdfStream });
              log.info(`V${currentVersion} PDF uploaded`);
            } catch (e) {
              log.error(`Failed to upload V${currentVersion} PDF`, e);
            }
            fsSync.unlinkSync(currentPdfPath);

            // Upload screenshot PNG
            const pngBase64Data = renderResult.pngBase64.split(",")[1];
            const pngBuffer = Buffer.from(pngBase64Data, "base64");
            const currentPngPath = path.join(os.tmpdir(), `current_v${currentVersion}.png`);
            fsSync.writeFileSync(currentPngPath, pngBuffer);
            const pngStream = fsSync.createReadStream(currentPngPath);
            try {
              await openai.containers.files.create(containerId!, { file: pngStream });
              log.info(`V${currentVersion} screenshot uploaded`);
            } catch (e) {
              log.error(`Failed to upload V${currentVersion} screenshot`, e);
            }
            fsSync.unlinkSync(currentPngPath);
          }
        } else {
          log.error(`VERSION ${currentVersion} RENDER FAILED: ${renderResult.error}`);
          onEvent?.({ type: "status", content: `Render failed: ${renderResult.error}` });
          // Store the error so we can tell the model about it in the next iteration
          lastRenderError = renderResult.error || "Unknown render error";
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

    if (currentCode && currentJson) {
      log.info("Template generation SUCCESS", { totalVersions: currentVersion });
      return {
        success: true,
        templateJson: currentJson,
        templateCode: currentCode,
        message: `Template generated with ${currentVersion} version(s)`,
        versions,
      };
    }

    log.error("Template generation FAILED - no valid output produced");
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

// Re-export the original function name for compatibility
export { runTemplateGeneratorAgent as runTemplateGenerator };
