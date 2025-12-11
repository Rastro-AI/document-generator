/**
 * Unified Template Agent
 * Single agent that handles everything: file extraction, template editing, visual verification
 * Uses code_interpreter for Excel/PDF parsing, apply_patch for SVG editing
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
import { OpenAIProvider, codeInterpreterTool } from "@openai/agents-openai";
import OpenAI from "openai";
import { z } from "zod";
import path from "path";
import os from "os";
import fsSync from "fs";
import fs from "fs/promises";
import { getTemplateSvgPath } from "@/lib/paths";
import {
  getJobSvgContent,
  updateJobSvgContent,
  getTemplateSvgContent,
  updateJobAssets,
  updateJobFields,
  getJob,
  getAssetFile,
  getAssetBankFile,
  getUploadedFile,
  saveAssetFile,
} from "@/lib/fs-utils";
import { renderSVGTemplate, prepareAssets, svgToPng } from "@/lib/svg-template-renderer";
import { getPublicUrl, BUCKETS } from "@/lib/supabase";

// Local types for apply_patch operations
type CreateFileOperation = { type: "create_file"; path: string; diff: string };
type UpdateFileOperation = { type: "update_file"; path: string; diff: string };
type DeleteFileOperation = { type: "delete_file"; path: string };

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

/**
 * Instructions for the unified template agent
 */
const AGENT_INSTRUCTIONS = `
You are a document generation assistant. You help users create spec sheets by:
1. Extracting data from uploaded files (Excel, PDF, images)
2. Filling in template fields with extracted data
3. Assigning images to the correct asset slots
4. Editing the SVG template if needed
5. Verifying the output looks correct visually

## TOOLS
- code_interpreter: Use Python to read Excel/PDF files uploaded to /mnt/user/. Use pandas for Excel, PyMuPDF for PDFs.
- update_fields: Set field values. Pass JSON {"FIELD_NAME": "value"}.
- update_assets: Assign images to slots. Pass JSON {"SLOT_NAME": "filename.jpg"}.
- apply_patch: Edit SVG template via unified diff. Target file is always "template.svg".
- render_preview: Render and view the current document. ALWAYS use this to verify your work.

## WORKFLOW
1. If files are uploaded, use code_interpreter to extract data from documents in /mnt/user/
2. Use update_fields to fill in all template fields with extracted data
3. Use update_assets to assign uploaded images to the appropriate slots (PRODUCT_IMAGE, LOGO_IMAGE, etc.)
4. Call render_preview to see the result
5. If there are visual issues (text overflow, misalignment, ugly layout), use apply_patch to fix the SVG
6. Call render_preview again to verify fixes
7. ALWAYS end with a text response summarizing what you did

## CRITICAL REQUIREMENTS
1. ALWAYS call render_preview at least once before your final response to verify the output visually
2. ALWAYS end your response with a text message summarizing what you did (this is REQUIRED, not optional)
3. Match images to slots by analyzing their content (product photos → PRODUCT_IMAGE, logos → LOGO_IMAGE, etc.)
4. NEVER claim to have made changes without actually calling the appropriate tool
   - If you say you edited the SVG, you MUST have called apply_patch
   - If you say you updated fields, you MUST have called update_fields
   - If you say you assigned assets, you MUST have called update_assets
5. Only describe actions you ACTUALLY performed via tool calls

Your final message MUST accurately summarize ONLY the actions you actually took. Examples:
- "I've filled in 15 fields from the spreadsheet and assigned the product image. The spec sheet is ready."
- "I've updated the wattage to 15W using update_fields."
- "Done! I extracted the data and assigned the logo."

DO NOT claim to have fixed visual issues unless you actually called apply_patch.
DO NOT end with just a tool call - you MUST provide a text response after your last tool call.
`.trim();

/**
 * Virtual file path for the SVG template
 */
const SVG_TEMPLATE_PATH = "template.svg";

/**
 * Track state during agent execution
 */
let currentSvgContent = "";
let sessionTemplateChanged = false;
let sessionAssetsChanged = false;

/**
 * Get SVG template content for a job
 */
async function getSvgTemplateContentForJob(jobId: string, templateId: string): Promise<string> {
  const jobSvg = await getJobSvgContent(jobId);
  if (jobSvg) return jobSvg;

  const templateSvg = await getTemplateSvgContent(templateId);
  if (templateSvg) return templateSvg;

  const templateSvgPath = getTemplateSvgPath(templateId);
  try {
    return await fs.readFile(templateSvgPath, "utf8");
  } catch {
    return "Error: SVG template file not found";
  }
}

