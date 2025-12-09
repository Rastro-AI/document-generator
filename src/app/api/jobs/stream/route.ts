import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { createJob, getTemplate, saveUploadedFile, saveAssetFile, copyTemplateToJob } from "@/lib/fs-utils";
import { extractFieldsAndAssetsFromFiles } from "@/lib/llm";
import { Job, UploadedFile } from "@/lib/types";
import { getJobInputPath, getJobAssetPath } from "@/lib/paths";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets");

function isImageFile(filename: string): boolean {
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
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

      // Always include all asset bank files in the job context
      // This ensures certification logos and other reusable assets are available
      let allAssetBankFiles: string[] = [];
      try {
        allAssetBankFiles = await fs.readdir(ASSETS_DIR);
      } catch {
        // Assets directory may not exist
      }

      // Merge explicitly selected assets with all asset bank files
      const allAssetIds = [...new Set([...assetIds, ...allAssetBankFiles])];

      if (allAssetIds.length > 0) {
        sendEvent("trace", { type: "status", content: `Loading ${allAssetIds.length} asset${allAssetIds.length > 1 ? "s" : ""} from library...` });
        const now = new Date().toISOString();
        for (const assetId of allAssetIds) {
          try {
            const assetPath = path.join(ASSETS_DIR, assetId);
            const buffer = await fs.readFile(assetPath);

            if (isImageFile(assetId)) {
              await saveAssetFile(jobId, assetId, buffer);
              uploadedFiles.push({
                filename: assetId,
                path: getJobAssetPath(jobId, assetId),
                type: "image",
                uploadedAt: now,
              });
            } else {
              await saveUploadedFile(jobId, assetId, buffer);
              uploadedFiles.push({
                filename: assetId,
                path: getJobInputPath(jobId, assetId),
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

          if (isImageFile(filename)) {
            await saveAssetFile(jobId, filename, buffer);
            const assetPath = getJobAssetPath(jobId, filename);
            imageFiles.push({ path: assetPath, filename });
            uploadedFiles.push({
              filename,
              path: assetPath,
              type: "image",
              uploadedAt: now,
            });
          } else {
            await saveUploadedFile(jobId, filename, buffer);
            const filePath = getJobInputPath(jobId, filename);
            documentFiles.push({ path: filePath, filename });
            uploadedFiles.push({
              filename,
              path: filePath,
              type: "document",
              uploadedAt: now,
            });
          }
        }
      }

      // Extract fields and assign assets using LLM
      let extractedCount = 0;
      if (documentFiles.length > 0 || imageFiles.length > 0) {
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
        const imageCount = imageFiles.length;

        if (extractedCount > 0 || Object.values(assets).some(v => v !== null)) {
          const parts = [];
          if (extractedCount > 0) parts.push(`extracted ${extractedCount} fields`);
          if (imageCount > 0) parts.push(`assigned ${imageCount} image${imageCount > 1 ? "s" : ""} to the template`);

          initialMessage = `I've ${parts.join(" and ")} from your ${totalFiles} file${totalFiles > 1 ? "s" : ""}. The spec sheet is ready for preview. Feel free to edit any values or ask me to make changes.`;
        } else {
          initialMessage = `I've processed ${totalFiles} file${totalFiles > 1 ? "s" : ""} but couldn't extract specific data. Please fill in the values manually or provide more guidance.`;
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
      await copyTemplateToJob(templateId, jobId);

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
