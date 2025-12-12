import fs from "fs/promises";
import path from "path";
import { Template, Job, JobHistoryEntry, UploadedFile } from "./types";
import { v4 as uuidv4 } from "uuid";
import {
  TEMPLATES_DIR,
  getTemplateJsonPath,
  getTemplateTsxPath,
  getTemplateSvgPath,
} from "./paths";
import {
  uploadFile,
  downloadFile,
  deleteFile,
  listFiles,
  fileExists,
  BUCKETS,
  isSupabaseConfigured,
} from "./supabase";
import {
  isDbConfigured,
  getJobFromDb,
  createJobInDb,
  updateJobFieldsInDb,
  updateJobAssetsInDb,
  updateJobInitialMessageInDb,
  markJobRenderedInDb,
  addUploadedFileToJobInDb,
  addJobHistoryEntryInDb,
  updateAgentHistoryInDb,
  updateContainerIdInDb,
  restoreJobFromHistoryInDb,
  deleteJobFromDb,
} from "./db";

// ============================================================================
// Template Operations (Local Filesystem - bundled with app)
// ============================================================================

// Check if a local path exists
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// List all SVG templates (from local filesystem)
// Only returns templates that have a template.svg file
export async function listTemplates(): Promise<{ id: string; name: string }[]> {
  const entries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
  const templates: { id: string; name: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const jsonPath = getTemplateJsonPath(entry.name);
      const svgPath = getTemplateSvgPath(entry.name);

      // Only include templates with a .svg file
      if (await pathExists(jsonPath) && await pathExists(svgPath)) {
        const content = await fs.readFile(jsonPath, "utf-8");
        const template = JSON.parse(content) as Template;
        templates.push({ id: template.id, name: template.name });
      }
    }
  }

  return templates;
}

// Get a template by ID (from local filesystem)
export async function getTemplate(templateId: string): Promise<Template | null> {
  const jsonPath = getTemplateJsonPath(templateId);
  if (!(await pathExists(jsonPath))) {
    return null;
  }
  const content = await fs.readFile(jsonPath, "utf-8");
  return JSON.parse(content) as Template;
}

// Get SVG template content from template folder
export async function getTemplateSvgContent(templateId: string): Promise<string | null> {
  const svgPath = getTemplateSvgPath(templateId);
  if (!(await pathExists(svgPath))) {
    return null;
  }
  return await fs.readFile(svgPath, "utf-8");
}

// ============================================================================
// Job Operations (Supabase Postgres DB for metadata, Storage for files)
// ============================================================================

// Helper to get job file path in storage
function getJobFilePath(jobId: string, filename: string): string {
  return `${jobId}/${filename}`;
}

// Helper to get job asset path in storage
function getJobAssetPath(jobId: string, filename: string): string {
  return `${jobId}/assets/${filename}`;
}

// Create a new job
export async function createJob(job: Job): Promise<void> {
  if (!isDbConfigured()) {
    throw new Error("Database not configured - cannot create job");
  }
  await createJobInDb(job);
}

// Get a job by ID
export async function getJob(jobId: string): Promise<Job | null> {
  if (!isDbConfigured()) {
    return null;
  }
  return await getJobFromDb(jobId);
}

// Update job fields
export async function updateJobFields(
  jobId: string,
  fields: Record<string, string | number | null>
): Promise<Job | null> {
  if (!isDbConfigured()) return null;
  return await updateJobFieldsInDb(jobId, fields);
}

// Update job assets
export async function updateJobAssets(
  jobId: string,
  assets: Record<string, string | null>
): Promise<Job | null> {
  if (!isDbConfigured()) return null;
  return await updateJobAssetsInDb(jobId, assets);
}

// Update job initial message
export async function updateJobInitialMessage(
  jobId: string,
  initialMessage: string
): Promise<Job | null> {
  if (!isDbConfigured()) return null;
  return await updateJobInitialMessageInDb(jobId, initialMessage);
}

// Mark job as rendered
export async function markJobRendered(jobId: string): Promise<Job | null> {
  if (!isDbConfigured()) return null;
  return await markJobRenderedInDb(jobId);
}

// Save uploaded file to job storage
export async function saveUploadedFile(
  jobId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const storagePath = getJobFilePath(jobId, filename);
  await uploadFile(BUCKETS.JOBS, storagePath, buffer, {
    upsert: true,
  });
  return storagePath;
}

