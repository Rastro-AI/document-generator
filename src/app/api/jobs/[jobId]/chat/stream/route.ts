import { NextRequest } from "next/server";
import {
  getJob,
  getTemplate,
  updateJobFields,
  addJobHistoryEntry,
  getAgentHistory,
  updateAgentHistory,
} from "@/lib/fs-utils";
import { runTemplateAgent, AgentTrace } from "@/lib/agents/template-agent";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params;
  const body = await request.json();
  const { message, mode } = body;

  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const job = await getJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const template = await getTemplate(job.templateId);
  if (!template) {
    return new Response(JSON.stringify({ error: "Template not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only support auto and template modes for streaming
  if (mode !== "auto" && mode !== "template") {
    return new Response(JSON.stringify({ error: "Streaming only supports auto/template mode" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Helper to send SSE event (fire and forget for traces)
  const sendEvent = (event: string, data: unknown) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  // Run agent in background
  (async () => {
    try {
      // Save current state to history before any changes
      await addJobHistoryEntry(jobId, mode === "auto" ? "AI edit" : "Design edit");

      // Get the full agent thread history for this job
      const previousHistory = await getAgentHistory(jobId);

      // Event callback for real-time updates (synchronous - fire and forget)
      const onEvent = (trace: AgentTrace) => {
        sendEvent("trace", trace);
      };

      const agentResult = await runTemplateAgent(
        jobId,
        job.templateId,
        message,
        job.fields,
        template.fields,
        previousHistory,
        onEvent
      );

      // Store the updated agent history (full thread)
      if (agentResult.history) {
        await updateAgentHistory(jobId, agentResult.history);
      }

      // Handle field updates if any
      let updatedFields = job.fields;
      if (agentResult.fieldUpdates && Object.keys(agentResult.fieldUpdates).length > 0) {
        updatedFields = { ...job.fields };
        for (const [key, value] of Object.entries(agentResult.fieldUpdates)) {
          if (key in job.fields) {
            updatedFields[key] = value;
          }
        }
        await updateJobFields(jobId, updatedFields);
      }

      // Send final result
      sendEvent("result", {
        success: agentResult.success,
        mode: agentResult.mode,
        fields: agentResult.fieldUpdates ? updatedFields : undefined,
        message: agentResult.message,
        templateChanged: agentResult.templateChanged,
        traces: agentResult.traces,
      });

      sendEvent("done", {});
    } catch (error) {
      console.error("Chat stream error:", error);
      sendEvent("error", { error: String(error) });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
