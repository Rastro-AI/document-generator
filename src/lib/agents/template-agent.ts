/**
 * Template Editing Agent
 * Uses OpenAI Agents SDK to edit PDF templates
 * Optimized for speed - single run, no image injection loops
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
 * Instructions for the template editing agent - optimized for speed
 */
const TEMPLATE_AGENT_INSTRUCTIONS = `
You are a React PDF template editor. Edit templates that use @react-pdf/renderer.

WORKFLOW:
1. Read the template with read_template
2. Make changes with edit_template
3. Respond with a brief summary of what you changed

RULES:
- Keep function signature: export function render(fields, assets, templateRoot)
- Only use: Document, Page, View, Text, Image, StyleSheet, Font
- Styles must use StyleSheet.create()
- Make minimal, targeted changes

TIPS:
- Colors: change hex values like "#0099CC"
- Spacing: modify padding/margin values
- Fonts: adjust fontSize, fontWeight
- Layout: modify flexDirection, width, height
`.trim();

/**
 * Create read_template tool
 */
function createReadTemplateTool(jobId: string, templateId: string, onEvent?: AgentEventCallback) {
  return tool({
    name: "read_template",
    description: "Read the template.tsx file contents.",
    parameters: z.object({}),
    execute: async () => {
      onEvent?.({ type: "status", content: "Reading template..." });
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
    },
  });
}

/**
 * Track template changes for this session
 */
let sessionTemplateChanged = false;

/**
 * Create edit_template tool
 */
function createEditTemplateTool(jobId: string, onEvent?: AgentEventCallback) {
  return tool({
    name: "edit_template",
    description: "Edit template.tsx. Provide complete modified file content.",
    parameters: z.object({
      new_content: z.string().describe("Complete new template.tsx content"),
    }),
    execute: async ({ new_content }) => {
      onEvent?.({ type: "status", content: "Applying changes to template..." });
      try {
        if (!new_content.includes("export function render")) {
          return JSON.stringify({ error: "Must export render function" });
        }
        await updateJobTemplateContent(jobId, new_content);
        sessionTemplateChanged = true;
        onEvent?.({ type: "status", content: "Template updated successfully" });
        return JSON.stringify({ success: true });
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
}

/**
 * Run the template editing agent - optimized for speed
 */
export async function runTemplateAgent(
  jobId: string,
  templateId: string,
  userMessage: string,
  currentFields: Record<string, string | number | null>,
  templateFields: Array<{ name: string; type: string; description: string }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previousHistory: any[] = [],
  onEvent?: AgentEventCallback
): Promise<TemplateAgentResult> {
  ensureProvider();

  // Emit initial status
  onEvent?.({ type: "status", content: "Thinking..." });

  // Reset session tracking
  sessionTemplateChanged = false;
  let fieldUpdates: Record<string, string> | undefined;

  // Create tools with event callback
  const readTemplateTool = createReadTemplateTool(jobId, templateId, onEvent);
  const updateFieldsTool = createUpdateFieldsTool(currentFields, templateFields, onEvent);
  const editTemplateTool = createEditTemplateTool(jobId, onEvent);

  // Create agent with reasoning disabled for speed
  const agent = new Agent({
    name: "TemplateEditor",
    instructions: TEMPLATE_AGENT_INSTRUCTIONS,
    model: "gpt-5.1",
    tools: [readTemplateTool, updateFieldsTool, editTemplateTool],
  });

  try {
    // Build input - continue from previous history or start fresh
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const input: any = previousHistory.length > 0
      ? [
          ...previousHistory,
          {
            role: "user",
            content: `Current fields: ${JSON.stringify(currentFields)}\n\nRequest: ${userMessage}`,
          },
        ]
      : `Current fields: ${JSON.stringify(currentFields)}\n\nRequest: ${userMessage}`;

    // Single run - no loops, no image injection
    const result = await run(agent, input, { maxTurns: 5 });

    // Collect traces for UI display
    const traces: AgentTrace[] = [];

    // Extract traces and field updates from run items
    // SDK returns RunItem wrappers with type like "tool_call_item", actual data in rawItem
    for (const item of result.newItems || []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyItem = item as any;

      // Capture reasoning traces (RunReasoningItem has type: "reasoning_item")
      if (anyItem.type === "reasoning_item" && anyItem.rawItem) {
        const reasoningText = extractReasoningText(anyItem.rawItem);
        if (reasoningText) {
          traces.push({ type: "reasoning", content: reasoningText });
        }
      }

      // Capture tool calls (RunToolCallItem has type: "tool_call_item")
      if (anyItem.type === "tool_call_item" && anyItem.rawItem) {
        const rawItem = anyItem.rawItem;
        const toolName = rawItem.name || "unknown";
        traces.push({
          type: "tool_call",
          content: `Calling ${toolName}`,
          toolName
        });
      }

      // Capture tool results (RunToolCallOutputItem has type: "tool_call_output_item")
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

    return {
      success: true,
      mode,
      message: result.finalOutput || "Done.",
      fieldUpdates,
      templateChanged: sessionTemplateChanged,
      traces,
      history: result.history,
    };
  } catch (error) {
    console.error("Template agent error:", error);
    return {
      success: false,
      mode: "none",
      message: `Failed: ${error}`,
    };
  }
}
