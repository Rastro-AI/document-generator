"use client";

import { useState, useEffect, useRef } from "react";
import { Template } from "@/lib/types";

// Default template code - defined outside component for stable reference
const DEFAULT_TEMPLATE_CODE = `// Template for @react-pdf/renderer
import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
});

export function render(
  fields: Record<string, string | number | null>,
  assets: Record<string, string | null>,
  templateRoot: string
): React.ReactElement {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{fields.TITLE}</Text>
      </Page>
    </Document>
  );
}
`;

interface TemplateJsonField {
  name: string;
  type: string;
  description: string;
  example?: unknown;
  items?: { type: string; properties?: Record<string, { type: string; description?: string }> };
  properties?: Record<string, { type: string; description?: string }>;
}

interface FormTemplateSchema {
  version: number;
  pages: Array<{
    pageNumber: number;
    fields: Array<{
      name: string;
      type: "text" | "image";
      bbox: { x: number; y: number; width: number; height: number };
      style?: { fontFamily?: string; fontWeight?: number; fontSize?: number; color?: string; alignment?: string };
      objectFit?: string;
    }>;
  }>;
  fonts?: Array<{ name: string; regular?: string; bold?: string }>;
}

interface GeneratorTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status" | "version" | "template_json" | "schema_updated" | "user_feedback";
  content: string;
  toolName?: string;
  version?: number;
  previewUrl?: string;
  pdfUrl?: string;
  schema?: FormTemplateSchema;
  templateJson?: {
    id: string;
    name: string;
    canvas: { width: number; height: number };
    fields: TemplateJsonField[];
    assetSlots: Array<{ name: string; kind: string; description: string }>;
  };
}

/**
 * Generate placeholder value for a field based on its type
 * For previews, we want to show meaningful placeholders that work with .map(), etc.
 */
function generatePlaceholderValue(field: TemplateJsonField): unknown {
  const placeholder = `{{${field.name}}}`;

  switch (field.type) {
    case "array":
      // Generate array with placeholder items
      if (field.items?.type === "object" && field.items.properties) {
        // Array of objects - generate 2 sample items with placeholder properties
        const sampleObject: Record<string, string> = {};
        for (const [key] of Object.entries(field.items.properties)) {
          sampleObject[key] = `{{${field.name}[].${key}}}`;
        }
        return [sampleObject, sampleObject];
      } else {
        // Array of primitives
        return [`{{${field.name}[0]}}`, `{{${field.name}[1]}}`];
      }

    case "object":
      // Generate object with placeholder properties
      if (field.properties) {
        const sampleObject: Record<string, unknown> = {};
        for (const [key, prop] of Object.entries(field.properties)) {
          if (prop.type === "array") {
            sampleObject[key] = [`{{${field.name}.${key}[0]}}`, `{{${field.name}.${key}[1]}}`];
          } else {
            sampleObject[key] = `{{${field.name}.${key}}}`;
          }
        }
        return sampleObject;
      }
      return { value: placeholder };

    case "number":
      return placeholder;

    case "boolean":
      return true; // Show truthy state for preview

    case "string":
    default:
      return placeholder;
  }
}

interface TemplateEditorModalProps {
  template: Template | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: Template, code?: string) => Promise<void>;
  isCreating?: boolean;
}

