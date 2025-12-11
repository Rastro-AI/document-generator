/**
 * SVG Template Editing Agent
 * Uses OpenAI Agents SDK to edit SVG templates
 * Optimized for speed - diff-based edits, template in context
 */

import {
  Agent,
  run,
  tool,
  setDefaultModelProvider,
} from "@openai/agents-core";
import { OpenAIProvider } from "@openai/agents-openai";
import { z } from "zod";
import { getTemplateSvgPath } from "@/lib/paths";
import { TimingLogger } from "@/lib/timing-logger";
import {
  getJobSvgContent,
  updateJobSvgContent,
  getTemplateSvgContent,
  updateJobAssets,
  getJob,
  getAssetFile,
  getAssetBankFile,
} from "@/lib/fs-utils";
import { renderSVGTemplate, prepareAssets, svgToPng } from "@/lib/svg-template-renderer";
import fs from "fs/promises";

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

/**
 * Instructions for the SVG template editing agent
 */
const TEMPLATE_AGENT_INSTRUCTIONS = `
You edit SVG templates. Always help the user.

ENVIRONMENT:
- SVG templates with {{FIELD_NAME}} placeholders for text, {{ASSET_NAME}} in href for images
- PDF rendered via Puppeteer (full browser rendering, supports all CSS/HTML)
- Preview rendered via resvg

TOOLS:
- update_fields: Change text content. Pass JSON {"FIELD_NAME": "value"}.
- update_assets: Assign images to slots. Pass JSON {"SLOT_NAME": "filename.jpg"}.
- patch_svg: Edit SVG design via search/replace. Search string must match EXACTLY from the template.
- render_preview: Render and view current state. Use after design changes to verify.
`.trim();

/**
 * Get SVG template content for a job (from Supabase Storage)
 */
async function getSvgTemplateContentForJob(jobId: string, templateId: string): Promise<string> {
  // First try job-specific SVG from Supabase
  const jobSvg = await getJobSvgContent(jobId);
  if (jobSvg) {
    return jobSvg;
  }

  // Fall back to template SVG from Supabase or local
  const templateSvg = await getTemplateSvgContent(templateId);
  if (templateSvg) {
    return templateSvg;
  }

  // Last resort: try local file
  const templateSvgPath = getTemplateSvgPath(templateId);
  try {
    return await fs.readFile(templateSvgPath, "utf8");
  } catch {
    return "Error: SVG template file not found";
  }
}

/**
 * Track template changes for this session
 */
let sessionTemplateChanged = false;
let sessionAssetsChanged = false;
let currentSvgContent = "";

/**
 * Create patch_svg tool - diff-based editing for speed
 */
