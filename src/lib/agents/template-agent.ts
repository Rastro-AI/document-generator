/**
 * Template Editing Agent
 * Uses OpenAI Agents SDK to edit PDF templates
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
import path from "path";
import { getTemplateRoot } from "@/lib/paths";
import { getJobTemplateContent, updateJobTemplateContent } from "@/lib/fs-utils";
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
 * Instructions for the template editing agent - optimized for speed with diff-based edits
 */
const TEMPLATE_AGENT_INSTRUCTIONS = `
You are a React PDF template editor. Edit templates that use @react-pdf/renderer.

The current template code is provided in the user message. Make changes using the patch_template tool with search/replace operations.

WORKFLOW:
1. Analyze the template code provided in context
2. Use patch_template with one or more search/replace operations
3. Respond with a brief summary of what you changed

RULES FOR patch_template:
- Each operation finds an exact string and replaces it
- The "search" string must match EXACTLY (including whitespace/indentation)
- Keep changes minimal - only modify what's needed
- You can include multiple operations in one call

TEMPLATE RULES:
- Keep function signature: export function render(fields, assets, templateRoot)
- Only use: Document, Page, View, Text, Image, StyleSheet, Font
- Styles must use StyleSheet.create()

COMMON EDITS:
- Colors: change hex values like "#0099CC" to "#FF0000"
- Font size: change fontSize: 12 to fontSize: 24
- Spacing: modify padding/margin values
- Layout: modify flexDirection, width, height
`.trim();

/**
 * Get template content for a job
 */
async function getTemplateContent(jobId: string, templateId: string): Promise<string> {
  const jobTemplateContent = await getJobTemplateContent(jobId);
  if (jobTemplateContent) {
    return jobTemplateContent;
  }

  const templateRoot = getTemplateRoot(templateId);
  const templatePath = path.join(templateRoot, "template.tsx");
  try {
    return await fs.readFile(templatePath, "utf8");
  } catch {
    return "Error: Template file not found";
  }
}

/**
 * Track template changes for this session
 */
let sessionTemplateChanged = false;
let currentTemplateContent = "";

/**
 * Create patch_template tool - diff-based editing for speed
 */
function createPatchTemplateTool(jobId: string, onEvent?: AgentEventCallback) {
  return tool({
    name: "patch_template",
    description: "Edit template using search/replace operations. Provide one or more operations to find and replace exact strings in the template.",
    parameters: z.object({
      operations: z.array(z.object({
        search: z.string().describe("Exact string to find in the template (must match exactly including whitespace)"),
        replace: z.string().describe("String to replace it with"),
      })).describe("Array of search/replace operations to apply"),
    }),
    execute: async ({ operations }) => {
      onEvent?.({ type: "status", content: "Applying changes..." });
      try {
        let content = currentTemplateContent;
        const results: string[] = [];

        for (const op of operations) {
          if (!content.includes(op.search)) {
            results.push(`NOT FOUND: "${op.search.substring(0, 50)}..."`);
            continue;
          }
          content = content.replace(op.search, op.replace);
          results.push(`OK: replaced "${op.search.substring(0, 30)}..."`);
        }

        // Validate the result
        if (!content.includes("export function render")) {
          return JSON.stringify({ error: "Result missing render function", results });
        }

        // Save the updated content
        await updateJobTemplateContent(jobId, content);
        currentTemplateContent = content;
        sessionTemplateChanged = true;
        onEvent?.({ type: "status", content: "Template updated" });

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
  // Handle different reasoning item structures from the SDK
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

/**
 * Run the template editing agent - optimized for speed with diff-based edits
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

  // Emit initial status
  onEvent?.({ type: "status", content: "Thinking..." });

  // Reset session tracking
  sessionTemplateChanged = false;
  let fieldUpdates: Record<string, string> | undefined;

  timing.start("load_template");
  // Load template content upfront - no tool call needed
  currentTemplateContent = await getTemplateContent(jobId, templateId);
  timing.end();

  timing.start("create_tools");
  // Create tools with event callback
  const updateFieldsTool = createUpdateFieldsTool(currentFields, templateFields, onEvent);
  const patchTemplateTool = createPatchTemplateTool(jobId, onEvent);
  timing.end();

  timing.start("create_agent");
  // Create agent with gpt-5.1 - fast mode (none) or slow mode (low reasoning)
  const agent = new Agent({
    name: "TemplateEditor",
    instructions: TEMPLATE_AGENT_INSTRUCTIONS,
    model: "gpt-5.1",
    modelSettings: {
      reasoning: { effort: reasoning },
    },
    tools: [updateFieldsTool, patchTemplateTool],
  });
  timing.end();

  try {
    timing.start("build_input");
    // Build input with template in context (no need for read_template tool call)
    const contextMessage = `Current fields: ${JSON.stringify(currentFields)}

CURRENT TEMPLATE CODE:
\`\`\`tsx
${currentTemplateContent}
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
    // Single run - no loops
    const result = await run(agent, input, { maxTurns: 5 });
    timing.end();

    timing.start("extract_traces");
    // Collect traces for UI display
    const traces: AgentTrace[] = [];

    // Extract traces and field updates from run items
    for (const item of result.newItems || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyItem = item as any;

      // Capture reasoning traces
      if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
        const reasoningText = extractReasoningText(anyItem.rawItem);
        if (reasoningText) {
          traces.push({ type: "reasoning", content: reasoningText });
        }
      }

      // Capture tool calls
      if (anyItem.type === "tool_call_item" && anyItem.rawItem) {
        const rawItem = anyItem.rawItem;
        const toolName = rawItem.name || "unknown";
        traces.push({
          type: "tool_call",
          content: `Calling ${toolName}`,
          toolName
        });
      }

      // Capture tool results
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

    // Log traces for debugging
    if (traces.length > 0) {
      console.log("Agent traces:", JSON.stringify(traces, null, 2));
    }

    // Save timing log
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
    console.error("Template agent error:", error);
    // Save timing log even on error
    const timingLogPath = await timing.save();
    return {
      success: false,
      mode: "none",
      message: `Failed: ${error}`,
      timingLogPath,
    };
  }
}