export function TemplateEditorModal({
  template,
  isOpen,
  onClose,
  onSave,
  isCreating = false,
}: TemplateEditorModalProps) {
  const [activeTab, setActiveTab] = useState<"json" | "code" | "preview">("code");
  const [previewKey, setPreviewKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [code, setCode] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Generation state
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [generationTraces, setGenerationTraces] = useState<GeneratorTrace[]>([]);
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [generationComplete, setGenerationComplete] = useState(false);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [userPrompt, setUserPrompt] = useState("");
  const [versions, setVersions] = useState<Array<{ version: number; previewBase64: string; pdfBase64?: string; schema?: FormTemplateSchema }>>([]);
  const [currentSchema, setCurrentSchema] = useState<FormTemplateSchema | null>(null);
  const [basePdfBase64, setBasePdfBase64] = useState<string | null>(null);
  const [originalPdfBase64, setOriginalPdfBase64] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);

  const [feedbackInput, setFeedbackInput] = useState("");
  const [isRefining, setIsRefining] = useState(false);
  const [expandedTraces, setExpandedTraces] = useState<Set<number>>(new Set());
  const [isEditingPdf, setIsEditingPdf] = useState(false); // True when editing existing template's PDF
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const EXPECTED_DURATION = 10 * 60; // 10 minutes in seconds

  const toggleTraceExpanded = (idx: number) => {
    setExpandedTraces((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setActiveTab("code");
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
      if (generatedPreviewUrl) {
        URL.revokeObjectURL(generatedPreviewUrl);
      }
      setSelectedPdf(null);
      setPdfPreviewUrl(null);
      setIsGenerating(false);
      setGenerationStatus(null);
      setGenerationTraces([]);
      setGeneratedPreviewUrl(null);
      setGenerationComplete(false);
      setGenerationStartTime(null);
      setElapsedTime(0);
      setUserPrompt("");
      setVersions([]);
      setSelectedVersion(0);
      setFeedbackInput("");
      setIsRefining(false);
      setExpandedTraces(new Set());
      setCurrentSchema(null);
      setBasePdfBase64(null);
      setOriginalPdfBase64(null);
      setIsEditingPdf(false);
    }
  }, [isOpen, isCreating]);

  // Auto-load preview when generation completes
  useEffect(() => {
    if (generationComplete && code && jsonText && !generatedPreviewUrl && !isRenderingPreview) {
      renderGeneratedPreview();
    }
  }, [generationComplete, code, jsonText]);

  // Timer effect for progress tracking
  useEffect(() => {
    if (isGenerating && generationStartTime) {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - generationStartTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [isGenerating, generationStartTime]);

  // Render preview of generated template
  const renderGeneratedPreview = async () => {
    if (!code || !jsonText) return;

    setIsRenderingPreview(true);
    try {
      const templateData = JSON.parse(jsonText);
      // Generate type-appropriate placeholders for previews
      const sampleFields: Record<string, unknown> = {};
      for (const field of templateData.fields || []) {
        sampleFields[field.name] = generatePlaceholderValue(field);
      }

      const response = await fetch("/api/templates/preview-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, fields: sampleFields }),
      });

      if (response.ok) {
        const blob = await response.blob();
        if (generatedPreviewUrl) {
          URL.revokeObjectURL(generatedPreviewUrl);
        }
        setGeneratedPreviewUrl(URL.createObjectURL(blob));
      }
    } catch (error) {
      console.error("Failed to render preview:", error);
    } finally {
      setIsRenderingPreview(false);
    }
  };

  // Load template data
  useEffect(() => {
    if (template) {
      setJsonText(JSON.stringify(template, null, 2));
      setJsonError(null);
    } else if (isCreating) {
      const defaultTemplate = {
        id: "new-template",
        name: "New Template",
        canvas: { width: 612, height: 792 },
        fonts: [],
        fields: [
          { name: "TITLE", type: "string", description: "Main title" },
        ],
        assetSlots: [],
      };
      setJsonText(JSON.stringify(defaultTemplate, null, 2));
      setCode(DEFAULT_TEMPLATE_CODE);
      setJsonError(null);
    }
  }, [template, isCreating]);

  // Fetch template code when editing existing template
  useEffect(() => {
    if (template && isOpen) {
      fetch(`/api/templates/${template.id}/code`)
        .then((res) => res.ok ? res.text() : "")
        .then(setCode)
        .catch(() => setCode(""));
    }
  }, [template, isOpen]);

  if (!isOpen) return null;

  const handleJsonChange = (value: string) => {
    setJsonText(value);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON");
    }
  };

  const handleSave = async () => {
    if (jsonError) return;

    setIsSaving(true);
    try {
      const parsedTemplate: Template = JSON.parse(jsonText);

      // For form-fill templates, pass schema and basePdf data
      if (currentSchema && basePdfBase64) {
        // Extended save with schema data
        const saveData = {
          ...parsedTemplate,
          schema: currentSchema,
          basePdfBase64,
          originalPdfBase64,
        };
        await onSave(saveData as Template, undefined);
      } else {
        // Legacy save
        await onSave(parsedTemplate, code || undefined);
      }
      onClose();
    } catch (error) {
      console.error("Failed to save template:", error);
      setJsonError("Failed to parse JSON");
    } finally {
      setIsSaving(false);
    }
  };

  const handlePdfSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === "application/pdf") {
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl);
      }
      setSelectedPdf(file);
      setPdfPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleClearPdf = () => {
    if (pdfPreviewUrl) {
      URL.revokeObjectURL(pdfPreviewUrl);
    }
    setSelectedPdf(null);
    setPdfPreviewUrl(null);
    setGenerationComplete(false);
    setGeneratedPreviewUrl(null);
  };

  const handleFieldUpdate = (fieldName: string, key: "description" | "example", value: string) => {
    try {
      const parsed = JSON.parse(jsonText);
      const fieldIndex = parsed.fields?.findIndex((f: { name: string }) => f.name === fieldName);
      if (fieldIndex !== undefined && fieldIndex >= 0) {
        parsed.fields[fieldIndex][key] = value;
        setJsonText(JSON.stringify(parsed, null, 2));
      }
    } catch {
      // Ignore JSON errors
    }
  };

  const handleSendFeedback = async () => {
    if (!feedbackInput.trim() || isRefining || !selectedPdf) return;

    const feedbackText = feedbackInput.trim();
    setFeedbackInput("");
    setIsRefining(true);
    setIsGenerating(true);
    setGenerationComplete(false);
    // Keep current version selected - don't switch to Input tab

    // Add user feedback to traces so it shows in the chat
    setGenerationTraces((prev) => [
      ...prev,
      { type: "user_feedback", content: feedbackText },
    ]);

    try {
      // Cancel any existing generation
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      // Send feedback with current state to continue generation
      const formData = new FormData();
      formData.append("pdf", selectedPdf);
      formData.append("reasoning", "low");
      formData.append("feedback", feedbackText);
      // Pass current schema for continuation
      if (currentSchema) {
        formData.append("currentSchema", JSON.stringify(currentSchema));
      }
      // Pass max version number so new versions continue numbering correctly
      const maxVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0;
      formData.append("startVersion", String(maxVersion));
      // CRITICAL: Pass the current base PDF (with all previous edits) so we don't lose progress
      if (basePdfBase64) {
        formData.append("currentBasePdf", basePdfBase64);
      }

      const response = await fetch("/api/templates/generate", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Feedback request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (currentEventType === "trace") {
                if (parsed.type === "status") {
                  setGenerationStatus(parsed.content);
                }
                if (parsed.type === "version") {
                  if (parsed.version && parsed.previewUrl) {
                    setVersions((prev) => [
                      ...prev,
                      { version: parsed.version, previewBase64: parsed.previewUrl, pdfBase64: parsed.pdfUrl, schema: parsed.schema },
                    ]);
                    setSelectedVersion(parsed.version);
                    // Update schema state with latest version's schema
                    if (parsed.schema) {
                      setCurrentSchema(parsed.schema);
                    }
                  }
                }
                if (parsed.type === "schema_updated" && parsed.schema) {
                  setCurrentSchema(parsed.schema);
                }
                if (parsed.type === "template_json" && parsed.templateJson) {
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                }
                setGenerationTraces((prev) => [...prev, parsed]);
              } else if (currentEventType === "result") {
                if (parsed.success && parsed.schema) {
                  setCurrentSchema(parsed.schema);
                  if (parsed.basePdfBase64) {
                    setBasePdfBase64(parsed.basePdfBase64);
                  }
                  if (parsed.templateJson) {
                    setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                  }
                  setGenerationStatus("Feedback applied successfully!");
                  setGenerationComplete(true);
                } else {
                  setGenerationStatus(`Failed: ${parsed.message}`);
                }
              } else if (currentEventType === "error") {
                setGenerationStatus(`Error: ${parsed.error}`);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      // Don't show error if it was cancelled
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setGenerationStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsGenerating(false);
      setIsRefining(false);
      abortControllerRef.current = null;
    }
  };

  const cancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setIsRefining(false);
    setGenerationStatus("Generation cancelled");
  };

  const handleGenerate = async () => {
    if (!selectedPdf) return;

    // Cancel any existing generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsGenerating(true);
    setGenerationStartTime(Date.now());
    setElapsedTime(0);
    setGenerationStatus("Starting generation...");
    setGenerationTraces([]);
    setVersions([]);
    setSelectedVersion(0);

    try {
      const formData = new FormData();
      formData.append("pdf", selectedPdf);
      if (userPrompt.trim()) {
        formData.append("prompt", userPrompt.trim());
      }
      formData.append("reasoning", "low"); // Enable reasoning for better quality

      const response = await fetch("/api/templates/generate", {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error("Generation request failed");
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let currentEventType = ""; // Persist across chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (currentEventType === "trace") {
                if (parsed.type === "status") {
                  setGenerationStatus(parsed.content);
                }
                if (parsed.type === "version") {
                  if (parsed.version && parsed.previewUrl) {
                    setVersions((prev) => [
                      ...prev,
                      { version: parsed.version, previewBase64: parsed.previewUrl, pdfBase64: parsed.pdfUrl, schema: parsed.schema },
                    ]);
                    setSelectedVersion(parsed.version);
                    // Update schema state with latest version's schema
                    if (parsed.schema) {
                      setCurrentSchema(parsed.schema);
                    }
                  }
                }
                // Handle schema_updated event
                if (parsed.type === "schema_updated" && parsed.schema) {
                  setCurrentSchema(parsed.schema);
                }
                // Handle template_json event - update fields in real-time (legacy compat)
                if (parsed.type === "template_json" && parsed.templateJson) {
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                }
                setGenerationTraces((prev) => [...prev, parsed]);
              } else if (currentEventType === "result") {
                if (parsed.success && parsed.schema) {
                  // New schema-based result
                  setCurrentSchema(parsed.schema);
                  if (parsed.basePdfBase64) {
                    setBasePdfBase64(parsed.basePdfBase64);
                  }
                  if (parsed.originalPdfBase64) {
                    setOriginalPdfBase64(parsed.originalPdfBase64);
                  }
                  if (parsed.templateJson) {
                    setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                  }
                  setGenerationStatus("Template generated successfully!");
                  setGenerationComplete(true);
                } else if (parsed.success && parsed.templateJson) {
                  // Legacy result handling
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                  setGenerationStatus("Template generated successfully!");
                  setGenerationComplete(true);
                } else {
                  setGenerationStatus(`Generation failed: ${parsed.message}`);
                }
              } else if (currentEventType === "error") {
                setGenerationStatus(`Error: ${parsed.error}`);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      // Don't show error if it was cancelled
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      setGenerationStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  // Get parsed template for field display
  let parsedTemplate: Template | null = null;
  try {
    parsedTemplate = JSON.parse(jsonText);
  } catch {
    // Invalid JSON
  }

  // Format time as mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Calculate progress percentage (capped at 95% until complete)
  const progressPercent = Math.min(95, (elapsedTime / EXPECTED_DURATION) * 100);

  // Render content based on creation vs editing mode
  const renderContent = () => {
    // CREATING MODE or EDITING PDF MODE (when clicking "Edit PDF" on existing template)
    if (isCreating || isEditingPdf) {
      // Step 1: No PDF selected - show upload area
      if (!selectedPdf) {
        return (
          <div className="h-[600px] p-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handlePdfSelect}
              className="hidden"
            />
            <div
              onClick={() => fileInputRef.current?.click()}
              className="h-full flex flex-col items-center justify-center border-2 border-dashed border-[#d2d2d7] rounded-xl cursor-pointer hover:border-[#86868b] hover:bg-[#f5f5f7] transition-colors"
            >
              <svg className="w-16 h-16 text-[#86868b] mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">Upload PDF</p>
              <p className="text-[13px] text-[#86868b]">
                Drop a PDF or click to browse
              </p>
              <p className="text-[11px] text-[#86868b] mt-4 max-w-[300px] text-center">
                AI will analyze the PDF and generate a matching template
              </p>
            </div>
          </div>
        );
      }

      // Step 2 & 3: PDF selected - unified two-pane layout
      // Left: Tabs (Source | V1 PDF | V1 Fields | V2 PDF | V2 Fields | ...)
      // Right: Always shows logs/reasoning
      // selectedVersion: 0 = source, integer = PDF view, X.5 = Fields view

      return (
        <div className="h-[600px] flex flex-col">
          <div className="flex-1 flex min-h-0">
            {/* Left: Source PDF + Version tabs (PDF/Fields for each) */}
            <div className="w-1/2 border-r border-[#d2d2d7] flex flex-col">
              {/* Tabs - compact with borders */}
              <div className="flex items-center gap-1.5 border-b border-[#e8e8ed] px-3 py-2">
                {/* Input tab (formerly Source) */}
                <button
                  onClick={() => setSelectedVersion(0)}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap border ${
                    selectedVersion === 0
                      ? "bg-[#1d1d1f] text-white border-[#1d1d1f]"
                      : "text-[#1d1d1f] border-[#d2d2d7] hover:bg-[#f5f5f7]"
                  }`}
                >
                  Input
                </button>

                {/* History dropdown - show if more than 1 version */}
                {versions.length > 1 && (() => {
                  const latestVer = Math.max(...versions.map(v => v.version));
                  // Check if an older version is selected (not latest, not source)
                  const isOlderVersionSelected = selectedVersion !== 0 &&
                    (Number.isInteger(selectedVersion)
                      ? selectedVersion < latestVer
                      : Math.floor(selectedVersion) < latestVer);
                  return (
                    <div className="relative group">
                      <button
                        className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap flex items-center gap-1 border ${
                          isOlderVersionSelected
                            ? "bg-[#1d1d1f] text-white border-[#1d1d1f]"
                            : "text-[#1d1d1f] border-[#d2d2d7] hover:bg-[#f5f5f7]"
                        }`}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        History
                      </button>
                      {/* Dropdown */}
                      <div className="absolute left-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-[#d2d2d7] py-1 min-w-[120px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
                        {versions.slice(0, -1).reverse().map((v) => (
                          <div key={v.version} className="px-1">
                            <button
                              onClick={() => setSelectedVersion(v.version)}
                              className={`w-full text-left px-2 py-1 text-[11px] rounded transition-colors ${
                                selectedVersion === v.version
                                  ? "bg-[#e8e8ed] text-[#1d1d1f]"
                                  : "text-[#6e6e73] hover:bg-[#f5f5f7]"
                              }`}
                            >
                              V{v.version} PDF
                            </button>
                            <button
                              onClick={() => setSelectedVersion(v.version + 0.5)}
                              className={`w-full text-left px-2 py-1 text-[11px] rounded transition-colors ${
                                selectedVersion === v.version + 0.5
                                  ? "bg-[#e8e8ed] text-[#1d1d1f]"
                                  : "text-[#6e6e73] hover:bg-[#f5f5f7]"
                              }`}
                            >
                              V{v.version} Fields
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Current/Latest version tabs - only show if there are versions */}
                {versions.length > 0 && (() => {
                  const latestVersion = versions[versions.length - 1];
                  return (
                    <div className="flex items-center">
                      <button
                        onClick={() => setSelectedVersion(latestVersion.version)}
                        className={`px-3 py-1.5 text-[11px] font-medium rounded-l-md transition-colors whitespace-nowrap border border-r-0 ${
                          selectedVersion === latestVersion.version
                            ? "bg-[#1d1d1f] text-white border-[#1d1d1f]"
                            : "text-[#1d1d1f] border-[#d2d2d7] hover:bg-[#f5f5f7]"
                        }`}
                      >
                        V{latestVersion.version} PDF
                      </button>
                      <button
                        onClick={() => setSelectedVersion(latestVersion.version + 0.5)}
                        className={`px-3 py-1.5 text-[11px] font-medium rounded-r-md transition-colors whitespace-nowrap border ${
                          selectedVersion === latestVersion.version + 0.5
                            ? "bg-[#1d1d1f] text-white border-[#1d1d1f]"
                            : "text-[#1d1d1f] border-[#d2d2d7] hover:bg-[#f5f5f7]"
                        }`}
                      >
                        V{latestVersion.version} Fields
                      </button>
                    </div>
                  );
                })()}
              </div>

              {/* Content */}
              <div className="flex-1 p-4 min-h-0 overflow-y-auto">
                {selectedVersion === 0 ? (
                  /* Source PDF */
                  <div className="h-full rounded-xl overflow-hidden border border-[#d2d2d7]">
                    <iframe
                      src={pdfPreviewUrl!}
                      className="w-full h-full"
                      title="Source PDF"
                    />
                  </div>
                ) : Number.isInteger(selectedVersion) ? (
                  /* Version PDF preview */
                  <div className="h-full rounded-xl overflow-hidden border border-[#d2d2d7] bg-white">
                    {versions.find((v) => v.version === selectedVersion)?.pdfBase64 ? (
                      <iframe
                        src={versions.find((v) => v.version === selectedVersion)!.pdfBase64}
                        className="w-full h-full"
                        title={`Version ${selectedVersion} PDF`}
                      />
                    ) : versions.find((v) => v.version === selectedVersion)?.previewBase64 ? (
                      <img
                        src={versions.find((v) => v.version === selectedVersion)!.previewBase64}
                        alt={`Version ${selectedVersion} preview`}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-[#86868b] text-[13px]">
                        No preview available
                      </div>
                    )}
                  </div>
                ) : (
                  /* Version Fields view (selectedVersion is X.5) */
                  <div className="space-y-4">
                    {/* Assets section */}
                    {parsedTemplate?.assetSlots && parsedTemplate.assetSlots.length > 0 && (
                      <div>
                        <h3 className="text-[13px] font-semibold text-[#1d1d1f] mb-2">
                          Assets
                        </h3>
                        <div className="space-y-2">
                          {parsedTemplate.assetSlots.map((slot) => (
                            <div key={slot.name} className="p-3 border border-[#e8e8ed] rounded-lg">
                              <p className="text-[12px] font-medium text-[#1d1d1f]">{slot.name}</p>
                              <p className="text-[11px] text-[#6e6e73] mt-1">{slot.description}</p>
                              <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-medium text-[#6e6e73] bg-[#f5f5f7] rounded">
                                {slot.kind}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Fields section */}
                    {parsedTemplate?.fields && parsedTemplate.fields.length > 0 && (
                      <div>
                        <h3 className="text-[13px] font-semibold text-[#1d1d1f] mb-2">
                          Fields
                        </h3>
                        <div className="space-y-2">
                          {parsedTemplate.fields.map((field) => (
                            <div key={field.name} className="p-3 border border-[#e8e8ed] rounded-lg">
                              <p className="text-[12px] font-medium text-[#1d1d1f]">{field.name}</p>
                              <p className="text-[11px] text-[#6e6e73] mt-1">{field.description}</p>
                              {field.example !== undefined && (
                                <p className="text-[10px] text-[#86868b] mt-1 italic">e.g. {typeof field.example === 'object' ? JSON.stringify(field.example) : String(field.example)}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {(!parsedTemplate?.fields || parsedTemplate.fields.length === 0) &&
                     (!parsedTemplate?.assetSlots || parsedTemplate.assetSlots.length === 0) && (
                      <p className="text-[12px] text-[#86868b] text-center py-8">No fields or assets extracted</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Always shows logs/reasoning */}
            <div className="w-1/2 flex flex-col">
              <div className="flex-1 flex flex-col p-4 min-h-0">
                {!isGenerating && !generationStatus && !generationComplete ? (
                  /* Ready state */
                  <div className="flex-1 flex flex-col">
                    <div className="flex-1 flex flex-col items-center justify-center text-center">
                      <p className="text-[14px] font-medium text-[#1d1d1f] mb-1">Ready to generate</p>
                      <p className="text-[12px] text-[#86868b]">Click Generate Template to start</p>
                      <p className="text-[11px] text-[#aeaeb2] mt-2">Expected time: ~10 minutes</p>
                    </div>
                    {/* Prompt input at bottom */}
                    <div className="mt-auto pt-3 border-t border-[#e8e8ed]">
                      <textarea
                        value={userPrompt}
                        onChange={(e) => setUserPrompt(e.target.value)}
                        placeholder="Optional: Add instructions (e.g., 'Focus on the header layout'...)"
                        className="w-full px-3 py-2 text-[12px] bg-[#f5f5f7] border-0 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-[#424245]"
                        rows={2}
                      />
                    </div>
                  </div>
                ) : (
                  /* Generation in progress or complete - always show logs */
                  <>
                    {/* Progress bar - always show at top once generation starts */}
                    <div className="mb-3 flex-shrink-0 bg-white p-3 rounded-xl border border-[#e8e8ed]">
                      <div className="flex items-center justify-between text-[11px] text-[#1d1d1f] mb-2">
                        <span className="truncate flex-1 mr-2 font-medium">
                          {generationComplete
                            ? "Complete"
                            : (isGenerating || isRefining)
                              ? (generationStatus || "Processing...")
                              : "Ready"}
                        </span>
                        <span className="flex-shrink-0 text-[#86868b]">{formatTime(elapsedTime)} / ~{formatTime(EXPECTED_DURATION)}</span>
                      </div>
                      <div className="h-2 bg-[#e8e8ed] rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ease-out ${generationComplete ? "bg-green-500" : "bg-[#1d1d1f]"}`}
                          style={{ width: generationComplete ? "100%" : `${progressPercent}%` }}
                        />
                      </div>
                    </div>

                    {/* Generation traces - always visible */}
                    <div className="flex-1 min-h-0 overflow-y-auto border border-[#e8e8ed] rounded-xl bg-white">
                      <div className="p-3 space-y-1">
                        {generationTraces.length === 0 ? (
                          <div className="flex items-center gap-2 text-[12px] text-[#86868b]">
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Initializing...
                          </div>
                        ) : (
                          generationTraces.filter((t) => t.type !== "version").map((trace, idx) => (
                            <div key={idx} className="text-[11px]">
                              {/* User feedback */}
                              {trace.type === "user_feedback" && (
                                <div className="flex items-start gap-2 px-2 py-1.5 bg-[#f5f5f7] rounded-md">
                                  <svg className="w-3.5 h-3.5 flex-shrink-0 text-[#6e6e73] mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                  </svg>
                                  <span className="text-[#1d1d1f]">{trace.content}</span>
                                </div>
                              )}
                              {/* Reasoning - collapsible */}
                              {trace.type === "reasoning" && (
                                <div>
                                  <button
                                    onClick={() => toggleTraceExpanded(idx)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-[#f5f5f7] rounded-md transition-colors"
                                  >
                                    <svg
                                      className={`w-3 h-3 flex-shrink-0 text-[#86868b] transition-transform ${expandedTraces.has(idx) ? "rotate-90" : ""}`}
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                    </svg>
                                    <svg className="w-3.5 h-3.5 flex-shrink-0 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                    </svg>
                                    <span className="text-[#6e6e73]">Reasoning</span>
                                  </button>
                                  {expandedTraces.has(idx) && (
                                    <div className="ml-8 px-2 py-1.5 text-[#6e6e73] text-[10px] whitespace-pre-wrap">
                                      {trace.content}
                                    </div>
                                  )}
                                </div>
                              )}
                              {/* Status */}
                              {trace.type === "status" && (
                                <div className="px-2 py-1 text-[#86868b]">
                                  {trace.content}
                                </div>
                              )}
                              {/* Tool call - collapsible */}
                              {trace.type === "tool_call" && (
                                <div>
                                  <button
                                    onClick={() => toggleTraceExpanded(idx)}
                                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-[#f5f5f7] rounded-md transition-colors"
                                  >
                                    <svg
                                      className={`w-3 h-3 flex-shrink-0 text-[#86868b] transition-transform ${expandedTraces.has(idx) ? "rotate-90" : ""}`}
                                      fill="currentColor"
                                      viewBox="0 0 20 20"
                                    >
                                      <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                    </svg>
                                    <svg className="w-3.5 h-3.5 flex-shrink-0 text-[#34c759]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                    <span className="text-[#1d1d1f] font-mono">{trace.toolName || trace.content}</span>
                                  </button>
                                </div>
                              )}
                              {/* Tool result - only show if parent tool_call is expanded */}
                              {trace.type === "tool_result" && expandedTraces.has(idx - 1) && (
                                <div className="ml-8 px-2 py-1.5 text-[#6e6e73] font-mono text-[10px] whitespace-pre-wrap">
                                  {trace.content}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Success message when complete */}
                    {generationComplete && versions.length > 0 && (
                      <div className="mt-3 px-3 py-2 bg-[#f5f5f7] rounded-lg text-center">
                        <p className="text-[11px] text-[#1d1d1f]">Generation complete</p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Chat input - always visible at bottom during/after generation */}
              {(isGenerating || generationComplete || generationStatus) && (
                <div className="border-t border-[#e8e8ed] p-3 flex-shrink-0">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={feedbackInput}
                      onChange={(e) => setFeedbackInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSendFeedback()}
                      placeholder="Add feedback to guide generation..."
                      className="flex-1 px-3 py-2 text-[12px] bg-[#f5f5f7] border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#424245]"
                      disabled={isRefining}
                    />
                    <button
                      onClick={handleSendFeedback}
                      disabled={!feedbackInput.trim() || isRefining}
                      className="px-3 py-2 text-[11px] font-medium text-white bg-[#1d1d1f] rounded-lg hover:bg-[#424245] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // EDITING MODE - Two-pane layout: Fields on left, Preview on right
    return (
      <div className="h-[550px] flex">
        {/* Left: Editable Fields */}
        <div className="w-1/2 border-r border-[#d2d2d7] flex flex-col">
          <div className="px-4 py-3 border-b border-[#e8e8ed] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Template Fields</h3>
            <button
              onClick={async () => {
                if (!template) return;
                try {
                  // Fetch the base PDF for this template
                  const response = await fetch(`/api/templates/${template.id}/base-pdf`);
                  if (!response.ok) {
                    alert("No base PDF found for this template. It may be a legacy TSX-based template.");
                    return;
                  }
                  const pdfBlob = await response.blob();
                  const pdfFile = new File([pdfBlob], `${template.id}-base.pdf`, { type: "application/pdf" });

                  // Fetch the schema
                  const schemaResponse = await fetch(`/api/templates/${template.id}/schema`);
                  let schema: FormTemplateSchema | null = null;
                  if (schemaResponse.ok) {
                    schema = await schemaResponse.json();
                  }

                  // Switch to creation/generation mode with existing data
                  setSelectedPdf(pdfFile);
                  setPdfPreviewUrl(URL.createObjectURL(pdfBlob));
                  if (schema) {
                    setCurrentSchema(schema);
                    // Convert schema to versions for display
                    setVersions([{ version: 1, previewBase64: "", schema }]);
                    setSelectedVersion(1);
                  }
                  setGenerationComplete(true);
                  setGenerationStatus("Loaded existing template for editing");
                  setIsEditingPdf(true); // Switch to PDF editing view
                } catch (error) {
                  console.error("Failed to load template for editing:", error);
                  alert("Failed to load template for editing");
                }
              }}
              className="px-3 py-1.5 text-[11px] font-medium text-[#1d1d1f] border border-[#d2d2d7] rounded-lg hover:bg-[#f5f5f7] transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit PDF
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {/* Asset Slots */}
            {parsedTemplate?.assetSlots && parsedTemplate.assetSlots.length > 0 && (
              <div className="mb-6">
                <h4 className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wide mb-3">Assets</h4>
                <div className="space-y-3">
                  {parsedTemplate.assetSlots.map((slot) => (
                    <div key={slot.name} className="p-3 bg-[#f5f5f7] rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[12px] font-medium text-[#1d1d1f]">{slot.name}</span>
                        <span className="px-1.5 py-0.5 text-[9px] font-medium text-[#6e6e73] bg-white rounded">
                          {slot.kind}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={slot.description}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(jsonText);
                            const idx = parsed.assetSlots?.findIndex((s: { name: string }) => s.name === slot.name);
                            if (idx !== undefined && idx >= 0) {
                              parsed.assetSlots[idx].description = e.target.value;
                              setJsonText(JSON.stringify(parsed, null, 2));
                            }
                          } catch { /* ignore */ }
                        }}
                        className="w-full px-2 py-1.5 text-[11px] text-[#6e6e73] bg-white border border-[#e8e8ed] rounded-md focus:outline-none focus:ring-1 focus:ring-[#424245]"
                        placeholder="Description for this asset..."
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Text Fields */}
            {parsedTemplate?.fields && parsedTemplate.fields.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wide mb-3">Fields</h4>
                <div className="space-y-3">
                  {parsedTemplate.fields.map((field) => (
                    <div key={field.name} className="p-3 bg-[#f5f5f7] rounded-lg">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[12px] font-medium text-[#1d1d1f]">{field.name}</span>
                        <span className="px-1.5 py-0.5 text-[9px] font-medium text-[#6e6e73] bg-white rounded">
                          {field.type}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={field.description}
                        onChange={(e) => handleFieldUpdate(field.name, "description", e.target.value)}
                        className="w-full px-2 py-1.5 text-[11px] text-[#6e6e73] bg-white border border-[#e8e8ed] rounded-md focus:outline-none focus:ring-1 focus:ring-[#424245]"
                        placeholder="Description for this field..."
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {(!parsedTemplate?.fields || parsedTemplate.fields.length === 0) &&
             (!parsedTemplate?.assetSlots || parsedTemplate.assetSlots.length === 0) && (
              <div className="h-full flex items-center justify-center">
                <p className="text-[12px] text-[#86868b]">No fields defined</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Preview */}
        <div className="w-1/2 flex flex-col">
          <div className="px-4 py-3 border-b border-[#e8e8ed] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-[#1d1d1f]">Preview</h3>
            <button
              onClick={() => setPreviewKey((k) => k + 1)}
              className="px-2 py-1 text-[11px] text-[#6e6e73] hover:text-[#1d1d1f] transition-colors"
            >
              Refresh
            </button>
          </div>
          <div className="flex-1 p-4">
            {template ? (
              <iframe
                key={previewKey}
                src={`/api/templates/${template.id}/preview?t=${previewKey}`}
                className="w-full h-full rounded-xl border border-[#d2d2d7]"
                title="Template preview"
              />
            ) : (
              <div className="h-full flex items-center justify-center rounded-xl border border-[#d2d2d7] bg-[#f5f5f7]">
                <p className="text-[12px] text-[#86868b]">Save template to see preview</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#d2d2d7]">
          <h2 className="text-[17px] font-semibold text-[#1d1d1f]">
            {isCreating ? "New Template" : isEditingPdf ? "Edit Template PDF" : "Edit Template"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
          >
            <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        {renderContent()}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#d2d2d7]">
          <button
            onClick={() => {
              cancelGeneration();
              onClose();
            }}
            className="px-4 py-2 text-[14px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors"
          >
            Cancel
          </button>

          {/* Accept button - shown during generation when we have at least one version */}
          {(isCreating || isEditingPdf) && isGenerating && versions.length > 0 && (
            <button
              onClick={() => {
                // Ensure schema state has the latest version's schema
                const latestVersion = versions[versions.length - 1];
                if (latestVersion?.schema) {
                  setCurrentSchema(latestVersion.schema);
                }
                setIsGenerating(false);
                setGenerationComplete(true);
                setGenerationStatus("Accepted current version");
              }}
              className="px-4 py-2 text-[14px] font-medium text-[#1d1d1f] border border-[#d2d2d7] rounded-lg
                        hover:bg-[#f5f5f7] transition-all duration-200"
            >
              Accept V{versions[versions.length - 1]?.version || 1}
            </button>
          )}

          {/* Back to Fields button - when editing PDF of existing template */}
          {isEditingPdf && !isGenerating && (
            <button
              onClick={() => setIsEditingPdf(false)}
              className="px-4 py-2 text-[14px] font-medium text-[#1d1d1f] border border-[#d2d2d7] rounded-lg
                        hover:bg-[#f5f5f7] transition-all duration-200"
            >
              Back to Fields
            </button>
          )}

          {/* Generate button - before generation starts (only for new templates, not editing) */}
          {isCreating && !isEditingPdf && !generationComplete && !isGenerating && selectedPdf && (
            <button
              onClick={handleGenerate}
              className="px-4 py-2 text-[14px] font-medium text-white bg-[#1d1d1f] rounded-lg
                        hover:bg-[#424245] transition-all duration-200"
            >
              Generate Template
            </button>
          )}

          {/* Save button - after generation is complete or when in normal editing mode */}
          {((!isCreating && !isEditingPdf) || generationComplete) && (
            <button
              onClick={handleSave}
              disabled={isSaving || !!jsonError || isGenerating}
              className="px-4 py-2 text-[14px] font-medium text-white bg-[#1d1d1f] rounded-lg
                        hover:bg-[#424245] disabled:opacity-40 disabled:cursor-not-allowed
                        transition-all duration-200"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
