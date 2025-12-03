import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import {
  getJob,
  getTemplate,
  updateJobFields,
  addJobHistoryEntry,
  getAgentHistory,
  updateAgentHistory,
} from "@/lib/fs-utils";
import { runTemplateAgent } from "@/lib/agents/template-agent";

// Lazy-load OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

interface ChatRequest {
  message: string;
  mode: "fields" | "template" | "auto";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body: ChatRequest = await request.json();
    const { message, mode } = body;

    if (!message) {
      return NextResponse.json(
        { error: "message is required" },
        { status: 400 }
      );
    }

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const template = await getTemplate(job.templateId);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const openai = getOpenAI();

    // Handle auto mode using the Agents SDK
    // The agent has tools for both field updates and template design changes
    if (mode === "auto") {
      // Save current state to history before any changes
      await addJobHistoryEntry(jobId, "AI edit");

      // Get the full agent thread history for this job
      const previousHistory = await getAgentHistory(jobId);

      const agentResult = await runTemplateAgent(
        jobId,
        job.templateId,
        message,
        job.fields,
        template.fields,
        previousHistory
      );

      // Store the updated agent history (full thread)
      if (agentResult.history) {
        await updateAgentHistory(jobId, agentResult.history);
      }

      // Handle field updates if any
      if (agentResult.fieldUpdates && Object.keys(agentResult.fieldUpdates).length > 0) {
        const updatedFields = { ...job.fields };
        for (const [key, value] of Object.entries(agentResult.fieldUpdates)) {
          if (key in job.fields) {
            updatedFields[key] = value;
          }
        }
        await updateJobFields(jobId, updatedFields);

        return NextResponse.json({
          success: agentResult.success,
          mode: agentResult.mode,
          fields: updatedFields,
          message: agentResult.message,
          templateChanged: agentResult.templateChanged,
          traces: agentResult.traces,
        });
      }

      // Return the agent result for template-only changes
      return NextResponse.json({
        success: agentResult.success,
        mode: agentResult.mode,
        message: agentResult.message,
        templateChanged: agentResult.templateChanged,
        traces: agentResult.traces,
      });
    }

    // Handle explicit fields mode (keeps legacy behavior)
    if (mode === "fields") {
      return await editFields(openai, job, template, jobId, message);
    }

    // Handle explicit template mode using the agent
    if (mode === "template") {
      await addJobHistoryEntry(jobId, "Design edit");

      // Get the full agent thread history for this job
      const previousHistory = await getAgentHistory(jobId);

      const agentResult = await runTemplateAgent(
        jobId,
        job.templateId,
        message,
        job.fields,
        template.fields,
        previousHistory
      );

      // Store the updated agent history (full thread)
      if (agentResult.history) {
        await updateAgentHistory(jobId, agentResult.history);
      }

      return NextResponse.json({
        success: agentResult.success,
        mode: "template",
        message: agentResult.message,
        templateChanged: agentResult.templateChanged,
        traces: agentResult.traces,
      });
    }

    return NextResponse.json(
      { error: "Invalid mode" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Chat failed", details: String(error) },
      { status: 500 }
    );
  }
}

async function editFields(
  openai: OpenAI,
  job: { fields: Record<string, string | number | null> },
  template: { fields: Array<{ name: string; type: string; description: string }> },
  jobId: string,
  message: string
) {
  const fieldSchema = template.fields
    .map((f) => `- ${f.name} (${f.type}): ${f.description}`)
    .join("\n");

  const systemPrompt = `You are a data editing assistant. The user wants to update field values for a product specification document.

Current field values:
${JSON.stringify(job.fields, null, 2)}

Available fields:
${fieldSchema}

Based on the user's request, return an updated JSON object with the field values.
Only modify fields that the user explicitly mentions.
Return ONLY valid JSON, no explanation text.`;

  const response = await openai.responses.create({
    model: "gpt-5.1",
    reasoning: { effort: "none" },
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ],
  });

  const responseText = response.output_text;

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json(
      { error: "Failed to parse LLM response", raw: responseText },
      { status: 500 }
    );
  }

  const updatedFields = JSON.parse(jsonMatch[0]);
  await updateJobFields(jobId, updatedFields);

  return NextResponse.json({
    success: true,
    mode: "fields",
    fields: updatedFields,
    message: "Fields updated successfully",
  });
}
