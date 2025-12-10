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
import fs from "fs/promises";
import { getTemplateSvgPath, getJobTemplateSvgPath } from "@/lib/paths";
import { TimingLogger } from "@/lib/timing-logger";

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
You are an SVG template editor that can modify BOTH the content (field values) AND the template design.

SVG TEMPLATE FORMAT:
- Templates use {{FIELD_NAME}} placeholders for dynamic content
- Example: <text>{{PRODUCT_NAME}}</text> renders as <text>LED Bulb</text>
- Assets use {{ASSET_NAME}} in href attributes

AVAILABLE TOOLS:
1. update_fields - Change field VALUES (the data that fills placeholders)
2. patch_svg - Change the SVG TEMPLATE (layout, styling, placeholders)

DECISION GUIDE - Use update_fields when user asks to:
- Change text content, copy, descriptions, titles, values
- Update product names, model numbers, specifications
- Edit any text that appears in the document
- Examples: "change the description to...", "update the product name"

DECISION GUIDE - Use patch_svg when user asks to:
- Change colors, fonts, sizes, spacing, layout
- Add/remove/rename placeholder fields
- Modify the visual appearance or structure
- Examples: "make the header blue", "add a new field for warranty"

WORKFLOW:
1. Determine if the request is about CONTENT (update_fields) or TEMPLATE (patch_svg)
2. For content changes: call update_fields with field names and new values
3. For template changes: call patch_svg with search/replace operations
4. You can use BOTH tools if the user asks for both content and design changes

RULES FOR update_fields:
- Use the exact field names from the available fields list
- Pass a JSON object with field names as keys and new values as values

RULES FOR patch_svg:
- Each operation finds an exact string and replaces it
- The "search" string must match EXACTLY (including whitespace)
- Keep changes minimal - only modify what's needed
- Preserve {{FIELD_NAME}} placeholder syntax
`.trim();

/**
 * Get SVG template content for a job
 */
async function getSvgTemplateContent(jobId: string, templateId: string): Promise<string> {
  // First try job-specific SVG
  const jobSvgPath = getJobTemplateSvgPath(jobId);
  try {
    return await fs.readFile(jobSvgPath, "utf8");
  } catch {
    // Fall back to template SVG
  }

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

        // Save the updated content
        const jobSvgPath = getJobTemplateSvgPath(jobId);
        await fs.writeFile(jobSvgPath, content);
        currentSvgContent = content;
        sessionTemplateChanged = true;
        onEvent?.({ type: "status", content: "SVG template updated" });

        return JSON.stringify({ success: true, results });
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
  let fieldUpdates: Record<string, string> | undefined;

  timing.start("load_template");
  currentSvgContent = await getSvgTemplateContent(jobId, templateId);
  timing.end();

  timing.start("create_tools");
  const updateFieldsTool = createUpdateFieldsTool(currentFields, templateFields, onEvent);
  const patchSvgTool = createPatchSvgTool(jobId, onEvent);
  timing.end();

  timing.start("create_agent");
  const agent = new Agent({
    name: "SVGTemplateEditor",
    instructions: TEMPLATE_AGENT_INSTRUCTIONS,
    model: "gpt-5.1",
    modelSettings: {
      reasoning: { effort: reasoning },
    },
    tools: [updateFieldsTool, patchSvgTool],
  });
  timing.end();

  try {
    timing.start("build_input");
    const contextMessage = `Current fields: ${JSON.stringify(currentFields)}

CURRENT SVG TEMPLATE:
\`\`\`svg
${currentSvgContent}
\`\`\`

Request: ${userMessage}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = previousHistory.length > 0
      ? [
          ...previousHistory,
          { role: "user", content: contextMessage },
        ]
      : contextMessage;
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
        const output = typeof anyItem.output === "string"
          ? anyItem.output.substring(0, 100) + (anyItem.output.length > 100 ? "..." : "")
          : String(anyItem.output).substring(0, 100);
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
    let mode: "fields" | "template" | "both" | "none" = "none";
    if (fieldUpdates && Object.keys(fieldUpdates).length > 0) {
      mode = "fields";
    }
    if (sessionTemplateChanged) {
      mode = mode === "fields" ? "both" : "template";
    }

    if (traces.length > 0) {
      console.log("Agent traces:", JSON.stringify(traces, null, 2));
    }

    const timingLogPath = await timing.save();

    return {
      success: true,
      mode,
      message: result.finalOutput || "Done.",
      fieldUpdates,
      templateChanged: sessionTemplateChanged,
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
