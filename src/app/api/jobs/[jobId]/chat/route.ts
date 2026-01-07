import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  getTemplate,
  updateJobFields,
  addJobHistoryEntry,
  getAgentHistory,
  updateAgentHistory,
} from "@/lib/fs-utils";
import { runTemplateAgent } from "@/lib/agents/template-agent";

export const maxDuration = 300; // 5 minutes for long-running agent tasks

interface ChatRequest {
  message: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body: ChatRequest = await request.json();
    const { message } = body;

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

    // Save current state to history before any changes
    await addJobHistoryEntry(jobId, "AI edit");

    // Get the full agent thread history for this job
    const previousHistory = await getAgentHistory(jobId);

    // Always use the full agent - it can update fields AND make design changes
    // The agent will render previews, check results, and make tweaks as needed
    const agentResult = await runTemplateAgent(
      jobId,
      job.templateId,
      message,
      job.fields,
      template.fields,
      previousHistory,
      undefined, // onEvent
      "none",    // reasoning
      "satori",  // Always Satori format
      template.satoriConfig,
      template.fonts
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

    // Return the agent result
    return NextResponse.json({
      success: agentResult.success,
      mode: agentResult.mode,
      message: agentResult.message,
      templateChanged: agentResult.templateChanged,
      traces: agentResult.traces,
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json(
      { error: "Chat failed", details: String(error) },
      { status: 500 }
    );
  }
}
