import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createJob,
  getJob,
  getTemplate,
  saveUploadedFile,
  saveAssetFile,
  copyTemplateToJob,
  copySvgTemplateToJob,
  listAssetBankFiles,
  getAssetBankFile,
  markJobRendered,
  getJobSvgContent,
  saveJobOutputPdf,
  updateJobFields as updateJobFieldsInDb,
  updateJobInitialMessage,
} from "@/lib/fs-utils";
import { Job, UploadedFile } from "@/lib/types";
import { runTemplateAgent } from "@/lib/agents/template-agent";
import { renderSVGTemplate, prepareAssets, svgToPdf } from "@/lib/svg-template-renderer";
import { getAssetFile, getAssetBankFile as getAssetBankFileBuffer } from "@/lib/fs-utils";

export const runtime = "nodejs";

function isImageFile(filename: string): boolean {
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return imageExtensions.includes(ext);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const clientJobId = formData.get("jobId") as string | null;
  const templateId = formData.get("templateId") as string;
  const files = formData.getAll("files") as File[];
  const prompt = formData.get("prompt") as string | null;
  const assetIdsJson = formData.get("assetIds") as string | null;
  const assetIds: string[] = assetIdsJson ? JSON.parse(assetIdsJson) : [];
  const reasoning = (formData.get("reasoning") as "none" | "low" | null) || "none";

  if (!templateId) {
    return new Response(JSON.stringify({ error: "templateId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const template = await getTemplate(templateId);
  if (!template) {
    return new Response(JSON.stringify({ error: "Template not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  const sendEvent = (event: string, data: unknown) => {
    writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  };

  // Run job creation in background
  (async () => {
    try {
      const jobId = clientJobId || uuidv4();
      sendEvent("trace", { type: "status", content: "Creating job..." });

      // Initialize empty fields from template
      const fields: Record<string, string | number | null> = {};
      for (const field of template.fields) {
        fields[field.name] = null;
      }

      // Initialize empty assets from template
      const assets: Record<string, string | null> = {};
      for (const slot of template.assetSlots) {
        assets[slot.name] = null;
      }

      const uploadedFiles: UploadedFile[] = [];

      // Get all asset bank files from Supabase storage
      let allAssetBankFiles: string[] = [];
      try {
        allAssetBankFiles = await listAssetBankFiles();
      } catch {
        // Assets may not exist or storage not configured
      }

      // Merge explicitly selected assets with all asset bank files
      const allAssetIds = [...new Set([...assetIds, ...allAssetBankFiles])];

      if (allAssetIds.length > 0) {
        sendEvent("trace", { type: "status", content: `Loading ${allAssetIds.length} asset${allAssetIds.length > 1 ? "s" : ""} from library...` });
        const now = new Date().toISOString();
        for (const assetId of allAssetIds) {
          try {
            const buffer = await getAssetBankFile(assetId);
            if (!buffer) continue;

            const storagePath = `${jobId}/assets/${assetId}`;

            if (isImageFile(assetId)) {
              await saveAssetFile(jobId, assetId, buffer);
              uploadedFiles.push({
                filename: assetId,
                path: storagePath,
                type: "image",
                uploadedAt: now,
              });
            } else {
              await saveUploadedFile(jobId, assetId, buffer);
              uploadedFiles.push({
                filename: assetId,
                path: `${jobId}/${assetId}`,
                type: "document",
                uploadedAt: now,
              });
            }
          } catch (err) {
            console.error(`Failed to copy asset ${assetId}:`, err);
          }
        }
      }

      // Save uploaded files
      if (files && files.length > 0) {
        sendEvent("trace", { type: "status", content: `Saving ${files.length} uploaded file${files.length > 1 ? "s" : ""}...` });
        const now = new Date().toISOString();

        for (const file of files) {
          const buffer = Buffer.from(await file.arrayBuffer());
          const filename = file.name || "input";
          const storagePath = isImageFile(filename)
            ? `${jobId}/assets/${filename}`
            : `${jobId}/${filename}`;

          if (isImageFile(filename)) {
            await saveAssetFile(jobId, filename, buffer);
            uploadedFiles.push({
              filename,
              path: storagePath,
              type: "image",
              uploadedAt: now,
            });
          } else {
            await saveUploadedFile(jobId, filename, buffer);
            uploadedFiles.push({
              filename,
              path: storagePath,
              type: "document",
              uploadedAt: now,
            });
          }
        }
      }

      // Create the job first so the agent can access it
      sendEvent("trace", { type: "status", content: "Setting up document..." });
      const historyId = uuidv4();
      const now = new Date().toISOString();

      const job: Job = {
        id: jobId,
        templateId,
        fields,
        assets,
        createdAt: now,
        initialMessage: "Processing...",
        uploadedFiles,
        history: [{
          id: historyId,
          fields: { ...fields },
          assets: { ...assets },
          timestamp: now,
          description: "Initial state",
        }],
      };

      await createJob(job);

      // Copy template files to job storage
      await copyTemplateToJob(templateId, jobId);
      await copySvgTemplateToJob(templateId, jobId);

      // Build the agent prompt
      const hasFiles = uploadedFiles.length > 0;
      const agentPrompt = prompt
        ? prompt
        : hasFiles
          ? "Extract data from the uploaded files, fill in the template fields, assign images to asset slots, and verify the output looks good."
          : "Fill in the template with appropriate placeholder values and verify the output looks good.";

      // Run the unified template agent
      sendEvent("trace", { type: "status", content: "Processing..." });

      const agentResult = await runTemplateAgent(
        jobId,
        templateId,
        agentPrompt,
        fields,
        template.fields,
        [], // No previous history
        (trace) => sendEvent("trace", trace),
        reasoning
      );

      // Re-fetch the updated job
      let finalJob = await getJob(jobId);

      // Update initialMessage in the database
      const agentMessage = agentResult.message || "Document is ready for review.";
      finalJob = await updateJobInitialMessage(jobId, agentMessage) || finalJob;

      // Render the final PDF so it's ready immediately
      sendEvent("trace", { type: "status", content: "Generating PDF..." });
      try {
        const svgContent = await getJobSvgContent(jobId);
        if (svgContent && finalJob) {
          // Prepare assets as data URLs
          const assetDataUrls: Record<string, string | null> = {};
          for (const [key, value] of Object.entries(finalJob.assets || {})) {
            if (value) {
              try {
                const assetFilename = value.includes("/") ? value.split("/").pop()! : value;
                let imageBuffer: Buffer | null = await getAssetFile(jobId, assetFilename);
                if (!imageBuffer) imageBuffer = await getAssetBankFileBuffer(assetFilename);
                if (imageBuffer) {
                  const ext = assetFilename.split(".").pop()?.toLowerCase() || "png";
                  const mimeTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };
                  assetDataUrls[key] = `data:${mimeTypes[ext] || "application/octet-stream"};base64,${imageBuffer.toString("base64")}`;
                } else {
                  assetDataUrls[key] = null;
                }
              } catch {
                assetDataUrls[key] = null;
              }
            } else {
              assetDataUrls[key] = null;
            }
          }

          const preparedAssets = await prepareAssets(assetDataUrls);
          const renderedSvg = renderSVGTemplate(svgContent, finalJob.fields, preparedAssets);
          const pdfBuffer = await svgToPdf(renderedSvg);
          await saveJobOutputPdf(jobId, pdfBuffer);
          finalJob = await markJobRendered(jobId) || finalJob;
          console.log(`[JobStream] PDF rendered for job ${jobId}, renderedAt: ${finalJob?.renderedAt}`);
        }
      } catch (err) {
        console.error("[JobStream] Failed to render PDF:", err);
      }

      sendEvent("result", { jobId, job: finalJob });
      sendEvent("done", {});
    } catch (error) {
      console.error("Error creating job:", error);
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
