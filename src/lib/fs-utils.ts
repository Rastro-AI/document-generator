import fs from "fs/promises";
import path from "path";
import { Template, Job, JobHistoryEntry, UploadedFile } from "./types";
import { v4 as uuidv4 } from "uuid";
import {
  TEMPLATES_DIR,
  getTemplateJsonPath,
  getTemplateTsxPath,
  getJobDir,
  getJobJsonPath,
  getJobTemplateTsxPath,
  getJobAssetsDir,
} from "./paths";

// Check if a path exists
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// List all templates
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

// Get a template by ID
export async function getTemplate(templateId: string): Promise<Template | null> {
  const jsonPath = getTemplateJsonPath(templateId);
  if (!(await pathExists(jsonPath))) {
    return null;
  }
  const content = await fs.readFile(jsonPath, "utf-8");
  return JSON.parse(content) as Template;
}

// Create a new job directory and save job.json
export async function createJob(job: Job): Promise<void> {
  const jobDir = getJobDir(job.id);
  await fs.mkdir(jobDir, { recursive: true });
  await fs.writeFile(getJobJsonPath(job.id), JSON.stringify(job, null, 2));
}

// Get a job by ID
export async function getJob(jobId: string): Promise<Job | null> {
  const jsonPath = getJobJsonPath(jobId);
  if (!(await pathExists(jsonPath))) {
    return null;
  }
  const content = await fs.readFile(jsonPath, "utf-8");
  return JSON.parse(content) as Job;
}

// Update job fields
export async function updateJobFields(
  jobId: string,
  fields: Record<string, string | number | null>
): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.fields = fields;
  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
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
  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
  return job;
}

// Mark job as rendered
export async function markJobRendered(jobId: string): Promise<Job | null> {
  const job = await getJob(jobId);
  if (!job) return null;

  job.renderedAt = new Date().toISOString();
  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
  return job;
}

// Save uploaded file to job directory
export async function saveUploadedFile(
  jobId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const jobDir = getJobDir(jobId);
  await fs.mkdir(jobDir, { recursive: true });
  const filePath = path.join(jobDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

// Save asset file to job assets directory
export async function saveAssetFile(
  jobId: string,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const assetsDir = getJobAssetsDir(jobId);
  await fs.mkdir(assetsDir, { recursive: true });
  const filePath = path.join(assetsDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

// Copy template.tsx from template folder to job folder
export async function copyTemplateToJob(
  templateId: string,
  jobId: string
): Promise<void> {
  const sourcePath = getTemplateTsxPath(templateId);
  const destPath = getJobTemplateTsxPath(jobId);

  if (await pathExists(sourcePath)) {
    const content = await fs.readFile(sourcePath, "utf-8");
    await fs.writeFile(destPath, content);
  }
}

// Get job template content (from job folder)
export async function getJobTemplateContent(jobId: string): Promise<string | null> {
  const templatePath = getJobTemplateTsxPath(jobId);
  if (!(await pathExists(templatePath))) {
    return null;
  }
  return await fs.readFile(templatePath, "utf-8");
}

// Update job template content
export async function updateJobTemplateContent(
  jobId: string,
  content: string
): Promise<void> {
  const templatePath = getJobTemplateTsxPath(jobId);
  await fs.writeFile(templatePath, content);
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

  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
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

  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
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

  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
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

  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
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

  await fs.writeFile(getJobJsonPath(jobId), JSON.stringify(job, null, 2));
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
