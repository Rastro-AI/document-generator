/**
 * Template Generator Service
 * Isolated service for generating PDF templates from uploaded PDFs
 * Uses gpt-5.1 with high reasoning for complex template generation
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
 * Instructions for the template generator agent
 */
const TEMPLATE_GENERATOR_INSTRUCTIONS = `
You are a PDF template generator. Your job is to analyze a PDF and generate a @react-pdf/renderer template that recreates its layout.

WORKFLOW:
1. First, analyze the PDF structure using analyze_pdf
2. Generate the template code using generate_template
3. Output the final JSON metadata and template code

OUTPUT FORMAT:
You must call output_result with:
- templateJson: The template metadata (fields, assets, dimensions)
- templateCode: The complete template.tsx code

TEMPLATE RULES:
- Keep function signature: export function render(fields, assets, templateRoot)
- Only use: Document, Page, View, Text, Image, StyleSheet, Font from @react-pdf/renderer
- Styles must use StyleSheet.create()
- Match colors, fonts, spacing, and layout as closely as possible
- Extract all variable text as fields (product names, specs, descriptions)
- Extract all images as asset slots

TIPS:
- Use flexbox for layout (flexDirection, justifyContent, alignItems)
- Use absolute positioning sparingly, prefer flex layouts
- Match font sizes and weights carefully
- Use proper color hex values
`.trim();

export interface GeneratorTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status";
  content: string;
  toolName?: string;
}

export type GeneratorEventCallback = (event: GeneratorTrace) => void;

export interface TemplateGeneratorResult {
  success: boolean;
  templateJson?: {
    id: string;
    name: string;
    canvas: { width: number; height: number };
    fields: Array<{ name: string; type: string; description: string }>;
    assetSlots: Array<{ name: string; kind: string; description: string }>;
  };
  templateCode?: string;
  message: string;
  timingLogPath?: string;
}

// Store the generated result during tool execution
interface GeneratedResultData {
  templateJson: string;
  templateCode: string;
}
const resultStore: { value: GeneratedResultData | null } = { value: null };

/**
 * Create analyze_pdf tool
 */
function createAnalyzePdfTool(pdfBase64: string, onEvent?: GeneratorEventCallback) {
  return tool({
    name: "analyze_pdf",
    description: "Analyze the uploaded PDF structure. Returns a description of the layout, colors, fonts, and content.",
    parameters: z.object({}),
    execute: async () => {
      onEvent?.({ type: "status", content: "Analyzing PDF structure..." });
      // The PDF content is provided as base64, the model can see it in the input
      return JSON.stringify({
        status: "PDF loaded and ready for analysis",
        instructions: "Examine the PDF image carefully. Identify: 1) Overall layout structure, 2) Colors used, 3) Font styles and sizes, 4) Text content that should be fields, 5) Images that should be asset slots",
      });
    },
  });
}

/**
 * Create generate_template tool
 */
function createGenerateTemplateTool(onEvent?: GeneratorEventCallback) {
  return tool({
    name: "generate_template",
    description: "Generate the template code based on analysis. Call this after analyzing the PDF.",
    parameters: z.object({
      layout_description: z.string().describe("Description of the layout structure"),
      fields_identified: z.array(z.object({
        name: z.string(),
        type: z.string(),
        description: z.string(),
        example_value: z.string(),
      })).describe("Fields identified in the PDF"),
      assets_identified: z.array(z.object({
        name: z.string(),
        kind: z.string(),
        description: z.string(),
      })).describe("Asset slots identified in the PDF"),
    }),
    execute: async ({ layout_description, fields_identified, assets_identified }) => {
      onEvent?.({ type: "status", content: "Generating template structure..." });
      return JSON.stringify({
        status: "Structure captured",
        layout: layout_description,
        fields: fields_identified,
        assets: assets_identified,
        next_step: "Now call output_result with the complete templateJson and templateCode",
      });
    },
  });
}

/**
 * Create output_result tool
 */
function createOutputResultTool(onEvent?: GeneratorEventCallback) {
  return tool({
    name: "output_result",
    description: "Output the final template JSON and code. Call this when you have generated the complete template.",
    parameters: z.object({
      templateJson: z.string().describe("JSON string with template metadata: {id, name, canvas: {width, height}, fields: [{name, type, description}], assetSlots: [{name, kind, description}]}"),
      templateCode: z.string().describe("Complete template.tsx code with render function"),
    }),
    execute: async ({ templateJson, templateCode }) => {
      onEvent?.({ type: "status", content: "Finalizing template..." });
      resultStore.value = { templateJson, templateCode };
      return JSON.stringify({ status: "Template generated successfully" });
    },
  });
}

/**
 * Run the template generator agent
 */
export async function runTemplateGenerator(
  pdfBase64: string,
  pdfFilename: string,
  onEvent?: GeneratorEventCallback
): Promise<TemplateGeneratorResult> {
  const timing = new TimingLogger("template_generator");
  resultStore.value = null;

  timing.start("provider_init");
  ensureProvider();
  timing.end();

  onEvent?.({ type: "status", content: "Starting template generation..." });

  timing.start("create_tools");
  const analyzePdfTool = createAnalyzePdfTool(pdfBase64, onEvent);
  const generateTemplateTool = createGenerateTemplateTool(onEvent);
  const outputResultTool = createOutputResultTool(onEvent);
  timing.end();

  timing.start("create_agent");
  // Use gpt-5.1 with HIGH reasoning for complex template generation
  const agent = new Agent({
    name: "TemplateGenerator",
    instructions: TEMPLATE_GENERATOR_INSTRUCTIONS,
    model: "gpt-5.1",
    modelSettings: {
      reasoning: { effort: "high" },
    },
    tools: [analyzePdfTool, generateTemplateTool, outputResultTool],
  });
  timing.end();

  try {
    timing.start("build_input");
    // Build input with PDF as base64 image
    const input = [
      {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: `Generate a @react-pdf/renderer template that recreates this PDF layout. Filename: ${pdfFilename}

Steps:
1. Call analyze_pdf to examine the structure
2. Call generate_template with your analysis
3. Call output_result with the complete templateJson and templateCode`,
          },
          {
            type: "input_image" as const,
            image: pdfBase64,
            detail: "high" as const,
          },
        ],
      },
    ];
    timing.end();

    timing.start("agent_run");
    const result = await run(agent, input, { maxTurns: 10 });
    timing.end();

    timing.start("process_result");
    // Check if we got a result from the output_result tool
    const finalResult = resultStore.value as GeneratedResultData | null;
    if (finalResult !== null) {
      try {
        const templateJson = JSON.parse(finalResult.templateJson);
        timing.end();
        const timingLogPath = await timing.save();

        return {
          success: true,
          templateJson,
          templateCode: finalResult.templateCode,
          message: "Template generated successfully",
          timingLogPath,
        };
      } catch (parseError) {
        timing.end();
        const timingLogPath = await timing.save();
        return {
          success: false,
          message: `Failed to parse template JSON: ${parseError}`,
          timingLogPath,
        };
      }
    }

    timing.end();
    const timingLogPath = await timing.save();
    return {
      success: false,
      message: result.finalOutput || "Template generation did not produce output",
      timingLogPath,
    };
  } catch (error) {
    console.error("Template generator error:", error);
    const timingLogPath = await timing.save();
    return {
      success: false,
      message: `Failed: ${error}`,
      timingLogPath,
    };
  }
}
