import path from "path";

// Base directories
export const ROOT_DIR = process.cwd();
export const TEMPLATES_DIR = path.join(ROOT_DIR, "templates");
export const JOBS_DIR = path.join(ROOT_DIR, "jobs");
export const ASSETS_DIR = path.join(ROOT_DIR, "assets");

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

// Form-based template paths (PDF form filling approach)
export function getTemplateSchemaPath(templateId: string): string {
  return path.join(getTemplateDir(templateId), "schema.json");
}

export function getTemplateBasePdfPath(templateId: string): string {
  return path.join(getTemplateDir(templateId), "base.pdf");
}

export function getTemplateOriginalPdfPath(templateId: string): string {
  return path.join(getTemplateDir(templateId), "original.pdf");
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
