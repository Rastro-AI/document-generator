import { NextRequest } from "next/server";
import {
  getJob,
  getTemplate,
  updateJobFields,
  addJobHistoryEntry,
  getAgentHistory,
  updateAgentHistory,
  getJobSvgContent,
} from "@/lib/fs-utils";
import { runTemplateAgent, AgentTrace } from "@/lib/agents/template-agent";
import { createTimingLogger } from "@/lib/timing-logger";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const requestTiming = createTimingLogger("request_init");

  requestTiming.start("parse_params");
  const { jobId } = await params;
  const body = await request.json();
  const { message, mode, reasoning = "none" } = body;
  requestTiming.end();

  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  requestTiming.start("get_job");
  const job = await getJob(jobId);
  requestTiming.end();
  if (!job) {
    return new Response(JSON.stringify({ error: "Job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  requestTiming.start("get_template");
  const template = await getTemplate(job.templateId);
  requestTiming.end();
  if (!template) {
    return new Response(JSON.stringify({ error: "Template not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Save request init timing (this runs before agent starts)
  requestTiming.save();

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
    const timing = createTimingLogger(`stream_${jobId}`);

    try {
      timing.start("add_history_entry");
      // Save current state to history before any changes
      // Skip the expensive preview generation - just save the SVG snapshot
      let svgSnapshot: string | undefined;
      try {
        svgSnapshot = await getJobSvgContent(jobId) || undefined;
      } catch (e) {
        console.error("Failed to capture SVG snapshot:", e);
      }
      await addJobHistoryEntry(jobId, mode === "auto" ? "AI edit" : "Design edit", svgSnapshot);
      timing.end();

      timing.start("get_agent_history");
      // Get the full agent thread history for this job
      const previousHistory = await getAgentHistory(jobId);
      timing.end();

      // Event callback for real-time updates (synchronous - fire and forget)
      const onEvent = (trace: AgentTrace) => {
        sendEvent("trace", trace);
      };

      timing.start("run_template_agent");
      const agentResult = await runTemplateAgent(
        jobId,
        job.templateId,
        message,
        job.fields,
        template.fields,
        previousHistory,
        onEvent,
        reasoning as "none" | "low"
      );
      timing.end();

      timing.start("update_agent_history");
      // Store the updated agent history (full thread)
      if (agentResult.history) {
        await updateAgentHistory(jobId, agentResult.history);
      }
      timing.end();

      // Handle field updates if any
      let updatedFields = job.fields;
      console.log(`[Chat] Job ${jobId} - Agent result mode: ${agentResult.mode}`);
      console.log(`[Chat] Job ${jobId} - Agent fieldUpdates:`, JSON.stringify(agentResult.fieldUpdates));

      if (agentResult.fieldUpdates && Object.keys(agentResult.fieldUpdates).length > 0) {
        timing.start("update_job_fields");
        updatedFields = { ...job.fields };
        for (const [key, value] of Object.entries(agentResult.fieldUpdates)) {
          if (key in job.fields) {
            updatedFields[key] = value;
            console.log(`[Chat] Job ${jobId} - Setting field ${key} = ${value}`);
          } else {
            console.log(`[Chat] Job ${jobId} - Field ${key} NOT in job.fields, skipping`);
          }
        }
        await updateJobFields(jobId, updatedFields);
        console.log(`[Chat] Job ${jobId} - Fields saved to DB`);
        timing.end();
      } else {
        console.log(`[Chat] Job ${jobId} - No field updates from agent`);
      }

      // Save stream timing log
      await timing.save();

      // Log what we're sending back to the client
      console.log(`[Chat] Job ${jobId} - Sending result: mode=${agentResult.mode}, templateChanged=${agentResult.templateChanged}, traces=${agentResult.traces?.length || 0}`);

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
      await timing.save();
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
