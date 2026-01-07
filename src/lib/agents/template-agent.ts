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
  getJobSatoriDocument,
  updateJobSatoriDocument,
  getJob,
  getAssetFile,
  getAssetBankFile,
  getUploadedFile,
  saveAssetFile,
  updateContainerId,
} from "@/lib/fs-utils";
import { renderSVGTemplate, prepareAssets, svgToPng } from "@/lib/svg-template-renderer";
import { renderSatoriPage, renderSatoriDocument, SatoriDocument } from "@/lib/satori-renderer";
import { getPublicUrl, BUCKETS } from "@/lib/supabase";
import { SATORI_DOCUMENT_PROMPT } from "@/lib/prompts/satori-document";
import type { SatoriPageContent, TemplateFont } from "@/lib/types";

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

## DOCUMENT FORMAT
You are generating A4-sized documents (612x792 pixels at 72 DPI).
- Page width: 612px
- Page height: 792px
- Keep all content within these bounds

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
5. MANDATORY: After viewing the first preview, you MUST call apply_patch at least once to improve the layout
   - Look for: text overflow, cut-off text, misalignment, spacing issues, font sizes too large/small
   - Even if it looks "okay", there's always something to polish - be proactive
   - Common fixes: reduce font-size, adjust x/y positions, shorten text, change text-anchor
6. Call render_preview again to verify your SVG fixes worked
7. ALWAYS end with a text response summarizing what you did

## CRITICAL REQUIREMENTS
1. ALWAYS call render_preview at least once before your final response to verify the output visually
2. MANDATORY: After viewing the preview, you MUST call apply_patch at least once before responding
   - Do NOT skip this step even if the preview looks acceptable
   - There is ALWAYS room for improvement: better alignment, tighter spacing, cleaner layout
   - If you truly cannot find anything to fix, make at least a minor improvement (adjust padding, tweak font size, etc.)
3. ALWAYS end your response with a text message summarizing what you did (this is REQUIRED, not optional)
4. Match images to slots by analyzing their content (product photos → PRODUCT_IMAGE, logos → LOGO_IMAGE, etc.)
5. NEVER claim to have made changes without actually calling the appropriate tool
   - If you say you edited the SVG, you MUST have called apply_patch
   - If you say you updated fields, you MUST have called update_fields
   - If you say you assigned assets, you MUST have called update_assets
6. Only describe actions you ACTUALLY performed via tool calls

Your final message MUST accurately summarize ONLY the actions you actually took. Examples:
- "I've filled in 15 fields from the spreadsheet and assigned the product image. The spec sheet is ready."
- "I've updated the wattage to 15W using update_fields."
- "Done! I extracted the data and assigned the logo."

DO NOT claim to have fixed visual issues unless you actually called apply_patch.
DO NOT end with just a tool call - you MUST provide a text response after your last tool call.
DO NOT return after render_preview without calling apply_patch at least once.
`.trim();

/**
 * Instructions for Satori document generation agent
 */
const SATORI_AGENT_INSTRUCTIONS = `
You are a document generation assistant. You help users create multi-page documents by:
1. Extracting data from uploaded files (Excel, PDF, images)
2. Filling in template fields with extracted data
3. Assigning images to the correct asset slots
4. Creating document pages using Satori HTML format
5. Verifying the output looks correct visually

${SATORI_DOCUMENT_PROMPT}

## TOOLS
- code_interpreter: Use Python to read Excel/PDF files uploaded to /mnt/user/. Use pandas for Excel, PyMuPDF for PDFs.
- update_fields: Set field values. Pass JSON {"FIELD_NAME": "value"}.
- update_assets: Assign images to slots. Pass JSON {"SLOT_NAME": "filename.jpg"}.
- update_satori_pages: Update the document pages. Pass JSON array of page bodies.
- render_preview: Render and view the current document. ALWAYS use this to verify your work.

