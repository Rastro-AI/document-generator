import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  getTemplate,
  saveUploadedFile,
  saveAssetFile,
  addUploadedFileToJob,
  addJobHistoryEntry,
  updateJobFields,
  updateJobAssets,
} from "@/lib/fs-utils";
import { extractFieldsAndAssetsFromFiles } from "@/lib/llm";
import { UploadedFile } from "@/lib/types";

// Check if a file is an image
function isImageFile(filename: string): boolean {
  const imageExtensions = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];
  const ext = filename.toLowerCase().slice(filename.lastIndexOf("."));
  return imageExtensions.includes(ext);
}

// POST - Upload additional files to a job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const prompt = formData.get("prompt") as string | null;
    const regenerate = formData.get("regenerate") === "true";

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

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "No files provided" },
        { status: 400 }
      );
    }

    // Save current state to history before making changes
    await addJobHistoryEntry(jobId, "Before file upload");

    const documentFiles: { path: string; filename: string }[] = [];
    const imageFiles: { path: string; filename: string }[] = [];
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

        const uploadedFile: UploadedFile = {
          filename,
          path: storagePath,
          type: "image",
          uploadedAt: now,
        };
        await addUploadedFileToJob(jobId, uploadedFile);
      } else {
        // Save as input document
        await saveUploadedFile(jobId, filename, buffer);
        documentFiles.push({ path: storagePath, filename });

        const uploadedFile: UploadedFile = {
          filename,
          path: storagePath,
          type: "document",
          uploadedAt: now,
        };
        await addUploadedFileToJob(jobId, uploadedFile);
      }
    }

    let message = `Uploaded ${files.length} file(s).`;

    // If regenerate is requested, re-extract fields and assets
    if (regenerate) {
      // Get all uploaded files (existing + new)
      const updatedJob = await getJob(jobId);
      const allDocFiles = (updatedJob?.uploadedFiles || [])
        .filter((f) => f.type === "document")
        .map((f) => ({ path: f.path, filename: f.filename }));
      const allImageFiles = (updatedJob?.uploadedFiles || [])
        .filter((f) => f.type === "image")
        .map((f) => ({ path: f.path, filename: f.filename }));

      const extractionResult = await extractFieldsAndAssetsFromFiles(
        template,
        allDocFiles,
        allImageFiles,
        prompt || undefined
      );

      // Merge extracted fields
      const updatedFields = { ...job.fields };
      for (const [key, value] of Object.entries(extractionResult.fields)) {
        if (value !== null) {
          updatedFields[key] = value;
        }
      }

      // Merge assigned assets
      const updatedAssets = { ...job.assets };
      for (const [key, value] of Object.entries(extractionResult.assets)) {
        if (value !== null) {
          updatedAssets[key] = value;
        }
      }

      console.log(`[Files] Job ${jobId} - Updating fields:`, JSON.stringify(updatedFields, null, 2));
      await updateJobFields(jobId, updatedFields);
      await updateJobAssets(jobId, updatedAssets);

      const extractedCount = Object.entries(extractionResult.fields).filter(
        ([, v]) => v !== null
      ).length;

      message = `Uploaded ${files.length} file(s) and re-extracted data. Found ${extractedCount} field values.`;
    }

    // Small delay to allow Supabase to propagate the write
    await new Promise(resolve => setTimeout(resolve, 500));

    const finalJob = await getJob(jobId);
    console.log(`[Files] Job ${jobId} - Final job fields:`, JSON.stringify(finalJob?.fields, null, 2));

    return NextResponse.json({
      success: true,
      message,
      job: finalJob,
    });
  } catch (error) {
    console.error("Error uploading files:", error);
    return NextResponse.json(
      { error: "Failed to upload files", details: String(error) },
      { status: 500 }
    );
  }
}