/**
 * Create SVG editor for apply_patch tool
 */
function createSvgEditor(jobId: string, onEvent?: AgentEventCallback): Editor {
  return {
    async createFile(operation: CreateFileOperation): Promise<ApplyPatchResult> {
      if (operation.path !== SVG_TEMPLATE_PATH) {
        return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
      }
      onEvent?.({ type: "status", content: "Creating SVG template..." });
      try {
        const newContent = applyDiff("", operation.diff, "create");
        if (!newContent.includes("<svg") || !newContent.includes("</svg>")) {
          return { status: "failed", output: "Invalid SVG: must contain <svg> tags" };
        }
        await updateJobSvgContent(jobId, newContent);
        currentSvgContent = newContent;
        sessionTemplateChanged = true;
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
        return { status: "completed", output: `Updated ${SVG_TEMPLATE_PATH}` };
      } catch (error) {
        return { status: "failed", output: String(error) };
      }
    },

    async deleteFile(operation: DeleteFileOperation): Promise<ApplyPatchResult> {
      return { status: "failed", output: `Cannot delete ${operation.path}` };
    },
  };
}

/**
 * Create update_fields tool
 */
function createUpdateFieldsTool(
  jobId: string,
  currentFields: Record<string, string | number | null>,
  templateFields: Array<{ name: string; description: string }>,
  onEvent?: AgentEventCallback
) {
  const fieldList = templateFields.map((f) => `${f.name}: ${f.description}`).join(", ");

  return tool({
    name: "update_fields",
    description: `Update field values. Available fields: ${fieldList}`,
    parameters: z.object({
      updates_json: z.string().describe('JSON object: {"FIELD": "value"}'),
    }),
    execute: async ({ updates_json }) => {
      onEvent?.({ type: "status", content: "Updating field values..." });
      try {
        const updates = JSON.parse(updates_json);
        const validUpdates: Record<string, string | number | null> = {};
        for (const [key, value] of Object.entries(updates)) {
          if (key in currentFields) {
            validUpdates[key] = value as string | number | null;
            currentFields[key] = value as string | number | null;
          }
        }
        // Save to database
        await updateJobFields(jobId, validUpdates);
        return JSON.stringify({ success: true, updated: Object.keys(validUpdates) });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    },
  });
}

/**
 * Create update_assets tool
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
    description: `Assign images to asset slots. Slots: ${assetSlots}. Available images: ${availableImages || "none"}.`,
    parameters: z.object({
      updates_json: z.string().describe('JSON object: {"SLOT_NAME": "filename.jpg"}'),
    }),
    execute: async ({ updates_json }) => {
      onEvent?.({ type: "status", content: "Updating assets..." });
      try {
        const updates = JSON.parse(updates_json);
        const results: string[] = [];

        for (const [slotName, filename] of Object.entries(updates)) {
          if (!(slotName in currentAssets)) {
            results.push(`Unknown slot: ${slotName}`);
            continue;
          }
          if (filename === null) {
            currentAssets[slotName] = null;
            results.push(`Cleared ${slotName}`);
          } else {
            const file = uploadedFiles.find(f => f.filename === filename);
            if (file) {
              currentAssets[slotName] = file.path;
              results.push(`Set ${slotName} = ${filename}`);
            } else {
              results.push(`File not found: ${filename}`);
            }
          }
        }

        await updateJobAssets(jobId, currentAssets);
        sessionAssetsChanged = true;
        return JSON.stringify({ success: true, results });
      } catch (error) {
        return JSON.stringify({ error: String(error) });
      }
    },
  });
}

/**
 * Create render_preview tool
 */
function createRenderPreviewTool(
  jobId: string,
  getCurrentFields: () => Record<string, string | number | null>,
  getCurrentAssets: () => Record<string, string | null>,
  onEvent?: AgentEventCallback
) {
  return tool({
    name: "render_preview",
    description: "Render the document and see it as an image. Use this to verify your changes look correct.",
    parameters: z.object({
      reason: z.string().describe("Brief reason for rendering (e.g., 'verify field updates')"),
    }),
    execute: async ({ reason }) => {
      onEvent?.({ type: "status", content: `Rendering preview: ${reason}` });
      try {
        const fields = getCurrentFields();
        const rawAssets = getCurrentAssets();

        // Prepare assets as data URLs
        const assets: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(rawAssets)) {
          if (value) {
            try {
              const assetFilename = value.includes("/") ? value.split("/").pop()! : value;
              let imageBuffer: Buffer | null = await getAssetFile(jobId, assetFilename);
              if (!imageBuffer) imageBuffer = await getAssetBankFile(assetFilename);

              if (imageBuffer) {
                const ext = assetFilename.split(".").pop()?.toLowerCase() || "png";
                const mimeTypes: Record<string, string> = {
                  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
                  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
                };
                assets[key] = `data:${mimeTypes[ext] || "application/octet-stream"};base64,${imageBuffer.toString("base64")}`;
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
        const pngBuffer = await svgToPng(renderedSvg, 800);

        // Upload preview to storage and use URL (avoids bloating history with base64)
        const previewFilename = `preview-${Date.now()}.png`;
        await saveAssetFile(jobId, previewFilename, pngBuffer);
        const storagePath = `${jobId}/assets/${previewFilename}`;
        const previewUrl = getPublicUrl(BUCKETS.JOBS, storagePath);

        return [
          {
            type: "image_url",
            image_url: { url: previewUrl, detail: "high" },
          },
          {
            type: "text",
            text: "Preview rendered. Check for issues: text overflow, misalignment, broken images. Fix with apply_patch if needed.",
          },
        ];
      } catch (error) {
        return JSON.stringify({ error: `Render failed: ${String(error)}` });
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

export interface TemplateAgentResult {
  success: boolean;
  mode: "fields" | "template" | "both" | "none";
  message: string;
  fieldUpdates?: Record<string, string>;
  templateChanged?: boolean;
  traces?: AgentTrace[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history?: any[];
}

/**
 * Run the unified template agent
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
  ensureProvider();
  const openai = getOpenAI();

  // Log agent startup with all settings
  console.log(`[Agent] ========== STARTING TEMPLATE AGENT ==========`);
  console.log(`[Agent] Job: ${jobId}`);
  console.log(`[Agent] Template: ${templateId}`);
  console.log(`[Agent] Model: gpt-5.2`);
  console.log(`[Agent] Reasoning: ${reasoning}`);
  console.log(`[Agent] User message: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
  console.log(`[Agent] Previous history: ${previousHistory.length} messages`);

  onEvent?.({ type: "status", content: "Starting..." });

  // Reset session state
  sessionTemplateChanged = false;
  sessionAssetsChanged = false;

  // Get job data
  const job = await getJob(jobId);
  const liveAssets = { ...(job?.assets || {}) };
  const uploadedFiles = job?.uploadedFiles || [];
  const liveFields = { ...currentFields };

  // Load SVG template
  currentSvgContent = await getSvgTemplateContentForJob(jobId, templateId);

  // Create container for code_interpreter if there are document files
  let containerId: string | null = null;
  const documentFiles = uploadedFiles.filter(f => f.type === "document");
  const imageFiles = uploadedFiles.filter(f => f.type === "image");

  if (documentFiles.length > 0) {
    onEvent?.({ type: "status", content: "Setting up file analysis..." });
    const container = await openai.containers.create({ name: `template-agent-${Date.now()}` });
    containerId = container.id;

    // Upload document files to container
    for (const file of documentFiles) {
      try {
        const buffer = await getUploadedFile(jobId, file.filename);
        if (buffer) {
          const tmpPath = path.join(os.tmpdir(), file.filename);
          fsSync.writeFileSync(tmpPath, buffer);
          const stream = fsSync.createReadStream(tmpPath);
          await openai.containers.files.create(containerId, { file: stream });
          fsSync.unlinkSync(tmpPath);
          console.log(`[Agent] Uploaded ${file.filename} to container`);
        }
      } catch (err) {
        console.error(`[Agent] Failed to upload ${file.filename}:`, err);
      }
    }
  }

  // Create tools - use explicit any[] type to allow mixing tool types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: any[] = [
    createUpdateFieldsTool(jobId, liveFields, templateFields, onEvent),
    createUpdateAssetsTool(jobId, liveAssets, uploadedFiles, onEvent),
    applyPatchTool({ editor: createSvgEditor(jobId, onEvent) }),
    createRenderPreviewTool(jobId, () => liveFields, () => liveAssets, onEvent),
  ];

  // Add code_interpreter if we have a container
  if (containerId) {
    tools.unshift(codeInterpreterTool({ container: containerId }));
  }

  // Create agent
  const agent = new Agent({
    name: "TemplateAgent",
    instructions: AGENT_INSTRUCTIONS,
    model: "gpt-5.2",
    modelSettings: { reasoning: { effort: reasoning } },
    tools,
  });

  // Create runner with hooks
  const runner = new Runner();
  const traces: AgentTrace[] = [];

  runner.on("agent_tool_start", (_ctx, _agent, toolDef) => {
    const toolName = toolDef.name || "unknown";
    traces.push({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
    onEvent?.({ type: "tool_call", content: `Calling ${toolName}...`, toolName });
  });

  runner.on("agent_tool_end", (_ctx, _agent, toolDef, result) => {
    const toolName = toolDef.name || "unknown";
    const output = typeof result === "string" && result.length > 200 ? result.substring(0, 200) + "..." : String(result);
    traces.push({ type: "tool_result", content: output, toolName });
    onEvent?.({ type: "tool_result", content: output, toolName });
  });

  try {
    // Build context
    const fileList = documentFiles.length > 0
      ? `\nFiles in /mnt/user/: ${documentFiles.map(f => f.filename).join(", ")}`
      : "";
    const imageList = imageFiles.length > 0
      ? `\nAvailable images: ${imageFiles.map(f => f.filename).join(", ")}`
      : "";

    const contextText = `Current fields: ${JSON.stringify(liveFields)}
Current assets: ${JSON.stringify(liveAssets)}${fileList}${imageList}

SVG TEMPLATE:
\`\`\`svg
${currentSvgContent}
\`\`\`

Request: ${userMessage}`;

    // Build input with optional initial screenshot (uploaded to storage, referenced by URL)
    let initialScreenshotUrl: string | null = null;
    if (previousHistory.length === 0) {
      try {
        const initialAssets: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(liveAssets)) {
          if (value) {
            const assetFilename = value.includes("/") ? value.split("/").pop()! : value;
            let buffer = await getAssetFile(jobId, assetFilename);
            if (!buffer) buffer = await getAssetBankFile(assetFilename);
            if (buffer) {
              const ext = assetFilename.split(".").pop()?.toLowerCase() || "png";
              const mimeTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
              initialAssets[key] = `data:${mimeTypes[ext] || "application/octet-stream"};base64,${buffer.toString("base64")}`;
            }
          }
        }
        const preparedAssets = await prepareAssets(initialAssets);
        const renderedSvg = renderSVGTemplate(currentSvgContent, liveFields, preparedAssets);
        const pngBuffer = await svgToPng(renderedSvg, 1200);

        // Upload screenshot to storage and get public URL (avoids bloating history with base64)
        const screenshotFilename = `screenshot-${Date.now()}.png`;
        await saveAssetFile(jobId, screenshotFilename, pngBuffer);
        const storagePath = `${jobId}/assets/${screenshotFilename}`;
        initialScreenshotUrl = getPublicUrl(BUCKETS.JOBS, storagePath);
        console.log(`[Agent] Uploaded screenshot to storage: ${storagePath}`);

        // Also upload to container if we have one (so code_interpreter can see it)
        if (containerId) {
          const tmpScreenshotPath = path.join(os.tmpdir(), "current_render.png");
          fsSync.writeFileSync(tmpScreenshotPath, pngBuffer);
          const screenshotStream = fsSync.createReadStream(tmpScreenshotPath);
          await openai.containers.files.create(containerId, { file: screenshotStream });
          fsSync.unlinkSync(tmpScreenshotPath);
          console.log(`[Agent] Uploaded screenshot to container as current_render.png`);
        }
      } catch (err) {
        console.error("Failed to render initial screenshot:", err);
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inputMessage: any;
    if (initialScreenshotUrl && previousHistory.length === 0) {
      inputMessage = {
        role: "user",
        content: [
          { type: "input_text", text: "Current rendered document:" },
          { type: "input_image", image: initialScreenshotUrl, detail: "high" },
          { type: "input_text", text: contextText },
        ],
      };
    } else {
      inputMessage = { role: "user", content: contextText };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = previousHistory.length > 0
      ? [...previousHistory, inputMessage]
      : [inputMessage];

    // Debug logging for context size analysis
    const estimateTokens = (obj: unknown): number => {
      if (obj == null) return 0;
      const str = typeof obj === "string" ? obj : JSON.stringify(obj);
      return Math.ceil(str.length / 4); // Rough estimate: 4 chars per token
    };

    // Helper to safely get content length
    const getContentLength = (content: unknown): number => {
      if (content == null) return 0;
      if (typeof content === "string") return content.length;
      return JSON.stringify(content).length;
    };

    // Helper to analyze content breakdown for arrays (like OpenAI message content)
    const analyzeContent = (content: unknown): string => {
      if (content == null) return "null";
      if (typeof content === "string") return `string(${content.length})`;
      if (Array.isArray(content)) {
        const breakdown = content.map((item: { type?: string }, idx) => {
          const itemLen = JSON.stringify(item).length;
          const itemType = item?.type || "unknown";
          return `${idx}:${itemType}(${itemLen})`;
        });
        return `[${breakdown.join(", ")}]`;
      }
      return `object(${JSON.stringify(content).length})`;
    };

    const contextAnalysis = {
      previousHistoryLength: previousHistory.length,
      previousHistoryTokens: estimateTokens(previousHistory),
      svgLength: currentSvgContent.length,
      svgTokens: estimateTokens(currentSvgContent),
      fieldsTokens: estimateTokens(liveFields),
      assetsTokens: estimateTokens(liveAssets),
      hasScreenshot: !!initialScreenshotUrl,
      screenshotUrl: initialScreenshotUrl || "none",
      userMessageLength: userMessage.length,
      totalInputTokens: estimateTokens(input),
      // Break down history by message type
      historyBreakdown: previousHistory.map((msg: { role?: string; content?: unknown }, i: number) => ({
        index: i,
        role: msg?.role || "undefined",
        contentLength: getContentLength(msg?.content),
        estimatedTokens: estimateTokens(msg?.content),
        contentBreakdown: analyzeContent(msg?.content),
      })),
    };

    console.log(`[Agent] Context Analysis for job ${jobId}:`);
    console.log(`  Previous history: ${contextAnalysis.previousHistoryLength} messages, ~${contextAnalysis.previousHistoryTokens} tokens`);
    console.log(`  SVG template: ${contextAnalysis.svgLength} chars, ~${contextAnalysis.svgTokens} tokens`);
    console.log(`  Fields: ~${contextAnalysis.fieldsTokens} tokens`);
    console.log(`  Assets: ~${contextAnalysis.assetsTokens} tokens`);
    console.log(`  Screenshot: ${contextAnalysis.screenshotUrl}`);
    console.log(`  User message: ${contextAnalysis.userMessageLength} chars`);
    console.log(`  TOTAL INPUT: ~${contextAnalysis.totalInputTokens} tokens (estimate)`);

    if (contextAnalysis.historyBreakdown.length > 0) {
      console.log(`  History breakdown:`);
      contextAnalysis.historyBreakdown.forEach((msg: { index: number; role: string; contentLength: number; estimatedTokens: number; contentBreakdown: string }) => {
        console.log(`    [${msg.index}] ${msg.role}: ${msg.contentLength} chars, ~${msg.estimatedTokens} tokens - ${msg.contentBreakdown}`);
      });
    }

    // Run agent
    onEvent?.({ type: "status", content: "Thinking..." });
    const result = await runner.run(agent, input, { maxTurns: 10 });

    // Cleanup container
    if (containerId) {
      try {
        await openai.containers.delete(containerId);
        console.log("[Agent] Container deleted");
      } catch {
        // Ignore cleanup errors
      }
    }

    // Determine what changed
    const needsRender = sessionTemplateChanged || sessionAssetsChanged;
    let mode: "fields" | "template" | "both" | "none" = "none";
    const fieldsChanged = Object.keys(liveFields).some(k => liveFields[k] !== currentFields[k]);
    if (fieldsChanged) mode = "fields";
    if (needsRender) mode = mode === "fields" ? "both" : "template";

    // Log the agent's final output
    console.log(`[Agent] Final output for job ${jobId}:`, result.finalOutput ? `"${result.finalOutput.substring(0, 200)}..."` : "(empty)");

    // If no final output, warn - this shouldn't happen
    if (!result.finalOutput) {
      console.warn(`[Agent] WARNING: No final text output from agent for job ${jobId}. The agent should always end with a summary message.`);
    }

    // Log tool usage summary for debugging
    const toolsUsed = traces.filter(t => t.type === "tool_call").map(t => t.toolName);
    console.log(`[Agent] Tools used for job ${jobId}:`, toolsUsed);
    console.log(`[Agent] Session state: templateChanged=${sessionTemplateChanged}, assetsChanged=${sessionAssetsChanged}, fieldsChanged=${fieldsChanged}`);

    // Detect potential hallucination: model claims SVG changes but didn't call apply_patch
    if (result.finalOutput && !sessionTemplateChanged) {
      const mentionsSvgChanges = /SVG|foreignObject|layout|overflow|wrap|template.*edit|edit.*template/i.test(result.finalOutput);
      if (mentionsSvgChanges && !toolsUsed.includes("apply_patch")) {
        console.warn(`[Agent] WARNING: Model may have hallucinated SVG changes. Message mentions SVG/layout changes but apply_patch was not called.`);
      }
    }

    return {
      success: true,
      mode,
      message: result.finalOutput || "Changes applied successfully.",
      fieldUpdates: fieldsChanged ? liveFields as Record<string, string> : undefined,
      templateChanged: needsRender,
      traces,
      history: result.history,
    };
  } catch (error) {
    // Cleanup container on error
    if (containerId) {
      try {
        await openai.containers.delete(containerId);
      } catch {
        // Ignore
      }
    }

    console.error("Template agent error:", error);
    return {
      success: false,
      mode: "none",
      message: `Failed: ${error}`,
    };
  }
}

/**
 * Instructions for SVG code tweaking agent (used by template editor modal)
 */
const CODE_TWEAK_INSTRUCTIONS = `
You are an SVG template editor. Edit SVG templates that use {{PLACEHOLDER}} syntax.
Use apply_patch with V4A unified diff format. Target file: template.svg.
`.trim();

/**
 * Run an SVG code tweak agent - edits raw SVG without job context
 */
export async function runCodeTweakAgent(
  code: string,
  prompt: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousHistory: any[] = [],
  onEvent?: AgentEventCallback
): Promise<{ success: boolean; code?: string; message: string; traces?: AgentTrace[] }> {
  ensureProvider();

  let currentCode = code;
  let codeChanged = false;

  const codeTweakEditor: Editor = {
    async createFile(op: CreateFileOperation): Promise<ApplyPatchResult> {
      if (op.path !== SVG_TEMPLATE_PATH) return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
      try {
        currentCode = applyDiff("", op.diff, "create");
        codeChanged = true;
        return { status: "completed", output: `Created ${SVG_TEMPLATE_PATH}` };
      } catch (e) {
        return { status: "failed", output: String(e) };
      }
    },
    async updateFile(op: UpdateFileOperation): Promise<ApplyPatchResult> {
      if (op.path !== SVG_TEMPLATE_PATH) return { status: "failed", output: `Only ${SVG_TEMPLATE_PATH} can be edited` };
      try {
        currentCode = applyDiff(currentCode, op.diff);
        codeChanged = true;
        return { status: "completed", output: `Updated ${SVG_TEMPLATE_PATH}` };
      } catch (e) {
        return { status: "failed", output: String(e) };
      }
    },
    async deleteFile(): Promise<ApplyPatchResult> {
      return { status: "failed", output: "Cannot delete" };
    },
  };

  const agent = new Agent({
    name: "SVGCodeTweaker",
    instructions: CODE_TWEAK_INSTRUCTIONS,
    model: "gpt-5.2",
    modelSettings: { reasoning: { effort: "none" } },
    tools: [applyPatchTool({ editor: codeTweakEditor })],
  });

  const runner = new Runner();
  const traces: AgentTrace[] = [];

  runner.on("agent_tool_start", (_ctx, _agent, toolDef) => {
    traces.push({ type: "tool_call", content: `Calling ${toolDef.name}...`, toolName: toolDef.name });
    onEvent?.({ type: "tool_call", content: `Calling ${toolDef.name}...`, toolName: toolDef.name });
  });

  runner.on("agent_tool_end", (_ctx, _agent, toolDef, result) => {
    const output = typeof result === "string" && result.length > 100 ? result.substring(0, 100) + "..." : String(result);
    traces.push({ type: "tool_result", content: output, toolName: toolDef.name });
    onEvent?.({ type: "tool_result", content: output, toolName: toolDef.name });
  });

  try {
    const contextMessage = `SVG TEMPLATE:\n\`\`\`svg\n${code}\n\`\`\`\n\nRequest: ${prompt}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = previousHistory.length > 0
      ? [...previousHistory, { role: "user", content: contextMessage }]
      : contextMessage;

    const result = await runner.run(agent, input, { maxTurns: 5 });

    return {
      success: true,
      code: codeChanged ? currentCode : undefined,
      message: result.finalOutput || "Done.",
      traces,
    };
  } catch (error) {
    return { success: false, message: `Failed: ${error}` };
  }
}
