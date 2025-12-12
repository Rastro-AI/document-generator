// Template types

// Field value can be primitive, array, or nested object
export type FieldValue = string | number | boolean | null | FieldValue[] | { [key: string]: FieldValue };

// Alias for fields record used throughout the app
export type FieldsRecord = Record<string, FieldValue>;

export interface TemplateField {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  example?: FieldValue;
  // Whether this field is optional (won't show error if missing)
  optional?: boolean;
  // Default value to use when field is not provided
  default?: FieldValue;
  // For arrays: describes the item structure
  items?: {
    type: "string" | "number" | "object";
    properties?: Record<string, { type: string; description?: string }>;
  };
  // For objects: describes the nested structure
  properties?: Record<string, { type: string; description?: string; example?: FieldValue }>;
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
  // Template format: "tsx" (React-PDF) or "svg" (raw SVG with placeholders)
  format?: "tsx" | "svg";
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: Record<string, any>;
  assets: Record<string, string | null>;
  timestamp: string;
  description: string;
  // Optional cached preview for instant viewing (base64 PNG thumbnail)
  previewBase64?: string;
  // Optional SVG content snapshot
  svgContent?: string;
}

// Job types
export interface Job {
  id: string;
  templateId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: Record<string, any>;
  assets: Record<string, string | null>;
  createdAt: string;
  renderedAt?: string;
  initialMessage?: string;
  uploadedFiles?: UploadedFile[];
  history?: JobHistoryEntry[];
  // Full agent thread history - preserves all tool calls, results, and messages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentHistory?: any[];
  // OpenAI container ID for code interpreter (reused across conversation turns)
  containerId?: string;
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
