// Template types

// Field value can be primitive, array, or nested object
export type FieldValue = string | number | boolean | null | FieldValue[] | { [key: string]: FieldValue };

// ===========================================
// Form-based Template Types (PDF form filling)
// ===========================================

export interface FormFieldBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FormTextStyle {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  color?: string;
  alignment?: "left" | "center" | "right";
  lineHeight?: number;
}

export interface FormTextField {
  name: string;
  type: "text";
  bbox: FormFieldBbox;
  style?: FormTextStyle;
}

export interface FormImageField {
  name: string;
  type: "image";
  bbox: FormFieldBbox;
  objectFit?: "contain" | "cover" | "fill";
}

export type FormField = FormTextField | FormImageField;

export interface FormPageSchema {
  pageNumber: number;
  fields: FormField[];
}

export interface FormFontDefinition {
  name: string;
  regular?: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

export interface FormTemplateSchema {
  version: number;
  pages: FormPageSchema[];
  fonts?: FormFontDefinition[];
}

export interface BlankRegion {
  pageNumber: number;
  bbox: FormFieldBbox;
}

// ===========================================
// Original Template Types
// ===========================================

// Alias for fields record used throughout the app
export type FieldsRecord = Record<string, FieldValue>;

export interface TemplateField {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  example?: FieldValue;
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
