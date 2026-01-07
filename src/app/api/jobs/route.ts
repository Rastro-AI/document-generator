import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  createJob,
  getTemplate,
  saveUploadedFile,
  saveAssetFile,
  copyTemplateToJob,
  copySvgTemplateToJob,
  copySatoriTemplateToJob,
  getAssetBankFile,
} from "@/lib/fs-utils";
import { extractFieldsAndAssetsFromFiles } from "@/lib/llm";
import { Job, UploadedFile } from "@/lib/types";

// Check if a file is an image
function isImageFile(filename: string): boolean {
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return imageExtensions.includes(ext);
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const clientJobId = formData.get("jobId") as string | null;
    const templateId = formData.get("templateId") as string;
    const files = formData.getAll("files") as File[];
    const prompt = formData.get("prompt") as string | null;
    const assetIdsJson = formData.get("assetIds") as string | null;
    const assetIds: string[] = assetIdsJson ? JSON.parse(assetIdsJson) : [];

    if (!templateId) {
      return NextResponse.json(
        { error: "templateId is required" },
        { status: 400 }
      );
    }

    // Get the template
    const template = await getTemplate(templateId);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Use client-provided job ID or generate one
    const jobId = clientJobId || uuidv4();

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

    // Generate initial message based on what was provided
    let initialMessage = "I've created a new document. You can edit the field values on the left, or ask me to make changes.";

    // Track uploaded files
    const uploadedFiles: UploadedFile[] = [];

    // Copy asset bank files to job storage
    if (assetIds.length > 0) {
      const now = new Date().toISOString();
      for (const assetId of assetIds) {
        try {
          const buffer = await getAssetBankFile(assetId);
          if (!buffer) continue;

          const storagePath = isImageFile(assetId)
            ? `${jobId}/assets/${assetId}`
            : `${jobId}/${assetId}`;

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
              path: storagePath,
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

    // Include asset bank files in extraction lists
    for (const uf of uploadedFiles) {
      if (uf.type === "image") {
        imageFiles.push({ path: uf.path, filename: uf.filename });
      } else {
        documentFiles.push({ path: uf.path, filename: uf.filename });
      }
    }

    // If files were uploaded, save them
    if (files && files.length > 0) {
      const now = new Date().toISOString();

      // Save all files and categorize them
      for (const file of files) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = file.name || "input";
        const storagePath = isImageFile(filename)
          ? `${jobId}/assets/${filename}`
          : `${jobId}/${filename}`;

        if (isImageFile(filename)) {
          // Save image as asset
          await saveAssetFile(jobId, filename, buffer);
          imageFiles.push({ path: storagePath, filename });
          uploadedFiles.push({
            filename,
            path: storagePath,
            type: "image",
            uploadedAt: now,
          });
        } else {
          // Save as input document
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

    // Extract fields and assign assets using LLM if we have any files
    let extractedCount = 0;
    if (documentFiles.length > 0 || imageFiles.length > 0) {
      const extractionResult = await extractFieldsAndAssetsFromFiles(
        template,
        documentFiles,
        imageFiles,
        prompt || undefined
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

    // Copy template files to job storage based on format
    await copyTemplateToJob(templateId, jobId);
    if (template.format === "satori") {
      await copySatoriTemplateToJob(templateId, jobId);
    } else {
      await copySvgTemplateToJob(templateId, jobId);
    }

    return NextResponse.json({ jobId });
  } catch (error) {
    console.error("Error creating job:", error);
    return NextResponse.json(
      { error: "Failed to create job", details: String(error) },
      { status: 500 }
    );
  }
}