// Save asset file to job assets storage
export async function saveAssetFile(
  jobId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const storagePath = getJobAssetPath(jobId, filename);
  await uploadFile(BUCKETS.JOBS, storagePath, buffer, {
    upsert: true,
  });
  return storagePath;
}

// Get uploaded file from job storage
export async function getUploadedFile(
  jobId: string,
  filename: string
): Promise<Buffer | null> {
  try {
    return await downloadFile(BUCKETS.JOBS, getJobFilePath(jobId, filename));
  } catch {
    return null;
  }
}

// Get asset file from job storage
export async function getAssetFile(
  jobId: string,
  filename: string
): Promise<Buffer | null> {
  try {
    return await downloadFile(BUCKETS.JOBS, getJobAssetPath(jobId, filename));
  } catch {
    return null;
  }
}

// Delete uploaded file from job storage
export async function deleteUploadedFile(
  jobId: string,
  filename: string
): Promise<void> {
  await deleteFile(BUCKETS.JOBS, getJobFilePath(jobId, filename));
}

// Copy template.tsx from template folder to job storage
export async function copyTemplateToJob(
  templateId: string,
  jobId: string
): Promise<void> {
  const sourcePath = getTemplateTsxPath(templateId);

  if (await pathExists(sourcePath)) {
    const content = await fs.readFile(sourcePath, "utf-8");
    await uploadFile(BUCKETS.JOBS, getJobFilePath(jobId, "template.tsx"), content, {
      contentType: "text/plain",
      upsert: true,
    });
  }
}

// Get job template content (from job storage)
export async function getJobTemplateContent(jobId: string): Promise<string | null> {
  try {
    const buffer = await downloadFile(BUCKETS.JOBS, getJobFilePath(jobId, "template.tsx"));
    return buffer.toString("utf-8");
  } catch {
    return null;
  }
}

// Update job template content
export async function updateJobTemplateContent(
  jobId: string,
  content: string
): Promise<void> {
  await uploadFile(BUCKETS.JOBS, getJobFilePath(jobId, "template.tsx"), content, {
    contentType: "text/plain",
    upsert: true,
  });
}

// Get job SVG template content (from job storage)
export async function getJobSvgContent(jobId: string): Promise<string | null> {
  try {
    const path = getJobFilePath(jobId, "template.svg");
    console.log(`[getJobSvgContent] Loading SVG for job ${jobId} from ${path}`);
    const buffer = await downloadFile(BUCKETS.JOBS, path);
    console.log(`[getJobSvgContent] Loaded SVG (${buffer.length} bytes)`);
    return buffer.toString("utf-8");
  } catch (error) {
    console.log(`[getJobSvgContent] No SVG found for job ${jobId}:`, error);
    return null;
  }
}

// Update job SVG template content
export async function updateJobSvgContent(
  jobId: string,
  content: string
): Promise<void> {
  const path = getJobFilePath(jobId, "template.svg");
  console.log(`[updateJobSvgContent] Saving SVG for job ${jobId} to ${path} (${content.length} chars)`);
  await uploadFile(BUCKETS.JOBS, path, content, {
    contentType: "image/svg+xml",
    upsert: true,
  });
  console.log(`[updateJobSvgContent] SVG saved successfully`);
}

// Copy template.svg from template folder to job storage
export async function copySvgTemplateToJob(
  templateId: string,
  jobId: string
): Promise<void> {
  const sourcePath = getTemplateSvgPath(templateId);

  if (await pathExists(sourcePath)) {
    const content = await fs.readFile(sourcePath, "utf-8");
    await uploadFile(BUCKETS.JOBS, getJobFilePath(jobId, "template.svg"), content, {
      contentType: "image/svg+xml",
      upsert: true,
    });
  }
}

// Add history entry to job with optional preview snapshot
export async function addJobHistoryEntry(
  jobId: string,
  description: string,
  svgContent?: string,
  previewBase64?: string
): Promise<JobHistoryEntry | null> {
  if (!isDbConfigured()) return null;
  await addJobHistoryEntryInDb(jobId, description, svgContent, previewBase64);
  // Return a placeholder - the actual entry is created in the DB
  const job = await getJob(jobId);
  return job?.history?.[job.history.length - 1] || null;
}

