// Template types
export interface TemplateField {
  name: string;
  type: "string" | "string[]" | "number";
  description: string;
  example?: string | string[];
}

export interface TemplateAssetSlot {
  name: string;
  kind: "photo" | "graph" | "logo";
  description: string;
}

export interface TemplateCanvas {
  width: number;
  height: number;
}

export interface TemplateFont {
  family: string;
  weights: Record<string, string | null>;
}

export interface Template {
  id: string;
  name: string;
  version?: number;
  canvas: TemplateCanvas;
  fonts: TemplateFont[];
  fields: TemplateField[];
  assetSlots: TemplateAssetSlot[];
}

export interface TemplateListItem {
  id: string;
  name: string;
}

// Uploaded file info
export interface UploadedFile {
  filename: string;
  path: string;
  type: "document" | "image";
  uploadedAt: string;
}

// History entry for versioning
export interface JobHistoryEntry {
  id: string;
  fields: Record<string, string | number | null>;
  assets: Record<string, string | null>;
  timestamp: string;
  description: string;
}

// Job types
export interface Job {
  id: string;
  templateId: string;
  fields: Record<string, string | number | null>;
  assets: Record<string, string | null>;
  createdAt: string;
  renderedAt?: string;
  initialMessage?: string;
  uploadedFiles?: UploadedFile[];
  history?: JobHistoryEntry[];
  // Full agent thread history - preserves all tool calls, results, and messages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentHistory?: any[];
}

// API response types
export interface ApiError {
  error: string;
  details?: string;
}

export interface CreateJobResponse {
  jobId: string;
}

export interface RenderResponse {
  ok: boolean;
  renderedAt: string;
}