function createPatchSvgTool(jobId: string, onEvent?: AgentEventCallback) {
  return tool({
    name: "patch_svg",
    description: "Edit SVG template using search/replace operations. Provide one or more operations to find and replace exact strings in the template.",
    parameters: z.object({
      operations: z.array(z.object({
        search: z.string().describe("Exact string to find in the SVG (must match exactly including whitespace)"),
        replace: z.string().describe("String to replace it with"),
      })).describe("Array of search/replace operations to apply"),
    }),
    execute: async ({ operations }) => {
      onEvent?.({ type: "status", content: "Applying changes..." });
      try {
        let content = currentSvgContent;
        const results: string[] = [];

        for (const op of operations) {
          if (!content.includes(op.search)) {
            results.push(`NOT FOUND: "${op.search.substring(0, 50)}..."`);
            continue;
          }
          content = content.replace(op.search, op.replace);
          results.push(`OK: replaced "${op.search.substring(0, 30)}..."`);
        }

        // Save the updated content to Supabase Storage
        await updateJobSvgContent(jobId, content);
        currentSvgContent = content;
        sessionTemplateChanged = true;

        // Log for debugging
        const titleFontMatch = content.match(/\.title-main\s*\{[^}]*font-size:\s*([^;]+)/);
        console.log(`[patch_svg] Job ${jobId} - Saved SVG (${content.length} chars), title font-size: ${titleFontMatch ? titleFontMatch[1] : 'NOT FOUND'}`);

        onEvent?.({ type: "status", content: "SVG template updated" });

        return JSON.stringify({ success: true, results });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    },
  });
}

/**
 * Create replace_svg tool - full replacement for major changes
 */
function createReplaceSvgTool(jobId: string, onEvent?: AgentEventCallback) {
  return tool({
    name: "replace_svg",
    description: "Replace the entire SVG template with new content. Use this for major restructuring or when patch_svg would require too many operations.",
    parameters: z.object({
      svg_content: z.string().describe("The complete new SVG content. Must be valid SVG with {{PLACEHOLDER}} syntax preserved."),
    }),
    execute: async ({ svg_content }) => {
      onEvent?.({ type: "status", content: "Replacing SVG template..." });
      try {
        // Basic validation
        if (!svg_content.includes("<svg") || !svg_content.includes("</svg>")) {
          return JSON.stringify({ error: "Invalid SVG: must contain <svg> tags" });
        }

        // Save the new content to Supabase Storage
        await updateJobSvgContent(jobId, svg_content);
        currentSvgContent = svg_content;
        sessionTemplateChanged = true;

        // Log for debugging
        const titleFontMatch = svg_content.match(/\.title-main\s*\{[^}]*font-size:\s*([^;]+)/);
        console.log(`[replace_svg] Job ${jobId} - Saved SVG (${svg_content.length} chars), title font-size: ${titleFontMatch ? titleFontMatch[1] : 'NOT FOUND'}`);

        onEvent?.({ type: "status", content: "SVG template replaced" });

        return JSON.stringify({ success: true, message: "SVG template replaced successfully" });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    },
  });
}

/**
 * Create update_fields tool
 */
function createUpdateFieldsTool(
  currentFields: Record<string, string | number | null>,
  templateFields: Array<{ name: string; description: string }>,
  onEvent?: AgentEventCallback
) {
  const fieldList = templateFields.map((f) => `${f.name}: ${f.description}`).join(", ");

  return tool({
    name: "update_fields",
    description: `Update field values. Fields: ${fieldList}`,
    parameters: z.object({
      updates_json: z.string().describe('JSON object: {"FIELD": "value"}'),
    }),
    execute: async ({ updates_json }) => {
      onEvent?.({ type: "status", content: "Updating field values..." });
      try {
        const updates = JSON.parse(updates_json);
        const validUpdates: Record<string, string> = {};
        for (const [key, value] of Object.entries(updates)) {
          if (key in currentFields) {
            validUpdates[key] = String(value);
          }
        }
        return JSON.stringify(validUpdates);
      } catch {
        return JSON.stringify({ error: "Invalid JSON" });
      }
    },
  });
}

/**
 * Create update_assets tool - assign images to asset slots
 */
function createUpdateAssetsTool(
  jobId: string,
  currentAssets: Record<string, string | null>,
  uploadedFiles: Array<{ filename: string; path: string; type: string }>,
  onEvent?: AgentEventCallback
) {
  const assetSlots = Object.keys(currentAssets).join(", ");
  const availableImages = uploadedFiles
    .filter(f => f.type === "image")
    .map(f => f.filename)
    .join(", ");

  return tool({
    name: "update_assets",
    description: `Assign images to asset slots. Available slots: ${assetSlots}. Available uploaded images: ${availableImages || "none"}. Use the filename of an uploaded image to assign it to a slot.`,
    parameters: z.object({
      updates_json: z.string().describe('JSON object: {"SLOT_NAME": "filename.jpg"} - use null to clear a slot'),
    }),
    execute: async ({ updates_json }) => {
      onEvent?.({ type: "status", content: "Updating assets..." });
      try {
        const updates = JSON.parse(updates_json);
        const newAssets = { ...currentAssets };
        const results: string[] = [];

        for (const [slotName, filename] of Object.entries(updates)) {
          if (!(slotName in currentAssets)) {
            results.push(`Unknown slot: ${slotName}`);
            continue;
          }

          if (filename === null) {
            newAssets[slotName] = null;
            results.push(`Cleared ${slotName}`);
          } else {
            // Check if the file exists in uploaded files
            const file = uploadedFiles.find(f => f.filename === filename);
            if (file) {
              newAssets[slotName] = file.filename;
              results.push(`Set ${slotName} = ${filename}`);
            } else {
              results.push(`File not found: ${filename}`);
            }
          }
        }

        // Save to database
        await updateJobAssets(jobId, newAssets);
        sessionAssetsChanged = true;

        return JSON.stringify({ success: true, results, updatedAssets: newAssets });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    },
  });
}

/**
 * Create render_preview tool - renders current template and returns image for visual feedback
 */
function createRenderPreviewTool(
  jobId: string,
  getCurrentFields: () => Record<string, string | number | null>,
  getCurrentAssets: () => Record<string, string | null>,
  onEvent?: AgentEventCallback
) {
  return tool({
    name: "render_preview",
    description: "Render the current template with current field values and assets, and see the result as an image. Use this after making changes to verify they look correct.",
    parameters: z.object({
      reason: z.string().describe("Brief reason for checking the preview (e.g., 'verify layout changes', 'check text wrapping')"),
    }),
    execute: async ({ reason }) => {
      onEvent?.({ type: "status", content: `Rendering preview: ${reason}` });
      try {
        const fields = getCurrentFields();
        const rawAssets = getCurrentAssets();

        // Prepare assets - convert image paths to data URLs
        const assets: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(rawAssets)) {
          if (value) {
            try {
              const assetFilename = value.includes("/") ? value.split("/").pop()! : value;
              let imageBuffer: Buffer | null = null;

              // Try job assets first, then asset bank
              imageBuffer = await getAssetFile(jobId, assetFilename);
              if (!imageBuffer) {
                imageBuffer = await getAssetBankFile(assetFilename);
              }

              if (imageBuffer) {
                const ext = assetFilename.split(".").pop()?.toLowerCase() || "png";
                const mimeTypes: Record<string, string> = {
                  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
                };
                const mimeType = mimeTypes[ext] || "application/octet-stream";
                assets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
              } else {
                assets[key] = null;
              }
            } catch {
              assets[key] = null;
            }
          } else {
            assets[key] = null;
          }
        }

        const preparedAssets = await prepareAssets(assets);
        const renderedSvg = renderSVGTemplate(currentSvgContent, fields, preparedAssets);

        // Generate PNG preview (smaller size for speed)
        const pngBuffer = await svgToPng(renderedSvg, 800);
        const base64Image = pngBuffer.toString("base64");

        onEvent?.({ type: "status", content: "Preview rendered" });

        // Return image in OpenAI-compatible format for the model to see
        // The agents SDK should convert this to proper content blocks
        return [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${base64Image}`,
              detail: "high",
            },
          },
          {
            type: "text",
            text: "Preview rendered. Examine the image above to verify your changes look correct. If something looks wrong (text overflow, misalignment, broken layout), make additional edits and render again.",
          },
        ];
      } catch (error) {
        return JSON.stringify({ error: `Failed to render preview: ${String(error)}` });
      }
    },
  });
}

export interface AgentTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status";
  content: string;
  toolName?: string;
}

export type AgentEventCallback = (event: AgentTrace) => void;

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

export interface TemplateAgentResult {
  success: boolean;
  mode: "fields" | "template" | "both" | "none";
  message: string;
  fieldUpdates?: Record<string, string>;
  templateChanged?: boolean;
  traces?: AgentTrace[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history?: any[];
  timingLogPath?: string;
}

export interface CodeTweakResult {
  success: boolean;
  code?: string;
  message: string;
  traces?: AgentTrace[];
}

/**
 * Run the SVG template editing agent
 */
export async function runTemplateAgent(
  jobId: string,
  templateId: string,
  userMessage: string,
  currentFields: Record<string, string | number | null>,
  templateFields: Array<{ name: string; type: string; description: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousHistory: any[] = [],
  onEvent?: AgentEventCallback,
  reasoning: "none" | "low" = "none"
): Promise<TemplateAgentResult> {
  const timing = new TimingLogger(`agent_${jobId}`);

  timing.start("provider_init");
  ensureProvider();
  timing.end();

  onEvent?.({ type: "status", content: "Thinking..." });

  // Reset session tracking
  sessionTemplateChanged = false;
  sessionAssetsChanged = false;
  let fieldUpdates: Record<string, string> | undefined;

  // Get job data for assets and uploaded files
  const job = await getJob(jobId);
  let liveAssets = { ...(job?.assets || {}) };
  const uploadedFiles = job?.uploadedFiles || [];

  // Track live field values (updated by tools)
  let liveFields = { ...currentFields };

  timing.start("load_template");
  currentSvgContent = await getSvgTemplateContentForJob(jobId, templateId);
  timing.end();

  // Render initial screenshot for visual context
  timing.start("render_initial_screenshot");
  let initialScreenshotBase64: string | null = null;
  try {
    // Prepare assets for rendering
    const initialAssets: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(liveAssets)) {
      if (value) {
        try {
          const assetFilename = value.includes("/") ? value.split("/").pop()! : value;
          let imageBuffer: Buffer | null = null;
          imageBuffer = await getAssetFile(jobId, assetFilename);
          if (!imageBuffer) {
            imageBuffer = await getAssetBankFile(assetFilename);
          }
          if (imageBuffer) {
            const ext = assetFilename.split(".").pop()?.toLowerCase() || "png";
            const mimeTypes: Record<string, string> = {
              png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
              gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
            };
            const mimeType = mimeTypes[ext] || "application/octet-stream";
            initialAssets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          } else {
            initialAssets[key] = null;
          }
        } catch {
          initialAssets[key] = null;
        }
      } else {
        initialAssets[key] = null;
      }
    }
    const preparedInitialAssets = await prepareAssets(initialAssets);
    const renderedSvg = renderSVGTemplate(currentSvgContent, currentFields, preparedInitialAssets);
    const pngBuffer = await svgToPng(renderedSvg, 1200);
    initialScreenshotBase64 = pngBuffer.toString("base64");
  } catch (err) {
    console.error("Failed to render initial screenshot:", err);
  }
  timing.end();

  timing.start("create_tools");
  const updateFieldsTool = createUpdateFieldsTool(currentFields, templateFields, onEvent);
  const updateAssetsTool = createUpdateAssetsTool(jobId, liveAssets, uploadedFiles, onEvent);
  const patchSvgTool = createPatchSvgTool(jobId, onEvent);
  const replaceSvgTool = createReplaceSvgTool(jobId, onEvent);
  const renderPreviewTool = createRenderPreviewTool(
    jobId,
    () => liveFields,
    () => liveAssets,
    onEvent
  );
  timing.end();

  timing.start("create_agent");
  const agent = new Agent({
    name: "SVGTemplateEditor",
    instructions: TEMPLATE_AGENT_INSTRUCTIONS,
    model: "gpt-5.1",
    modelSettings: {
      reasoning: { effort: reasoning },
    },
    tools: [updateFieldsTool, updateAssetsTool, patchSvgTool, replaceSvgTool, renderPreviewTool],
  });
  timing.end();

  try {
    timing.start("build_input");
    const imageFiles = uploadedFiles.filter(f => f.type === "image").map(f => f.filename);
    const contextText = `Current fields: ${JSON.stringify(currentFields)}

Current assets: ${JSON.stringify(liveAssets)}

Uploaded images available: ${imageFiles.length > 0 ? imageFiles.join(", ") : "none"}

CURRENT SVG TEMPLATE:
\`\`\`svg
${currentSvgContent}
\`\`\`

Request: ${userMessage}`;

    // Build message content with screenshot if available
    // Only include screenshot on first message (no history) to avoid format conflicts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inputMessage: any;
    if (initialScreenshotBase64 && previousHistory.length === 0) {
      // Include screenshot so agent sees current state (first message only)
      // OpenAI Agents SDK format: use "image" not "image_url"
      inputMessage = {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Here is the current rendered document:",
          },
          {
            type: "input_image",
            image: `data:image/png;base64,${initialScreenshotBase64}`,
            detail: "high",
          },
          {
            type: "input_text",
            text: contextText,
          },
        ],
      };
    } else {
      inputMessage = {
        role: "user",
        content: contextText,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = previousHistory.length > 0
      ? [
          ...previousHistory,
          inputMessage,
        ]
      : [inputMessage];
    timing.end();

    timing.start("agent_run");
    const result = await run(agent, input, { maxTurns: 5 });
    timing.end();

    timing.start("extract_traces");
    const traces: AgentTrace[] = [];

    for (const item of result.newItems || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyItem = item as any;

      if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
        const reasoningText = extractReasoningText(anyItem.rawItem);
        if (reasoningText) {
          traces.push({ type: "reasoning", content: reasoningText });
        }
      }

      if (anyItem.type === "tool_call_item" && anyItem.rawItem) {
        const rawItem = anyItem.rawItem;
        const toolName = rawItem.name || "unknown";
        traces.push({
          type: "tool_call",
          content: `Calling ${toolName}`,
          toolName
        });
      }

      if (anyItem.type === "tool_call_output_item") {
        const rawItem = anyItem.rawItem;
        const toolName = rawItem?.name || "unknown";
        let output: string;
        if (typeof anyItem.output === "string") {
          output = anyItem.output.substring(0, 100) + (anyItem.output.length > 100 ? "..." : "");
        } else if (Array.isArray(anyItem.output)) {
          // Handle render_preview which returns array of content blocks
          output = `[${anyItem.output.length} content blocks - preview rendered]`;
        } else {
          output = JSON.stringify(anyItem.output).substring(0, 100);
        }
        traces.push({
          type: "tool_result",
          content: output,
          toolName
        });

        // Extract field updates
        if (toolName === "update_fields") {
          try {
            const parsed = JSON.parse(anyItem.output);
            if (!parsed.error && Object.keys(parsed).length > 0) {
              fieldUpdates = parsed;
            }
          } catch {
            // Ignore
          }
        }
      }
    }
    timing.end();

    // Determine mode
    // Assets changes also trigger re-render (treat like template change)
    const needsRender = sessionTemplateChanged || sessionAssetsChanged;
    let mode: "fields" | "template" | "both" | "none" = "none";
    if (fieldUpdates && Object.keys(fieldUpdates).length > 0) {
      mode = "fields";
    }
    if (needsRender) {
      mode = mode === "fields" ? "both" : "template";
    }

    if (traces.length > 0) {
      // Log traces without full base64 content
      const sanitizedTraces = traces.map(t => ({
        ...t,
        content: t.content.length > 200 ? t.content.substring(0, 200) + "..." : t.content
      }));
      console.log("Agent traces:", JSON.stringify(sanitizedTraces, null, 2));
    }

    const timingLogPath = await timing.save();

    return {
      success: true,
      mode,
      message: result.finalOutput || "Done.",
      fieldUpdates,
      templateChanged: needsRender, // Include both SVG and asset changes
      traces,
      history: result.history,
      timingLogPath,
    };
  } catch (error) {
    console.error("SVG template agent error:", error);
    const timingLogPath = await timing.save();
    return {
      success: false,
      mode: "none",
      message: `Failed: ${error}`,
      timingLogPath,
    };
  }
}

/**
 * Instructions for SVG code tweaking agent
 */
const CODE_TWEAK_INSTRUCTIONS = `
You are an SVG template editor. Edit SVG templates that use {{PLACEHOLDER}} syntax.

The current SVG template is provided in the user message. Make changes using the patch_svg tool with search/replace operations.

WORKFLOW:
1. Analyze the SVG template provided
2. Use patch_svg with one or more search/replace operations to make the requested changes
3. Respond with a brief summary of what you changed

RULES FOR patch_svg:
- Each operation finds an exact string and replaces it
- The "search" string must match EXACTLY (including whitespace/indentation)
- Keep changes minimal - only modify what's needed
- Preserve {{FIELD_NAME}} placeholder syntax

SVG TEMPLATE RULES:
- Placeholders use {{FIELD_NAME}} syntax
- Images use {{ASSET_NAME}} in href attributes
- Keep all visual styling (fonts, colors, positions)
`.trim();

/**
 * Run an SVG code tweak agent - edits raw SVG without job context
 * Used for tweaking generated templates before saving
 */
export async function runCodeTweakAgent(
  code: string,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousHistory: any[] = [],
  onEvent?: AgentEventCallback
): Promise<CodeTweakResult> {
  ensureProvider();
  onEvent?.({ type: "status", content: "Thinking..." });

  // Track code modifications in memory
  let currentCode = code;
  let codeChanged = false;

  // Create patch_svg tool for in-memory edits
  const patchSvgTool = tool({
    name: "patch_svg",
    description: "Edit SVG template using search/replace operations.",
    parameters: z.object({
      operations: z.array(z.object({
        search: z.string().describe("Exact string to find in the SVG"),
        replace: z.string().describe("String to replace it with"),
      })).describe("Array of search/replace operations"),
    }),
    execute: async ({ operations }) => {
      onEvent?.({ type: "status", content: "Applying changes..." });
      const results: string[] = [];

      for (const op of operations) {
        if (!currentCode.includes(op.search)) {
          results.push(`NOT FOUND: "${op.search.substring(0, 50)}..."`);
          continue;
        }
        currentCode = currentCode.replace(op.search, op.replace);
        results.push(`OK: replaced "${op.search.substring(0, 30)}..."`);
        codeChanged = true;
      }

      onEvent?.({ type: "status", content: "SVG updated" });
      return JSON.stringify({ success: true, results });
    },
  });

  // Create agent
  const agent = new Agent({
    name: "SVGCodeTweaker",
    instructions: CODE_TWEAK_INSTRUCTIONS,
    model: "gpt-5.1",
    modelSettings: {
      reasoning: { effort: "none" },
    },
    tools: [patchSvgTool],
  });

  try {
    const contextMessage = `CURRENT SVG TEMPLATE:
\`\`\`svg
${code}
\`\`\`

Request: ${prompt}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = previousHistory.length > 0
      ? [...previousHistory, { role: "user", content: contextMessage }]
      : contextMessage;

    const result = await run(agent, input, { maxTurns: 5 });

    // Collect traces
    const traces: AgentTrace[] = [];
    for (const item of result.newItems || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyItem = item as any;

      if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
        const reasoningText = extractReasoningText(anyItem.rawItem);
        if (reasoningText) {
          traces.push({ type: "reasoning", content: reasoningText });
        }
      }

      if (anyItem.type === "tool_call_item" && anyItem.rawItem) {
        const toolName = anyItem.rawItem.name || "unknown";
        traces.push({ type: "tool_call", content: `Calling ${toolName}`, toolName });
      }

      if (anyItem.type === "tool_call_output_item") {
        const toolName = anyItem.rawItem?.name || "unknown";
        const output = typeof anyItem.output === "string"
          ? anyItem.output.substring(0, 100)
          : String(anyItem.output).substring(0, 100);
        traces.push({ type: "tool_result", content: output, toolName });
      }
    }

    return {
      success: true,
      code: codeChanged ? currentCode : undefined,
      message: result.finalOutput || "Done.",
      traces,
    };
  } catch (error) {
    console.error("SVG code tweak agent error:", error);
    return {
      success: false,
      message: `Failed: ${error}`,
    };
  }
}
