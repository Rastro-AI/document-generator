"use client";

import { useState, useEffect } from "react";
import { Template } from "@/lib/types";

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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
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
                Tip: Attach your target PDF to an LLM and prompt: &quot;Create a @react-pdf/renderer template matching this layout. Export render(fields, assets, templateRoot).&quot;
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
            disabled={isSaving || !!jsonError}
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
