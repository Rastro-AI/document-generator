import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createJob,
  getTemplate,
  saveUploadedFile,
  saveAssetFile,
  copyTemplateToJob,
  copySvgTemplateToJob,
  listAssetBankFiles,
  getAssetBankFile,
} from "@/lib/fs-utils";
import { extractFieldsAndAssetsFromFiles } from "@/lib/llm";
import { Job, UploadedFile } from "@/lib/types";

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

      let initialMessage = "I've created a new document. You can edit the field values on the left, or ask me to make changes.";
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

            // Storage path for the job
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

      // Prepare file lists for extraction
      const documentFiles: { path: string; filename: string }[] = [];
      const imageFiles: { path: string; filename: string }[] = [];

      for (const uf of uploadedFiles) {
        if (uf.type === "image") {
          imageFiles.push({ path: uf.path, filename: uf.filename });
        } else {
          documentFiles.push({ path: uf.path, filename: uf.filename });
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
            imageFiles.push({ path: storagePath, filename });
            uploadedFiles.push({
              filename,
              path: storagePath,
              type: "image",
              uploadedAt: now,
            });
          } else {
            await saveUploadedFile(jobId, filename, buffer);
            documentFiles.push({ path: storagePath, filename });
            uploadedFiles.push({
              filename,
              path: storagePath,
              type: "document",
              uploadedAt: now,
            });
          }
        }
      }

      // Extract fields and assign assets using LLM
      let extractedCount = 0;
      const hasFiles = documentFiles.length > 0 || imageFiles.length > 0;
      const hasPromptOnly = !hasFiles && prompt && prompt.trim().length > 0;

      if (hasFiles) {
        const extractionResult = await extractFieldsAndAssetsFromFiles(
          template,
          documentFiles,
          imageFiles,
          prompt || undefined,
          // Event callback for real-time updates
          (event) => {
            sendEvent("trace", event);
          },
          reasoning
        );

        // Merge extracted fields
        extractedCount = Object.entries(extractionResult.fields).filter(([, v]) => v !== null).length;
        for (const [key, value] of Object.entries(extractionResult.fields)) {
          if (value !== null) {
            fields[key] = value;
          }
        }

        // Merge assigned assets
        for (const [key, value] of Object.entries(extractionResult.assets)) {
          if (value !== null) {
            assets[key] = value;
          }
        }

        // Generate a descriptive initial message
        const totalFiles = documentFiles.length + imageFiles.length;
        const assignedAssetsCount = Object.values(assets).filter((v) => v !== null).length;

        // Emit a concise extraction summary trace for debugging
        sendEvent("trace", {
          type: "status",
          content: `Extraction summary: fields=${extractedCount}, assetsAssigned=${assignedAssetsCount}/${template.assetSlots.length}, imagesUploaded=${imageFiles.length}, documentsUploaded=${documentFiles.length}`,
        });

        if (extractedCount > 0 || assignedAssetsCount > 0) {
          const parts = [] as string[];
          if (extractedCount > 0) parts.push(`extracted ${extractedCount} fields`);
          if (assignedAssetsCount > 0) parts.push(`assigned ${assignedAssetsCount} image${assignedAssetsCount > 1 ? "s" : ""} to slots`);
          initialMessage = `I've ${parts.join(" and ")} from your ${totalFiles} file${totalFiles > 1 ? "s" : ""}. The spec sheet is ready for preview.`;
        } else {
          initialMessage = `I've processed ${totalFiles} file${totalFiles > 1 ? "s" : ""} but couldn't confidently extract data. You can edit values or provide more guidance.`;
          if (imageFiles.length > 0 && template.assetSlots.length > 0) {
            sendEvent("trace", {
              type: "status",
              content: `No assets were mapped to slots. Uploaded images: ${imageFiles.map((f) => f.filename).join(", ")}. Slots: ${template.assetSlots.map((s) => s.name).join(", ")}.`,
            });
          }
        }
      } else if (hasPromptOnly) {
        // Prompt-only case: use the template agent to fill fields
        sendEvent("trace", { type: "status", content: "Processing your request..." });

        // Import and use the template agent
        const { runTemplateAgent } = await import("@/lib/agents/template-agent");

        const agentResult = await runTemplateAgent(
          jobId,
          templateId,
          prompt!,
          fields, // Start with empty/null fields
          template.fields,
          [], // No previous history
          (trace) => sendEvent("trace", trace),
          reasoning
        );

        // Merge field updates from the agent
        if (agentResult.fieldUpdates && Object.keys(agentResult.fieldUpdates).length > 0) {
          for (const [key, value] of Object.entries(agentResult.fieldUpdates)) {
            if (key in fields) {
              fields[key] = value;
            }
          }
          extractedCount = Object.keys(agentResult.fieldUpdates).length;
        }

        if (extractedCount > 0) {
          initialMessage = agentResult.message || `I've populated ${extractedCount} fields based on your request. The document is ready for preview.`;
        } else {
          initialMessage = agentResult.message || "I've created a new document. You can edit the field values on the left, or ask me to make changes.";
        }
      }

      sendEvent("trace", { type: "status", content: "Finalizing job..." });

      // Create initial history entry
      const historyId = uuidv4();
      const now = new Date().toISOString();

      // Create the job
      const job: Job = {
        id: jobId,
        templateId,
        fields,
        assets,
        createdAt: now,
        initialMessage,
        uploadedFiles,
        history: [{
          id: historyId,
          fields: { ...fields },
          assets: { ...assets },
          timestamp: now,
          description: "Initial extraction",
        }],
      };

      await createJob(job);

      // Copy template files (TSX and/or SVG) to job storage
      await copyTemplateToJob(templateId, jobId);
      await copySvgTemplateToJob(templateId, jobId);

      sendEvent("result", { jobId, job });
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
