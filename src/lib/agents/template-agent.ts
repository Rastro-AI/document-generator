/**
 * SVG Template Editing Agent
 * Uses OpenAI Agents SDK to edit SVG templates
 * Optimized for speed - diff-based edits, template in context
 */

import {
  Agent,
  Runner,
  tool,
  setDefaultModelProvider,
  applyPatchTool,
  applyDiff,
} from "@openai/agents-core";
import type { Editor, ApplyPatchResult } from "@openai/agents-core";

// Local types for apply_patch operations
type CreateFileOperation = { type: "create_file"; path: string; diff: string };
type UpdateFileOperation = { type: "update_file"; path: string; diff: string };
type DeleteFileOperation = { type: "delete_file"; path: string };
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
- apply_patch: Edit SVG design via V4A unified diff format. Target file is always "template.svg".
- render_preview: Render and view current state. Use after design changes to verify.

WORKFLOW:
After filling in fields or making changes, ALWAYS call render_preview to check the result visually.
Look for and fix common issues:
- Text overflowing containers or getting cut off
- Text not wrapping properly (too long for the space)
- Misaligned elements
- Missing or broken images
- Generally ugly or unpolished appearance

If you see any issues, use apply_patch to fix them (adjust font sizes, text wrapping, spacing, etc.) and render_preview again to verify.
Only return to the user when the document looks clean and professional.
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
 * Virtual file path for the SVG template in apply_patch operations
 */
const SVG_TEMPLATE_PATH = "template.svg";

/**
 * Create an in-memory SVG editor for the apply_patch tool
 * This implements the Editor interface from @openai/agents-core
 */