## WORKFLOW
1. If files are uploaded, use code_interpreter to extract data from documents in /mnt/user/
2. Use update_fields to fill in all template fields with extracted data
3. Use update_assets to assign uploaded images to the appropriate slots
4. Use update_satori_pages to create the document structure with HTML page bodies
5. Call render_preview to see the result and iterate on the layout
6. ALWAYS end with a text response summarizing what you did

## CRITICAL REQUIREMENTS
1. ALWAYS call render_preview at least once before your final response
2. Use {{FIELD_NAME}} placeholders in your HTML - they will be substituted at render time
3. Use {{ASSET_NAME}} for image src attributes
4. Keep content within page bounds - create new pages when approaching 85% of body height
5. ALWAYS end your response with a text message summarizing what you did

Your final message MUST accurately summarize ONLY the actions you actually took.
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
let currentSatoriPages: SatoriPageContent[] = [];
let sessionSatoriPagesChanged = false;

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
 * Create update_satori_pages tool for Satori format templates
 */
function createUpdateSatoriPagesTool(
  jobId: string,
  onEvent?: AgentEventCallback
) {
  return tool({
    name: "update_satori_pages",
    description: "Update the document pages. Pass a JSON array of page objects with 'body' containing JSX string for each page.",
    parameters: z.object({
      pages_json: z.string().describe('JSON array: [{"body": "<div>...</div>"}, {"body": "<div>...</div>"}]'),
    }),
    execute: async ({ pages_json }) => {
      onEvent?.({ type: "status", content: "Updating document pages..." });
      try {
        const pages = JSON.parse(pages_json) as SatoriPageContent[];
        if (!Array.isArray(pages)) {
          return JSON.stringify({ error: "pages_json must be an array" });
        }

        // Validate each page has a body
        for (let i = 0; i < pages.length; i++) {
          if (!pages[i].body) {
            return JSON.stringify({ error: `Page ${i} is missing 'body' property` });
          }
        }

        // Save to storage
        await updateJobSatoriDocument(jobId, { pages });
        currentSatoriPages = pages;
        sessionSatoriPagesChanged = true;

        return JSON.stringify({ success: true, pageCount: pages.length });
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
  templateFormat: "svg" | "satori",
  satoriConfig?: { pageSize: "A4" | "LETTER" | "LEGAL" | { width: number; height: number }; header?: { height: number; content: string }; footer?: { height: number; content: string } },
  onEvent?: AgentEventCallback,
  templateFonts?: TemplateFont[]
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
        let helpText: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const responseContent: any[] = [];

        // Always use Satori rendering
        if (currentSatoriPages.length === 0) {
          return JSON.stringify({ error: "No Satori pages to render. Use update_satori_pages first." });
        }

        const satoriDoc: SatoriDocument = {
          pageSize: satoriConfig?.pageSize || "A4",
          header: satoriConfig?.header,
          footer: satoriConfig?.footer,
          pages: currentSatoriPages,
        };
        const result = await renderSatoriDocument(satoriDoc, fields, preparedAssets, templateFonts);

        // Upload and show ALL pages
        const timestamp = Date.now();
        for (let i = 0; i < result.pngBuffers.length; i++) {
          const pngBuffer = result.pngBuffers[i];
          const previewFilename = `preview-${timestamp}-page${i + 1}.png`;
          await saveAssetFile(jobId, previewFilename, pngBuffer);
          const storagePath = `${jobId}/assets/${previewFilename}`;
          const previewUrl = getPublicUrl(BUCKETS.JOBS, storagePath);

          responseContent.push({
            type: "image_url",
            image_url: { url: previewUrl, detail: "high" },
          });

          // Emit preview event to UI for each page
          onEvent?.({
            type: "status",
            content: `Rendered page ${i + 1} of ${result.pngBuffers.length}`
          });
        }

        helpText = `Preview rendered (${result.svgs.length} page${result.svgs.length > 1 ? 's' : ''}). Check ALL pages for layout issues. Use update_satori_pages to fix.`;

        responseContent.push({
          type: "text",
          text: helpText,
        });

        return responseContent;
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
  reasoning: "none" | "low" = "none",
  templateFormat: "svg" | "satori" = "satori", // SVG is deprecated, default to Satori
  satoriConfig?: { pageSize: "A4" | "LETTER" | "LEGAL" | { width: number; height: number }; header?: { height: number; content: string }; footer?: { height: number; content: string } },
  templateFonts?: Array<{ family: string; weights: Record<string, string | null> }>
): Promise<TemplateAgentResult> {
  ensureProvider();
  const openai = getOpenAI();

  // Log agent startup with all settings
  console.log(`[Agent] ========== STARTING TEMPLATE AGENT ==========`);
  console.log(`[Agent] Job: ${jobId}`);
  console.log(`[Agent] Template: ${templateId}`);
  console.log(`[Agent] Format: ${templateFormat}`);
  console.log(`[Agent] Model: gpt-5.2`);
  console.log(`[Agent] Reasoning: ${reasoning}`);
  console.log(`[Agent] User message: "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
  console.log(`[Agent] Previous history: ${previousHistory.length} messages`);

  onEvent?.({ type: "status", content: "Analyzing request..." });

  // Reset session state
  sessionTemplateChanged = false;
  sessionAssetsChanged = false;
  sessionSatoriPagesChanged = false;

  // Get job data
  onEvent?.({ type: "status", content: "Loading job data..." });
  const job = await getJob(jobId);
  const liveAssets = { ...(job?.assets || {}) };
  const uploadedFiles = job?.uploadedFiles || [];
  const liveFields = { ...currentFields };

  // Load Satori document from storage (SVG is deprecated)
  onEvent?.({ type: "status", content: "Loading template..." });
  const satoriDoc = await getJobSatoriDocument(jobId);
  currentSatoriPages = satoriDoc?.pages || [];
  console.log(`[Agent] Loaded ${currentSatoriPages.length} Satori pages from storage`);

  // Timing helper
  const timings: Record<string, number> = {};
  const startTime = Date.now();
  const logTiming = (label: string, start: number) => {
    const elapsed = Date.now() - start;
    timings[label] = elapsed;
    console.log(`[Agent] TIMING: ${label} took ${elapsed}ms`);
  };

  // Categorize files
  const documentFiles = uploadedFiles.filter(f => f.type === "document");
  const imageFiles = uploadedFiles.filter(f => f.type === "image");

  // Container reuse: check if job already has a container
  let containerId: string | null = job?.containerId || null;
  let containerIsNew = false;
  let containerPromise: Promise<{ id: string }> | null = null;

  if (documentFiles.length > 0) {
    if (containerId) {
      // Try to reuse existing container
      onEvent?.({ type: "status", content: "Reconnecting to file processor..." });
      console.log(`[Agent] Attempting to reuse existing container: ${containerId}`);
      try {
        // Verify container still exists by trying to list files
        const verifyStart = Date.now();
        await openai.containers.files.list(containerId);
        logTiming("Container verification (reuse)", verifyStart);
        console.log(`[Agent] Container ${containerId} is still valid, reusing`);
      } catch (err) {
        console.log(`[Agent] Container ${containerId} no longer exists, creating new one`);
        containerId = null;
      }
    }

    if (!containerId) {
      // Need to create a new container
      onEvent?.({ type: "status", content: "Setting up file analysis..." });
      const containerStart = Date.now();
      containerPromise = openai.containers.create({ name: `template-agent-${Date.now()}` })
        .then(container => {
          logTiming("Container creation", containerStart);
          containerIsNew = true;
          return container;
        });
    }
  }

  // Create runner with hooks (agent will be created after container is ready)
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

  // Declare status interval outside try block so it can be cleared in catch
  let statusInterval: ReturnType<typeof setInterval> | null = null;

  try {
    // Build context
    const fileList = documentFiles.length > 0
      ? `\nFiles in /mnt/user/: ${documentFiles.map(f => f.filename).join(", ")}`
      : "";
    const imageList = imageFiles.length > 0
      ? `\nAvailable images: ${imageFiles.map(f => f.filename).join(", ")}`
      : "";

    // Always use Satori context
    const pagesJson = currentSatoriPages.length > 0
      ? JSON.stringify(currentSatoriPages, null, 2)
      : "(No pages yet - use update_satori_pages to create pages)";
    const templateContext = `SATORI DOCUMENT PAGES:
\`\`\`json
${pagesJson}
\`\`\`

Page Size: ${satoriConfig?.pageSize || "A4"}
Header: ${satoriConfig?.header ? `${satoriConfig.header.height}px` : "None"}
Footer: ${satoriConfig?.footer ? `${satoriConfig.footer.height}px` : "None"}`;

    const contextText = `Current fields: ${JSON.stringify(liveFields)}
Current assets: ${JSON.stringify(liveAssets)}${fileList}${imageList}

${templateContext}

Request: ${userMessage}`;

    // Build input with optional initial screenshots (uploaded to storage, referenced by URLs)
    let initialScreenshotUrls: string[] = [];
    let screenshotBuffers: Buffer[] = [];
    if (previousHistory.length === 0) {
      onEvent?.({ type: "status", content: "Preparing document preview..." });
      const screenshotTotalStart = Date.now();
      try {
        // Load assets for rendering
        const assetLoadStart = Date.now();
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
        logTiming("Load assets for screenshot", assetLoadStart);

        // Render to PNG based on format
        const renderStart = Date.now();
        const preparedAssets = await prepareAssets(initialAssets);

        // Always render Satori pages
        if (currentSatoriPages.length > 0) {
          const satoriDoc: SatoriDocument = {
            pageSize: satoriConfig?.pageSize || "A4",
            header: satoriConfig?.header,
            footer: satoriConfig?.footer,
            pages: currentSatoriPages,
          };
          const result = await renderSatoriDocument(satoriDoc, liveFields, preparedAssets, templateFonts);
          screenshotBuffers = result.pngBuffers;
          logTiming("Render Satori to PNG", renderStart);
          console.log(`[Agent] Rendered ${screenshotBuffers.length} Satori pages for initial screenshot`);
        } else {
          console.log(`[Agent] No Satori pages to render for initial screenshot`);
        }

        // Upload all screenshots to storage and get public URLs
        const storageUploadStart = Date.now();
        const timestamp = Date.now();
        for (let i = 0; i < screenshotBuffers.length; i++) {
          const screenshotFilename = screenshotBuffers.length > 1
            ? `screenshot-${timestamp}-page${i + 1}.png`
            : `screenshot-${timestamp}.png`;
          await saveAssetFile(jobId, screenshotFilename, screenshotBuffers[i]);
          const storagePath = `${jobId}/assets/${screenshotFilename}`;
          initialScreenshotUrls.push(getPublicUrl(BUCKETS.JOBS, storagePath));
          console.log(`[Agent] Uploaded screenshot page ${i + 1} to storage: ${storagePath}`);
        }
        logTiming("Upload screenshots to storage", storageUploadStart);

        logTiming("Total screenshot preparation", screenshotTotalStart);
      } catch (err) {
        console.error("Failed to render initial screenshot:", err);
      }
    }

    // Now wait for container (if new) and upload files
    // Container creation was started in parallel with screenshot preparation
    if (containerPromise) {
      onEvent?.({ type: "status", content: "Initializing file processor..." });
      const containerWaitStart = Date.now();
      const container = await containerPromise;
      containerId = container.id;
      logTiming("Wait for container (if not already done)", containerWaitStart);

      // Save container ID to job for future reuse
      await updateContainerId(jobId, containerId);
      console.log(`[Agent] Saved container ID ${containerId} to job for reuse`);

      // Upload document files to container in parallel (only for new containers)
      onEvent?.({ type: "status", content: "Uploading files for analysis..." });
      const uploadStart = Date.now();
      const uploadPromises = documentFiles.map(async (file) => {
        const fileStart = Date.now();
        try {
          const buffer = await getUploadedFile(jobId, file.filename);
          if (buffer) {
            const tmpPath = path.join(os.tmpdir(), file.filename);
            fsSync.writeFileSync(tmpPath, buffer);
            const stream = fsSync.createReadStream(tmpPath);
            await openai.containers.files.create(containerId!, { file: stream });
            fsSync.unlinkSync(tmpPath);
            console.log(`[Agent] Uploaded ${file.filename} to container (${Date.now() - fileStart}ms)`);
          }
        } catch (err) {
          console.error(`[Agent] Failed to upload ${file.filename}:`, err);
        }
      });

      await Promise.all(uploadPromises);
      logTiming(`Upload ${documentFiles.length} document files`, uploadStart);
    }

    // Upload screenshots to container if we have them (for both new and reused containers)
    if (containerId && screenshotBuffers.length > 0) {
      const containerScreenshotStart = Date.now();
      for (let i = 0; i < screenshotBuffers.length; i++) {
        const filename = screenshotBuffers.length > 1
          ? `current_render_page${i + 1}.png`
          : "current_render.png";
        const tmpScreenshotPath = path.join(os.tmpdir(), filename);
        fsSync.writeFileSync(tmpScreenshotPath, screenshotBuffers[i]);
        const screenshotStream = fsSync.createReadStream(tmpScreenshotPath);
        await openai.containers.files.create(containerId!, { file: screenshotStream });
        fsSync.unlinkSync(tmpScreenshotPath);
        console.log(`[Agent] Uploaded screenshot to container as ${filename}`);
      }
      logTiming("Upload screenshots to container", containerScreenshotStart);
    }

    // Create tools - now that containerId is resolved
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tools: any[] = [
      createUpdateFieldsTool(jobId, liveFields, templateFields, onEvent),
      createUpdateAssetsTool(jobId, liveAssets, uploadedFiles, onEvent),
      createRenderPreviewTool(jobId, () => liveFields, () => liveAssets, templateFormat, satoriConfig, onEvent, templateFonts),
    ];

    // Add Satori tools (SVG is deprecated)
    tools.push(createUpdateSatoriPagesTool(jobId, onEvent));
    console.log(`[Agent] Using Satori format with update_satori_pages tool`);

    // Add code_interpreter if we have a container
    if (containerId) {
      tools.unshift(codeInterpreterTool({ container: containerId }));
      console.log(`[Agent] Added code_interpreter tool with container ${containerId}`);
    }

    // Always use Satori instructions
    const agentInstructions = SATORI_AGENT_INSTRUCTIONS;
    const agent = new Agent({
      name: "TemplateAgent",
      instructions: agentInstructions,
      model: "gpt-5.2",
      modelSettings: { reasoning: { effort: reasoning } },
      tools,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let inputMessage: any;
    if (initialScreenshotUrls.length > 0 && previousHistory.length === 0) {
      // Build input with all page screenshots
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contentParts: any[] = [
        { type: "input_text", text: `Current rendered document (${initialScreenshotUrls.length} page${initialScreenshotUrls.length > 1 ? 's' : ''}):` },
      ];
      for (let i = 0; i < initialScreenshotUrls.length; i++) {
        if (initialScreenshotUrls.length > 1) {
          contentParts.push({ type: "input_text", text: `Page ${i + 1}:` });
        }
        contentParts.push({ type: "input_image", image: initialScreenshotUrls[i], detail: "high" });
      }
      contentParts.push({ type: "input_text", text: contextText });

      inputMessage = {
        role: "user",
        content: contentParts,
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
      satoriPagesCount: currentSatoriPages.length,
      satoriPagesTokens: estimateTokens(currentSatoriPages),
      fieldsTokens: estimateTokens(liveFields),
      assetsTokens: estimateTokens(liveAssets),
      screenshotCount: initialScreenshotUrls.length,
      screenshotUrls: initialScreenshotUrls.length > 0 ? initialScreenshotUrls : ["none"],
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
    console.log(`  Satori pages: ${contextAnalysis.satoriPagesCount}, ~${contextAnalysis.satoriPagesTokens} tokens`);
    console.log(`  Fields: ~${contextAnalysis.fieldsTokens} tokens`);
    console.log(`  Assets: ~${contextAnalysis.assetsTokens} tokens`);
    console.log(`  Screenshots: ${contextAnalysis.screenshotCount} page(s)`);
    console.log(`  User message: ${contextAnalysis.userMessageLength} chars`);
    console.log(`  TOTAL INPUT: ~${contextAnalysis.totalInputTokens} tokens (estimate)`);

    if (contextAnalysis.historyBreakdown.length > 0) {
      console.log(`  History breakdown:`);
      contextAnalysis.historyBreakdown.forEach((msg: { index: number; role: string; contentLength: number; estimatedTokens: number; contentBreakdown: string }) => {
        console.log(`    [${msg.index}] ${msg.role}: ${msg.contentLength} chars, ~${msg.estimatedTokens} tokens - ${msg.contentBreakdown}`);
      });
    }

    // Run agent with rotating status messages
    onEvent?.({ type: "status", content: "Connecting to AI..." });

    // Rotating status messages to show activity during long LLM thinking
    const thinkingMessages = [
      "Analyzing your request...",
      "Processing document...",
      "Examining template...",
      "Planning changes...",
      "Reviewing content...",
      "Preparing response...",
      "Working on it...",
      "Almost ready...",
    ];
    let statusIndex = 0;
    let lastToolCallTime = Date.now();

    // Update status every 3 seconds while thinking (not during tool calls)
    statusInterval = setInterval(() => {
      // Only rotate if no tool calls in the last 2 seconds
      const timeSinceLastTool = Date.now() - lastToolCallTime;
      if (timeSinceLastTool > 2000) {
        onEvent?.({ type: "status", content: thinkingMessages[statusIndex % thinkingMessages.length] });
        statusIndex++;
      }
    }, 3000);

    // Track when tool calls happen to pause rotation
    runner.on("agent_tool_start", () => {
      lastToolCallTime = Date.now();
    });

    // Send initial thinking status
    await new Promise(resolve => setTimeout(resolve, 100));
    onEvent?.({ type: "status", content: thinkingMessages[0] });
    statusIndex++;

    const agentRunStart = Date.now();
    const result = await runner.run(agent, input, { maxTurns: 10 });
    clearInterval(statusInterval);
    logTiming("Agent run (LLM + tools)", agentRunStart);

    // NOTE: Container is intentionally NOT deleted to allow reuse across conversation turns
    // Container ID is saved in job.containerId and will be reused on next agent run
    if (containerId) {
      console.log(`[Agent] Container ${containerId} kept alive for reuse`);
    }

    // Determine what changed
    const needsRender = sessionTemplateChanged || sessionAssetsChanged || sessionSatoriPagesChanged;
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
    console.log(`[Agent] Session state: templateChanged=${sessionTemplateChanged}, assetsChanged=${sessionAssetsChanged}, fieldsChanged=${fieldsChanged}, satoriPagesChanged=${sessionSatoriPagesChanged}`);

    // Log timing summary
    const totalTime = Date.now() - startTime;
    console.log(`[Agent] ========== TIMING SUMMARY for ${jobId} ==========`);
    console.log(`[Agent] Total time: ${totalTime}ms`);
    for (const [label, elapsed] of Object.entries(timings)) {
      const pct = ((elapsed / totalTime) * 100).toFixed(1);
      console.log(`[Agent]   ${label}: ${elapsed}ms (${pct}%)`);
    }
    console.log(`[Agent] =================================================`);

    // Detect potential hallucination: model claims template changes but didn't call update_satori_pages
    if (result.finalOutput && !sessionSatoriPagesChanged) {
      const mentionsSatoriChanges = /page|layout|JSX|document|body|header|footer/i.test(result.finalOutput);
      if (mentionsSatoriChanges && !toolsUsed.includes("update_satori_pages")) {
        console.warn(`[Agent] WARNING: Model may have hallucinated Satori changes. Message mentions page/layout changes but update_satori_pages was not called.`);
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
    // Clear the status interval on error
    if (statusInterval) {
      clearInterval(statusInterval);
    }
    // NOTE: Container is kept alive even on error for potential reuse
    // It will be cleaned up by OpenAI after inactivity timeout
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
