"use client";

import { useState, useEffect, useRef } from "react";
import { Template } from "@/lib/types";

interface GeneratorTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status";
  content: string;
  toolName?: string;
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
  // Default to "generate" tab when creating new template
  const [activeTab, setActiveTab] = useState<"generate" | "json" | "code" | "preview">(
    isCreating ? "generate" : "code"
  );
  const [previewKey, setPreviewKey] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [code, setCode] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Generation state
  const [selectedPdf, setSelectedPdf] = useState<File | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [generationTraces, setGenerationTraces] = useState<GeneratorTrace[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const defaultTemplateCode = `// Template for @react-pdf/renderer
//
// HOW TO CREATE A TEMPLATE:
// 1. Attach your target PDF to an LLM (Claude, GPT, etc.)
// 2. Use this prompt: "Create a @react-pdf/renderer template that matches this PDF layout.
//    Export a render(fields, assets, templateRoot) function. Use Document, Page, View,
//    Text, Image, StyleSheet, Font from @react-pdf/renderer."
// 3. Paste the generated code here and adjust as needed.
//
// RULES:
// - Only use: Document, Page, View, Text, Image, StyleSheet, Font from @react-pdf/renderer
// - Export function: render(fields, assets, templateRoot) => React.ReactElement
// - Keep styles in StyleSheet.create() block
// - Register fonts using Font.register() with path.join(templateRoot, "fonts", "...")

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
import path from "path";

// Define your field types
type Fields = {
  TITLE: string;
  DESCRIPTION: string;
  // Add more fields...
};

type Assets = {
  MAIN_IMAGE?: string;
  // Add more asset slots...
};

// Define styles
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
  description: {
    fontSize: 12,
    lineHeight: 1.5,
  },
  image: {
    width: 200,
    height: 150,
    objectFit: "contain",
  },
});

// Main render function
export function render(
  fields: Fields,
  assets: Assets,
  templateRoot: string
): React.ReactElement {
  // Optional: Register custom fonts
  // Font.register({
  //   family: "CustomFont",
  //   fonts: [
  //     { src: path.join(templateRoot, "fonts", "CustomFont-Regular.ttf"), fontWeight: 400 },
  //   ],
  // });

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{fields.TITLE}</Text>
        <Text style={styles.description}>{fields.DESCRIPTION}</Text>
        {assets.MAIN_IMAGE && (
          <Image src={assets.MAIN_IMAGE} style={styles.image} />
        )}
      </Page>
    </Document>
  );
}
`;

  // Reset tab when modal opens/closes or isCreating changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(isCreating ? "generate" : "code");
      setSelectedPdf(null);
      setIsGenerating(false);
      setGenerationStatus(null);
      setGenerationTraces([]);
    }
  }, [isOpen, isCreating]);

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
          { name: "DESCRIPTION", type: "string", description: "Description text" },
        ],
        assetSlots: [
          { name: "MAIN_IMAGE", kind: "photo", description: "Main image" },
        ],
      };
      setJsonText(JSON.stringify(defaultTemplate, null, 2));
      setCode(defaultTemplateCode);
      setJsonError(null);
    }
  }, [template, isCreating, defaultTemplateCode]);

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
      await onSave(parsedTemplate, code || undefined);
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
      setSelectedPdf(file);
    }
  };

  const handleGenerate = async () => {
    if (!selectedPdf) return;

    setIsGenerating(true);
    setGenerationStatus("Starting generation...");
    setGenerationTraces([]);

    try {
      const formData = new FormData();
      formData.append("pdf", selectedPdf);

      const response = await fetch("/api/templates/generate", {
        method: "POST",
        body: formData,
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (eventType === "trace") {
                if (parsed.type === "status") {
                  setGenerationStatus(parsed.content);
                }
                setGenerationTraces((prev) => [...prev, parsed]);
              } else if (eventType === "result") {
                if (parsed.success && parsed.templateJson && parsed.templateCode) {
                  // Update JSON and code with generated content
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                  setCode(parsed.templateCode);
                  setGenerationStatus("Template generated successfully!");
                  // Switch to code tab to show result
                  setTimeout(() => setActiveTab("code"), 1000);
                } else {
                  setGenerationStatus(`Generation failed: ${parsed.message}`);
                }
              } else if (eventType === "error") {
                setGenerationStatus(`Error: ${parsed.error}`);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    } catch (error) {
      setGenerationStatus(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#d2d2d7]">
          <h2 className="text-[17px] font-semibold text-[#1d1d1f]">
            {isCreating ? "New Template" : "Edit Template"}
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

        {/* Tabs */}
        <div className="flex border-b border-[#d2d2d7] px-6">
          {isCreating && (
            <button
              onClick={() => setActiveTab("generate")}
              className={`px-4 py-3 text-[13px] font-medium transition-colors ${
                activeTab === "generate"
                  ? "text-[#1d1d1f] border-b-2 border-[#1d1d1f] -mb-[2px]"
                  : "text-[#86868b] hover:text-[#1d1d1f]"
              }`}
            >
              Generate
            </button>
          )}
          <button
            onClick={() => setActiveTab("json")}
            className={`px-4 py-3 text-[13px] font-medium transition-colors ${
              activeTab === "json"
                ? "text-[#1d1d1f] border-b-2 border-[#1d1d1f] -mb-[2px]"
                : "text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            JSON
          </button>
          <button
            onClick={() => setActiveTab("code")}
            className={`px-4 py-3 text-[13px] font-medium transition-colors ${
              activeTab === "code"
                ? "text-[#1d1d1f] border-b-2 border-[#1d1d1f] -mb-[2px]"
                : "text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            Code
          </button>
          {template && (
            <button
              onClick={() => {
                setPreviewKey((k) => k + 1);
                setActiveTab("preview");
              }}
              className={`px-4 py-3 text-[13px] font-medium transition-colors ${
                activeTab === "preview"
                  ? "text-[#1d1d1f] border-b-2 border-[#1d1d1f] -mb-[2px]"
                  : "text-[#86868b] hover:text-[#1d1d1f]"
              }`}
            >
              Preview
            </button>
          )}
        </div>

        {/* Content - fixed height to prevent modal resize */}
        <div className="h-[450px] overflow-y-auto p-6">
          {activeTab === "generate" && (
            <div className="h-[400px] flex flex-col">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handlePdfSelect}
                className="hidden"
              />

              {!selectedPdf ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-[#d2d2d7] rounded-xl cursor-pointer hover:border-[#86868b] hover:bg-[#f5f5f7] transition-colors"
                >
                  <svg className="w-16 h-16 text-[#86868b] mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">Upload PDF</p>
                  <p className="text-[13px] text-[#86868b]">
                    Drop a PDF or click to browse
                  </p>
                  <p className="text-[11px] text-[#86868b] mt-4 max-w-[300px] text-center">
                    AI will analyze the PDF and generate a matching @react-pdf/renderer template
                  </p>
                </div>
              ) : (
                <div className="flex flex-col h-full">
                  {/* Selected file */}
                  <div className="flex items-center gap-3 p-4 bg-[#f5f5f7] rounded-xl mb-4">
                    <svg className="w-10 h-10 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 2l5 5h-5V4zM8.5 13h7a.5.5 0 010 1h-7a.5.5 0 010-1zm0 2h7a.5.5 0 010 1h-7a.5.5 0 010-1zm0 2h4a.5.5 0 010 1h-4a.5.5 0 010-1z"/>
                    </svg>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-[#1d1d1f] truncate">{selectedPdf.name}</p>
                      <p className="text-[12px] text-[#86868b]">
                        {(selectedPdf.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedPdf(null)}
                      disabled={isGenerating}
                      className="p-2 hover:bg-white rounded-lg transition-colors disabled:opacity-50"
                    >
                      <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Generation status */}
                  {generationStatus && (
                    <div className={`p-3 rounded-lg mb-4 text-[13px] ${
                      generationStatus.includes("Error") || generationStatus.includes("failed")
                        ? "bg-red-50 text-red-700"
                        : generationStatus.includes("successfully")
                          ? "bg-green-50 text-green-700"
                          : "bg-blue-50 text-blue-700"
                    }`}>
                      <div className="flex items-center gap-2">
                        {isGenerating && (
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                        {generationStatus}
                      </div>
                    </div>
                  )}

                  {/* Generation traces */}
                  {generationTraces.length > 0 && (
                    <div className="flex-1 overflow-y-auto border border-[#e8e8ed] rounded-xl p-3 mb-4">
                      <details open className="text-[11px]">
                        <summary className="cursor-pointer text-[#86868b] hover:text-[#1d1d1f] mb-2 font-medium">
                          Generation log ({generationTraces.length} steps)
                        </summary>
                        <div className="space-y-1 pl-2 border-l-2 border-[#e8e8ed]">
                          {generationTraces.map((trace, idx) => (
                            <div key={idx} className="text-[10px]">
                              {trace.type === "status" && (
                                <span className="text-[#86868b]">{trace.content}</span>
                              )}
                              {trace.type === "tool_call" && (
                                <span className="text-[#0066CC] font-mono">{trace.toolName}()</span>
                              )}
                              {trace.type === "tool_result" && (
                                <span className="text-[#00aa00]">✓ {trace.toolName}</span>
                              )}
                              {trace.type === "reasoning" && (
                                <span className="text-[#86868b] italic">{trace.content.substring(0, 100)}...</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}

                  {/* Generate button */}
                  {!isGenerating && !generationStatus?.includes("successfully") && (
                    <button
                      onClick={handleGenerate}
                      className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white text-[14px] font-medium rounded-xl hover:from-purple-700 hover:to-blue-700 transition-all"
                    >
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
                        </svg>
                        Generate Template with AI
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === "json" && (
            <div className="h-[400px] flex flex-col">
              {jsonError && (
                <div className="mb-2 px-3 py-2 bg-red-50 text-red-600 text-[12px] rounded-lg">
                  {jsonError}
                </div>
              )}
              <textarea
                value={jsonText}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="w-full flex-1 px-4 py-3 bg-[#1d1d1f] text-[#e8e8ed] font-mono text-[13px]
                          rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#424245]"
                placeholder='{"id": "my-template", "name": "My Template", ...}'
                spellCheck={false}
              />
            </div>
          )}

          {activeTab === "code" && (
            <div className="h-[400px] flex flex-col gap-2">
              <p className="text-[11px] text-[#86868b]">
                Tip: Use the Generate tab to auto-generate from a PDF, or paste code manually.
              </p>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full flex-1 px-4 py-3 bg-[#1d1d1f] text-[#e8e8ed] font-mono text-[13px]
                          rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#424245]"
                placeholder="// Template code (template.tsx)"
                spellCheck={false}
              />
            </div>
          )}

          {activeTab === "preview" && template && (
            <div className="h-[500px] flex flex-col gap-2">
              <p className="text-[12px] text-[#86868b]">
                Preview with placeholder values {"({{FIELD_NAME}})"}
              </p>
              <iframe
                key={previewKey}
                src={`/api/templates/${template.id}/preview?t=${previewKey}`}
                className="flex-1 w-full rounded-xl border border-[#d2d2d7]"
                title="Template preview"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#d2d2d7]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[14px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !!jsonError || isGenerating}
            className="px-4 py-2 text-[14px] font-medium text-white bg-[#1d1d1f] rounded-lg
                      hover:bg-[#424245] disabled:opacity-40 disabled:cursor-not-allowed
                      transition-all duration-200"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