function createSvgEditor(
  jobId: string,
  onEvent?: AgentEventCallback
): Editor {
  return {
    async createFile(operation: CreateFileOperation): Promise<ApplyPatchResult> {
      // For SVG editing, we treat "create" as setting the initial content
      if (operation.path !== SVG_TEMPLATE_PATH) {
        return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
      }

      onEvent?.({ type: "status", content: "Creating SVG template..." });
      try {
        const newContent = applyDiff("", operation.diff, "create");

        // Basic validation
        if (!newContent.includes("<svg") || !newContent.includes("</svg>")) {
          return { status: "failed", output: "Invalid SVG: must contain <svg> tags" };
        }

        await updateJobSvgContent(jobId, newContent);
        currentSvgContent = newContent;
        sessionTemplateChanged = true;

        console.log(`[apply_patch:create] Job ${jobId} - Created SVG (${newContent.length} chars)`);
        onEvent?.({ type: "status", content: "SVG template created" });

        return { status: "completed", output: `Created ${SVG_TEMPLATE_PATH}` };
      } catch (error) {
        return { status: "failed", output: String(error) };
      }
    },

    async updateFile(operation: UpdateFileOperation): Promise<ApplyPatchResult> {
      if (operation.path !== SVG_TEMPLATE_PATH) {
        return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
      }

      onEvent?.({ type: "status", content: "Updating SVG template..." });
      try {
        const newContent = applyDiff(currentSvgContent, operation.diff);

        await updateJobSvgContent(jobId, newContent);
        currentSvgContent = newContent;
        sessionTemplateChanged = true;

        console.log(`[apply_patch:update] Job ${jobId} - Updated SVG (${newContent.length} chars)`);
        onEvent?.({ type: "status", content: "SVG template updated" });

        return { status: "completed", output: `Updated ${SVG_TEMPLATE_PATH}` };
      } catch (error) {
        return { status: "failed", output: String(error) };
      }
    },

    async deleteFile(operation: DeleteFileOperation): Promise<ApplyPatchResult> {
      // We don't support deleting the SVG template
      return { status: "failed", output: `Cannot delete ${operation.path}` };
    },
  };
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
  const svgEditor = createSvgEditor(jobId, onEvent);
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
    tools: [updateFieldsTool, updateAssetsTool, applyPatchTool({ editor: svgEditor }), renderPreviewTool],
  });

  // Create a Runner with lifecycle hooks for real-time tool call updates
  const runner = new Runner();
  const traces: AgentTrace[] = [];

  // Hook: Tool execution started - emit event immediately
  runner.on("agent_tool_start", (_context, _agent, toolDef, _details) => {
    const toolName = toolDef.name || "unknown";
    console.log(`[TOOL START] ${toolName}`);
    traces.push({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
    onEvent?.({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
  });

  // Hook: Tool execution ended - emit result
  runner.on("agent_tool_end", (_context, _agent, toolDef, result, _details) => {
    const toolName = toolDef.name || "unknown";
    // Result is always a string in the SDK
    const output = result.length > 200 ? result.substring(0, 200) + "..." : result;
    console.log(`[TOOL END] ${toolName}: ${output.substring(0, 100)}`);
    traces.push({ type: "tool_result", content: output, toolName });
    onEvent?.({ type: "tool_result", content: output, toolName });
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
    const result = await runner.run(agent, input, { maxTurns: 5 });
    timing.end();

    timing.start("extract_traces");
    // Tool calls and results are now handled via Runner hooks for real-time updates
    // We just need to extract reasoning and field updates here
    for (const item of result.newItems || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyItem = item as any;

      if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
        const reasoningText = extractReasoningText(anyItem.rawItem);
        if (reasoningText) {
          traces.push({ type: "reasoning", content: reasoningText });
        }
      }

      // Extract field updates from tool results
      if (anyItem.type === "tool_call_output_item") {
        const rawItem = anyItem.rawItem;
        const toolName = rawItem?.name || "unknown";
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

The current SVG template is provided in the user message. Make changes using the apply_patch tool with V4A unified diff format.

WORKFLOW:
1. Analyze the SVG template provided
2. Use apply_patch with a unified diff to make the requested changes (target file: template.svg)
3. Respond with a brief summary of what you changed

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

  // Create an in-memory editor for the code tweak agent
  const codeTweakEditor: Editor = {
    async createFile(operation: CreateFileOperation): Promise<ApplyPatchResult> {
      if (operation.path !== SVG_TEMPLATE_PATH) {
        return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
      }
      onEvent?.({ type: "status", content: "Creating SVG..." });
      try {
        const newContent = applyDiff("", operation.diff, "create");
        currentCode = newContent;
        codeChanged = true;
        return { status: "completed", output: `Created ${SVG_TEMPLATE_PATH}` };
      } catch (error) {
        return { status: "failed", output: String(error) };
      }
    },

    async updateFile(operation: UpdateFileOperation): Promise<ApplyPatchResult> {
      if (operation.path !== SVG_TEMPLATE_PATH) {
        return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
      }
      onEvent?.({ type: "status", content: "Applying changes..." });
      try {
        const newContent = applyDiff(currentCode, operation.diff);
        currentCode = newContent;
        codeChanged = true;
        onEvent?.({ type: "status", content: "SVG updated" });
        return { status: "completed", output: `Updated ${SVG_TEMPLATE_PATH}` };
      } catch (error) {
        return { status: "failed", output: String(error) };
      }
    },

    async deleteFile(operation: DeleteFileOperation): Promise<ApplyPatchResult> {
      return { status: "failed", output: `Cannot delete ${operation.path}` };
    },
  };

  // Create agent
  const agent = new Agent({
    name: "SVGCodeTweaker",
    instructions: CODE_TWEAK_INSTRUCTIONS,
    model: "gpt-5.1",
    modelSettings: {
      reasoning: { effort: "none" },
    },
    tools: [applyPatchTool({ editor: codeTweakEditor })],
  });

  // Create a Runner with lifecycle hooks for real-time tool call updates
  const runner = new Runner();
  const traces: AgentTrace[] = [];

  // Hook: Tool execution started
  runner.on("agent_tool_start", (_context, _agent, toolDef, _details) => {
    const toolName = toolDef.name || "unknown";
    traces.push({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
    onEvent?.({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
  });

  // Hook: Tool execution ended
  runner.on("agent_tool_end", (_context, _agent, toolDef, result, _details) => {
    const toolName = toolDef.name || "unknown";
    const output = typeof result === "string" && result.length > 100
      ? result.substring(0, 100) + "..."
      : String(result).substring(0, 100);
    traces.push({ type: "tool_result", content: output, toolName });
    onEvent?.({ type: "tool_result", content: output, toolName });
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

    const result = await runner.run(agent, input, { maxTurns: 5 });

    // Extract reasoning from result (tool calls handled via hooks)
    for (const item of result.newItems || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyItem = item as any;

      if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
        const reasoningText = extractReasoningText(anyItem.rawItem);
        if (reasoningText) {
          traces.push({ type: "reasoning", content: reasoningText });
        }
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