// Restore job from history entry (including SVG content)
export async function restoreJobFromHistory(
  jobId: string,
  historyId: string
): Promise<Job | null> {
  if (!isDbConfigured()) return null;

  const result = await restoreJobFromHistoryInDb(jobId, historyId);
  if (!result) return null;

  // Restore SVG content to storage if it was captured
  if (result.svgContent) {
    await updateJobSvgContent(jobId, result.svgContent);
    console.log(`[restoreJobFromHistory] Restored SVG content for job ${jobId}`);
  }

  return result.job;
}

// Add uploaded file to job
export async function addUploadedFileToJob(
  jobId: string,
  file: UploadedFile
): Promise<Job | null> {
  if (!isDbConfigured()) return null;
  await addUploadedFileToJobInDb(jobId, file);
  return await getJob(jobId);
}

// Remove uploaded file from job
export async function removeUploadedFileFromJob(
  jobId: string,
  filename: string
): Promise<Job | null> {
  if (!isDbConfigured()) return null;
  const job = await getJob(jobId);
  if (!job) return null;

  const uploadedFiles = (job.uploadedFiles || []).filter(
    (f) => f.filename !== filename
  );

  // Use raw Supabase update for this
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
  await supabase
    .from("jobs")
    .update({ uploaded_files: uploadedFiles })
    .eq("id", jobId);

  return await getJob(jobId);
}

// Update agent history for a job (full thread history)
export async function updateAgentHistory(
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[]
): Promise<Job | null> {
  if (!isDbConfigured()) return null;
  await updateAgentHistoryInDb(jobId, history);
  return await getJob(jobId);
}

// Get agent history for a job
export async function getAgentHistory(
  jobId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const job = await getJob(jobId);
  return job?.agentHistory || [];
}

// Update container ID for a job (for container reuse across turns)
export async function updateContainerId(
  jobId: string,
  containerId: string | null
): Promise<void> {
  if (!isDbConfigured()) return;
  await updateContainerIdInDb(jobId, containerId);
}

// Save output PDF to job storage
export async function saveJobOutputPdf(
  jobId: string,
  pdfBuffer: Buffer
): Promise<string> {
  const storagePath = getJobFilePath(jobId, "output.pdf");
  await uploadFile(BUCKETS.JOBS, storagePath, pdfBuffer, {
    contentType: "application/pdf",
    upsert: true,
  });
  return storagePath;
}

// Get output PDF from job storage
export async function getJobOutputPdf(jobId: string): Promise<Buffer | null> {
  try {
    return await downloadFile(BUCKETS.JOBS, getJobFilePath(jobId, "output.pdf"));
  } catch {
    return null;
  }
}

// Save output SVG to job storage
export async function saveJobOutputSvg(
  jobId: string,
  svgContent: string
): Promise<string> {
  const storagePath = getJobFilePath(jobId, "output.svg");
  await uploadFile(BUCKETS.JOBS, storagePath, svgContent, {
    contentType: "image/svg+xml",
    upsert: true,
  });
  return storagePath;
}

// Get output SVG from job storage
export async function getJobOutputSvg(jobId: string): Promise<string | null> {
  try {
    const buffer = await downloadFile(BUCKETS.JOBS, getJobFilePath(jobId, "output.svg"));
    return buffer.toString("utf-8");
  } catch {
    return null;
  }
}

// ============================================================================
// Asset Bank Operations (Supabase Storage)
// ============================================================================

// List all assets in asset bank
export async function listAssetBankFiles(): Promise<string[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  try {
    return await listFiles(BUCKETS.ASSETS);
  } catch {
    return [];
  }
}

// Get asset from asset bank
export async function getAssetBankFile(filename: string): Promise<Buffer | null> {
  try {
    return await downloadFile(BUCKETS.ASSETS, filename);
  } catch {
    return null;
  }
}

// Upload asset to asset bank
export async function uploadAssetBankFile(
  filename: string,
  buffer: Buffer,
  contentType?: string
): Promise<string> {
  await uploadFile(BUCKETS.ASSETS, filename, buffer, {
    contentType,
    upsert: true,
  });
  return filename;
}

// Delete asset from asset bank
export async function deleteAssetBankFile(filename: string): Promise<void> {
  await deleteFile(BUCKETS.ASSETS, filename);
}

// Check if asset exists in asset bank
export async function assetBankFileExists(filename: string): Promise<boolean> {
  return await fileExists(BUCKETS.ASSETS, filename);
}
