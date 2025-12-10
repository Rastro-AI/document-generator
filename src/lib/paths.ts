import path from "path";
import fs from "fs";

// Detect if running on Vercel (read-only filesystem except /tmp)
const isVercel = !!process.env.VERCEL;

// Base directories - use /tmp on Vercel for writable data
export const ROOT_DIR = process.cwd();

// Templates are read-only (bundled with the app), so they stay in ROOT_DIR
export const TEMPLATES_DIR = path.join(ROOT_DIR, "templates");

// Jobs and assets need to be writable, so use /tmp on Vercel
export const DATA_DIR = isVercel ? "/tmp" : ROOT_DIR;
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const ASSETS_DIR = path.join(DATA_DIR, "assets");

// Asset bank (shared assets for reuse across jobs) - also writable
// Note: On Vercel, uploaded assets will be ephemeral (lost on cold start)
export const ASSET_BANK_DIR = path.join(DATA_DIR, "data", "assets");

// Ensure a directory exists (creates it if needed)
export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Ensure base directories exist on first access
let dirsInitialized = false;
export function ensureBaseDirs(): void {
  if (dirsInitialized) return;
  ensureDir(JOBS_DIR);
  ensureDir(ASSETS_DIR);
  ensureDir(ASSET_BANK_DIR);
  // Templates dir should exist in the repo, but ensure it on Vercel for generated templates
  if (isVercel) {
    ensureDir(path.join(DATA_DIR, "templates"));
  }
  dirsInitialized = true;
}

// Template paths
export function getTemplateDir(templateId: string): string {
  return path.join(TEMPLATES_DIR, templateId);
}

export function getTemplateRoot(templateId: string): string {
  return getTemplateDir(templateId);
}

export function getTemplateJsonPath(templateId: string): string {
  return path.join(getTemplateDir(templateId), "template.json");
}

export function getTemplateTsxPath(templateId: string): string {
  return path.join(getTemplateDir(templateId), "template.tsx");
}

export function getTemplateCodePath(templateId: string): string {
  return getTemplateTsxPath(templateId);
}

export function getTemplateThumbnailPath(templateId: string): string {
  return path.join(getTemplateDir(templateId), "thumbnail.png");
}

// Job paths
export function getJobDir(jobId: string): string {
  return path.join(JOBS_DIR, jobId);
}

export function getJobJsonPath(jobId: string): string {
  return path.join(getJobDir(jobId), "job.json");
}

export function getJobInputPath(jobId: string, filename: string): string {
  return path.join(getJobDir(jobId), filename);
}

export function getJobOutputPdfPath(jobId: string): string {
  return path.join(getJobDir(jobId), "output.pdf");
}

export function getJobTemplateTsxPath(jobId: string): string {
  return path.join(getJobDir(jobId), "template.tsx");
}

export function getJobAssetsDir(jobId: string): string {
  return path.join(getJobDir(jobId), "assets");
}

export function getJobAssetPath(jobId: string, filename: string): string {
  return path.join(getJobAssetsDir(jobId), filename);
}
