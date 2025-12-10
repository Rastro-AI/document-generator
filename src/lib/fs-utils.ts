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

// List all templates (from local filesystem)
export async function listTemplates(): Promise<{ id: string; name: string }[]> {
  const entries = await fs.readdir(TEMPLATES_DIR, { withFileTypes: true });
  const templates: { id: string; name: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const jsonPath = getTemplateJsonPath(entry.name);
      if (await pathExists(jsonPath)) {
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
// Job Operations (Supabase Storage)
// ============================================================================

// Helper to get job JSON path in storage
function getJobStoragePath(jobId: string): string {
  return `${jobId}/job.json`;
}

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
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase not configured - cannot create job");
  }

  const jobJson = JSON.stringify(job, null, 2);
  await uploadFile(BUCKETS.JOBS, getJobStoragePath(job.id), jobJson, {
    contentType: "application/json",
  });
}

// Get a job by ID
export async function getJob(jobId: string): Promise<Job | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const buffer = await downloadFile(BUCKETS.JOBS, getJobStoragePath(jobId));
    return JSON.parse(buffer.toString("utf-8")) as Job;
  } catch {
    return null;
  }
}

// Update job (internal helper)
async function updateJob(job: Job): Promise<void> {
  const jobJson = JSON.stringify(job, null, 2);
  await uploadFile(BUCKETS.JOBS, getJobStoragePath(job.id), jobJson, {
    contentType: "application/json",
    upsert: true,
  });
}

// Update job fields
export async function updateJobFields(
  jobId: string,
  fields: Record<string, string | number | null>
): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.fields = fields;
  await updateJob(job);
  return job;
}

// Update job assets
export async function updateJobAssets(
  jobId: string,
  assets: Record<string, string | null>
): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.assets = assets;
  await updateJob(job);
  return job;
}

// Mark job as rendered
export async function markJobRendered(jobId: string): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.renderedAt = new Date().toISOString();
  await updateJob(job);
  return job;
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
    const buffer = await downloadFile(BUCKETS.JOBS, getJobFilePath(jobId, "template.svg"));
    return buffer.toString("utf-8");
  } catch {
    return null;
  }
}

// Update job SVG template content
export async function updateJobSvgContent(
  jobId: string,
  content: string
): Promise<void> {
  await uploadFile(BUCKETS.JOBS, getJobFilePath(jobId, "template.svg"), content, {
    contentType: "image/svg+xml",
    upsert: true,
  });
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
    });
  }
}

// Add history entry to job
export async function addJobHistoryEntry(
  jobId: string,
  description: string
): Promise<JobHistoryEntry | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  const entry: JobHistoryEntry = {
    id: uuidv4(),
    fields: { ...job.fields },
    assets: { ...job.assets },
    timestamp: new Date().toISOString(),
    description,
  };

  job.history = job.history || [];
  job.history.push(entry);

  await updateJob(job);
  return entry;
}

// Restore job from history entry
export async function restoreJobFromHistory(
  jobId: string,
  historyId: string
): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job || !job.history) return null;

  const entry = job.history.find((h) => h.id === historyId);
  if (!entry) return null;

  // Save current state to history before restoring
  await addJobHistoryEntry(jobId, "Before restore");

  // Restore fields and assets
  job.fields = { ...entry.fields };
  job.assets = { ...entry.assets };

  await updateJob(job);
  return job;
}

// Add uploaded file to job
export async function addUploadedFileToJob(
  jobId: string,
  file: UploadedFile
): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.uploadedFiles = job.uploadedFiles || [];
  job.uploadedFiles.push(file);

  await updateJob(job);
  return job;
}

// Remove uploaded file from job
export async function removeUploadedFileFromJob(
  jobId: string,
  filename: string
): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.uploadedFiles = (job.uploadedFiles || []).filter(
    (f) => f.filename !== filename
  );

  await updateJob(job);
  return job;
}

// Update agent history for a job (full thread history)
export async function updateAgentHistory(
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[]
): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.agentHistory = history;

  await updateJob(job);
  return job;
}

// Get agent history for a job
export async function getAgentHistory(
  jobId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const job = await getJob(jobId);
  return job?.agentHistory || [];
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
