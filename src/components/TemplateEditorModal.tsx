"use client";

import { useState, useEffect, useRef } from "react";
import { Template } from "@/lib/types";
import { AssetBankModal } from "./AssetBankModal";
import { Asset, isColorAsset, isFontAsset, isFileAsset } from "@/hooks/useAssetBank";

// Default SVG template code
const DEFAULT_TEMPLATE_CODE = `<svg xmlns="http://www.w3.org/2000/svg" width="612" height="792" viewBox="0 0 612 792">
  <defs>
    <style>
      .page { fill: #ffffff; }
      .title { fill: #1a1a1a; font-family: Arial, sans-serif; font-size: 24px; font-weight: bold; }
      .content { fill: #333333; font-family: Arial, sans-serif; font-size: 14px; }
    </style>
  </defs>

  <!-- Page background -->
  <rect class="page" x="0" y="0" width="612" height="792"/>

  <!-- Content -->
  <text class="title" x="40" y="60">{{TITLE}}</text>
  <text class="content" x="40" y="100">{{DESCRIPTION}}</text>
</svg>`;

interface TemplateJsonField {
  name: string;
  type: string;
  description: string;
  example?: unknown;
  items?: { type: string; properties?: Record<string, { type: string; description?: string }> };
  properties?: Record<string, { type: string; description?: string }>;
}

interface GeneratorTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status" | "version" | "template_json" | "user_feedback";
  content: string;
  toolName?: string;
  version?: number;
  previewUrl?: string;
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
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState<string | null>(null);
  const [generationTraces, setGenerationTraces] = useState<GeneratorTrace[]>([]);
  const [generatedPreviewUrl, setGeneratedPreviewUrl] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [generationComplete, setGenerationComplete] = useState(false);
  const [generationStartTime, setGenerationStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [userPrompt, setUserPrompt] = useState("");
  const [versions, setVersions] = useState<Array<{ version: number; previewBase64: string; pdfBase64?: string; templateCode?: string }>>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);

  // Right panel state (matching JobEditor)
  const [rightPanelTab, setRightPanelTab] = useState<"preview" | "assets" | "data">("preview");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const [showCodeModal, setShowCodeModal] = useState(false);

  // Close dropdown menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target as Node)) {
        setShowHistoryMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle asset bank selection toggle
  const handleToggleAsset = (asset: Asset) => {
    const isSelected = selectedAssets.some(a => a.id === asset.id);
    if (isSelected) {
      setSelectedAssets(prev => prev.filter(a => a.id !== asset.id));
    } else {
      setSelectedAssets(prev => [...prev, asset]);
    }
  };
  const allInputRef = useRef<HTMLInputElement>(null);

  const [feedbackInput, setFeedbackInput] = useState("");
  const [expandedTraces, setExpandedTraces] = useState<Set<number>>(new Set());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [conversationHistory, setConversationHistory] = useState<any[] | null>(null);
  // Track if this is the initial generation (no versions yet) vs refinement iterations
  const hasAnyVersion = versions.length > 0;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const EXPECTED_DURATION = 10 * 60; // 10 minutes in seconds

  // Check if we have enough input to start generation
  const canGenerate = userPrompt.trim().length > 0 || selectedPdf !== null || selectedImages.length > 0 || selectedAssets.length > 0;

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
      setSelectedImages([]);
      setSelectedAssets([]);
      setShowAssetModal(false);
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
      setExpandedTraces(new Set());
      setConversationHistory(null);
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
        format: "svg",
        canvas: { width: 612, height: 792 },
        fonts: [],
        fields: [
          { name: "TITLE", type: "string", description: "Main title" },
          { name: "DESCRIPTION", type: "string", description: "Description text" },
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
    if (!feedbackInput.trim()) return;

    const feedbackText = feedbackInput.trim();
    setFeedbackInput("");
    setIsGenerating(true);
    setGenerationComplete(false);
    // Don't switch to input tab - keep current view so user can see progress

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
      if (selectedPdf) {
        formData.append("pdf", selectedPdf);
      }
      formData.append("reasoning", "none");
      formData.append("feedback", feedbackText);
      formData.append("currentCode", code);
      formData.append("currentJson", jsonText);
      // Pass max version number so new versions continue numbering correctly
      const maxVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version)) : 0;
      formData.append("startVersion", String(maxVersion));
      // Pass conversation history to resume from where we left off
      if (conversationHistory) {
        formData.append("conversationHistory", JSON.stringify(conversationHistory));
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
            console.log(`[SSE] Event type: ${currentEventType}`);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            console.log(`[SSE] Received data for ${currentEventType}:`, data.substring(0, 100));
            try {
              const parsed = JSON.parse(data);
              console.log(`[SSE] Parsed event:`, { type: parsed.type, content: parsed.content?.substring?.(0, 50) });
              if (currentEventType === "trace") {
                if (parsed.type === "status") {
                  console.log(`[SSE] Setting status: ${parsed.content}`);
                  setGenerationStatus(parsed.content);
                }
                if (parsed.type === "version") {
                  console.log(`[SSE] Received version event: V${parsed.version}`);
                  if (parsed.version && parsed.previewUrl) {
                    setVersions((prev) => [
                      ...prev,
                      { version: parsed.version, previewBase64: parsed.previewUrl, pdfBase64: parsed.pdfUrl, templateCode: parsed.templateCode },
                    ]);
                    setSelectedVersion(parsed.version);
                    // Update code state with latest version's code
                    if (parsed.templateCode) {
                      setCode(parsed.templateCode);
                    }
                  }
                }
                if (parsed.type === "template_json" && parsed.templateJson) {
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                }
                console.log(`[SSE] Adding trace to generationTraces:`, parsed.type);
                setGenerationTraces((prev) => [...prev, parsed]);
              } else if (currentEventType === "result") {
                // Always save conversation history for potential resume
                if (parsed.conversationHistory) {
                  setConversationHistory(parsed.conversationHistory);
                }
                if (parsed.success && parsed.templateJson && parsed.templateCode) {
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                  setCode(parsed.templateCode);
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
      abortControllerRef.current = null;
    }
  };

  const cancelGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGenerating(false);
    setGenerationStatus("Generation cancelled");
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;

    // Cancel any existing generation
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsGenerating(true);
    setGenerationStartTime(Date.now());
    setElapsedTime(0);
    setGenerationStatus("Starting generation...");
    // Show user's initial message in traces (prompt + attachments)
    const initialTraces: GeneratorTrace[] = [];
    const attachmentNames: string[] = [];
    if (selectedPdf) attachmentNames.push(selectedPdf.name);
    selectedImages.forEach(img => attachmentNames.push(img.name));
    selectedAssets.forEach(asset => {
      if (isFileAsset(asset)) {
        attachmentNames.push(asset.filename);
      } else if (isColorAsset(asset)) {
        attachmentNames.push(`Color: ${asset.name}`);
      } else if (isFontAsset(asset)) {
        attachmentNames.push(`Font: ${asset.name}`);
      }
    });

    const promptText = userPrompt.trim();
    const attachmentText = attachmentNames.length > 0 ? `[${attachmentNames.join(", ")}]` : "";
    const fullMessage = promptText
      ? (attachmentText ? `${promptText} ${attachmentText}` : promptText)
      : (attachmentText || "Generate template");

    initialTraces.push({ type: "user_feedback", content: fullMessage });
    setGenerationTraces(initialTraces);
    setVersions([]);
    setSelectedVersion(0);

    try {
      const formData = new FormData();

      // Add PDF if provided
      if (selectedPdf) {
        formData.append("pdf", selectedPdf);
      }

      // Add prompt
      if (userPrompt.trim()) {
        formData.append("prompt", userPrompt.trim());
      }

      // Add selected images
      for (const image of selectedImages) {
        formData.append("images", image);
      }

      // Add asset bank images - fetch them and add as files
      for (const asset of selectedAssets) {
        if (isFileAsset(asset) && asset.type === "image") {
          try {
            const response = await fetch(`/api/assets/${asset.id}`);
            if (response.ok) {
              const blob = await response.blob();
              formData.append("images", blob, asset.filename);
            }
          } catch (e) {
            console.error(`Failed to fetch asset ${asset.id}:`, e);
          }
        }
      }

      // Add brand kit colors and fonts
      const brandColors = selectedAssets.filter(isColorAsset);
      const brandFonts = selectedAssets.filter(isFontAsset);
      if (brandColors.length > 0) {
        formData.append("brandColors", JSON.stringify(brandColors));
      }
      if (brandFonts.length > 0) {
        formData.append("brandFonts", JSON.stringify(brandFonts));
      }

      formData.append("reasoning", "none"); // Enable reasoning for better quality

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
        if (done) {
          console.log(`[SSE:generate] Stream done, remaining buffer: ${buffer}`);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        console.log(`[SSE:generate] Received chunk (${chunk.length} chars):`, chunk.substring(0, 100));
        buffer += chunk;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        console.log(`[SSE:generate] Processing ${lines.length} lines, buffer remainder: ${buffer.length} chars`);

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7);
            console.log(`[SSE:generate] Event type: ${currentEventType}`);
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            console.log(`[SSE:generate] Received data for ${currentEventType}:`, data.substring(0, 100));
            try {
              const parsed = JSON.parse(data);
              console.log(`[SSE:generate] Parsed:`, { type: parsed.type, toolName: parsed.toolName, content: parsed.content?.substring?.(0, 50) });
              if (currentEventType === "trace") {
                if (parsed.type === "status") {
                  console.log(`[SSE:generate] Setting status: ${parsed.content}`);
                  setGenerationStatus(parsed.content);
                }
                if (parsed.type === "version") {
                  console.log(`[SSE:generate] VERSION EVENT: V${parsed.version}, hasPreview: ${!!parsed.previewUrl}`);
                  if (parsed.version && parsed.previewUrl) {
                    setVersions((prev) => [
                      ...prev,
                      { version: parsed.version, previewBase64: parsed.previewUrl, pdfBase64: parsed.pdfUrl, templateCode: parsed.templateCode },
                    ]);
                    setSelectedVersion(parsed.version);
                    // Update code state with latest version's code
                    if (parsed.templateCode) {
                      setCode(parsed.templateCode);
                    }
                  }
                }
                // Handle template_json event - update fields in real-time
                if (parsed.type === "template_json" && parsed.templateJson) {
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                }
                console.log(`[SSE:generate] Adding to traces:`, parsed.type);
                setGenerationTraces((prev) => [...prev, parsed]);
              } else if (currentEventType === "result") {
                console.log(`[SSE:generate] RESULT EVENT:`, { success: parsed.success });
                // Always save conversation history for potential resume
                if (parsed.conversationHistory) {
                  setConversationHistory(parsed.conversationHistory);
                }
                if (parsed.success && parsed.templateJson && parsed.templateCode) {
                  setJsonText(JSON.stringify(parsed.templateJson, null, 2));
                  setCode(parsed.templateCode);
                  setGenerationStatus("Template generated successfully!");
                  setGenerationComplete(true);
                  // Auto-render preview
                  setTimeout(async () => {
                    const templateData = parsed.templateJson;
                    // Generate type-appropriate placeholders for previews
                    const sampleFields: Record<string, unknown> = {};
                    for (const field of templateData.fields || []) {
                      sampleFields[field.name] = generatePlaceholderValue(field);
                    }
                    try {
                      const previewResponse = await fetch("/api/templates/preview-code", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ code: parsed.templateCode, fields: sampleFields }),
                      });
                      if (previewResponse.ok) {
                        const blob = await previewResponse.blob();
                        setGeneratedPreviewUrl(URL.createObjectURL(blob));
                      }
                    } catch (e) {
                      console.error("Failed to render preview:", e);
                    }
                  }, 100);
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

  // Handle image file selection
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      setSelectedImages(prev => [...prev, ...Array.from(files)]);
    }
  };

  // Remove an image
  const removeImage = (index: number) => {
    setSelectedImages(prev => prev.filter((_, i) => i !== index));
  };

  // Remove an asset
  const removeAsset = (id: string) => {
    setSelectedAssets(prev => prev.filter(a => a.id !== id));
  };

  // Combined file selector (PDF or images)
  const handleAllSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.type === "application/pdf") {
        if (pdfPreviewUrl) {
          URL.revokeObjectURL(pdfPreviewUrl);
        }
        setSelectedPdf(file);
        setPdfPreviewUrl(URL.createObjectURL(file));
      } else if (file.type.startsWith("image/")) {
        setSelectedImages(prev => [...prev, file]);
      }
    }
    if (e.target) {
      (e.target as HTMLInputElement).value = "";
    }
  };

  // Render content based on creation vs editing mode
  const renderContent = () => {
    // CREATING MODE
    if (isCreating) {
      // Step 1: No input yet - show the combined input area
      const hasStartedGeneration = versions.length > 0 || isGenerating;

      if (!hasStartedGeneration) {
        return (
          <div className="h-[600px] p-6 flex flex-col">
            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={handlePdfSelect}
              className="hidden"
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />

            {/* Main input area: drop zone at top; compact bar at bottom */}
            <div className="flex-1 flex flex-col">
              {/* Combined hidden input (PDF + images) */}
              <input
                ref={allInputRef}
                type="file"
                multiple
                accept=".pdf,image/*"
                onChange={handleAllSelect}
                className="hidden"
              />
              {/* Hidden header, minimal text */}
              <div className="hidden" />

              {/* Drop zone */}
              <div
                className="flex-1 mb-4 rounded-2xl border-2 border-dashed border-[#d2d2d7] bg-[#fafafa] hover:border-[#1d1d1f] transition-colors flex items-center justify-center cursor-pointer overflow-hidden relative"
                onClick={() => !pdfPreviewUrl && allInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files || []);
                  for (const file of files) {
                    if (file.type === "application/pdf") {
                      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
                      setSelectedPdf(file);
                      setPdfPreviewUrl(URL.createObjectURL(file));
                    } else if (file.type.startsWith("image/")) {
                      setSelectedImages((prev) => [...prev, file]);
                    }
                  }
                }}
              >
                {pdfPreviewUrl ? (
                  /* PDF Preview inside drop zone */
                  <div className="w-full h-full relative">
                    <iframe
                      src={pdfPreviewUrl}
                      className="w-full h-full rounded-xl"
                      title="PDF to mimic"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPdf(null);
                        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
                        setPdfPreviewUrl(null);
                      }}
                      className="absolute top-3 right-3 w-7 h-7 rounded-full bg-white/90 shadow-md flex items-center justify-center hover:bg-white transition-colors"
                    >
                      <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <div className="absolute bottom-3 left-3 px-2 py-1 bg-white/90 rounded-md shadow-sm">
                      <p className="text-[11px] text-[#1d1d1f] font-medium">PDF to mimic</p>
                      <p className="text-[10px] text-[#86868b]">Only first page will be used</p>
                    </div>
                  </div>
                ) : (
                  /* Empty state */
                  <div className="text-center text-[#1d1d1f]">
                    <svg className="w-8 h-8 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16h16" />
                    </svg>
                    <p className="text-[13px] font-medium">Drop PDF to mimic</p>
                    <p className="text-[11px] text-[#86868b] mt-1">or click to browse</p>
                  </div>
                )}
              </div>

              {/* Compact bar */}
              <div className="flex items-center gap-2 px-3 pb-3">
                <input
                  type="text"
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && canGenerate && !isGenerating) {
                      e.preventDefault();
                      handleGenerate();
                    }
                  }}
                  placeholder="Describe the template..."
                  className="flex-1 px-3 py-2 bg-[#f5f5f7] rounded-lg text-[14px] text-[#1d1d1f] placeholder-[#86868b] border-0 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f] focus:ring-offset-1"
                />
                <button
                  type="button"
                  onClick={() => allInputRef.current?.click()}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-[13px] font-medium bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed] transition-all"
                  title="Attach files"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                  Attach
                </button>
                <button
                  type="button"
                  onClick={() => setShowAssetModal(true)}
                  className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-[13px] font-medium bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed] transition-all"
                  title="Open Brand Bank"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                  </svg>
                  Brand Bank
                </button>
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                  className="h-8 px-3 flex items-center justify-center gap-1.5 rounded-lg bg-[#1d1d1f] text-white hover:bg-[#424245] active:scale-[0.95] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[13px] font-medium"
                  title="Generate template"
                >
                  Go
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </button>
              </div>

              {/* Attachments preview - only show images and assets (PDF is shown in drop zone) */}
              {(selectedImages.length > 0 || selectedAssets.length > 0) && (
                <div className="flex-1 overflow-auto">
                  <div className="flex flex-wrap gap-3">
                    {/* Images */}
                    {selectedImages.map((image, index) => (
                      <div key={`image-${index}`} className="relative group">
                        <img
                          src={URL.createObjectURL(image)}
                          alt={image.name}
                          className="w-24 h-24 rounded-lg object-cover border border-[#d2d2d7]"
                        />
                        <button
                          onClick={() => removeImage(index)}
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#1d1d1f] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}

                    {/* Asset bank */}
                    {selectedAssets.map((asset) => (
                      <div key={`asset-${asset.id}`} className="relative group">
                        {isColorAsset(asset) ? (
                          /* Color swatch */
                          <div className="w-24 h-24 rounded-lg border border-[#d2d2d7] flex flex-col items-center justify-center p-2">
                            <div
                              className="w-12 h-12 rounded-lg shadow-inner mb-1"
                              style={{ backgroundColor: asset.value }}
                            />
                            <span className="text-[10px] text-[#1d1d1f] truncate max-w-[80px] font-medium">{asset.name}</span>
                            <span className="text-[9px] text-[#86868b] uppercase">{asset.value}</span>
                          </div>
                        ) : isFontAsset(asset) ? (
                          /* Font preview */
                          <div className="w-24 h-24 rounded-lg bg-[#f5f5f7] border border-[#d2d2d7] flex flex-col items-center justify-center">
                            <span className="text-2xl font-semibold text-[#1d1d1f] mb-1">Aa</span>
                            <span className="text-[10px] text-[#1d1d1f] truncate max-w-[80px] font-medium">{asset.name}</span>
                            <span className="text-[9px] text-[#86868b] truncate max-w-[80px]">{asset.family}</span>
                          </div>
                        ) : isFileAsset(asset) && asset.type === "image" ? (
                          <img
                            src={`/api/assets/${asset.id}`}
                            alt={asset.filename}
                            className="w-24 h-24 rounded-lg object-cover border border-[#d2d2d7]"
                          />
                        ) : (
                          <div className="w-24 h-24 rounded-lg bg-white border border-[#d2d2d7] flex flex-col items-center justify-center">
                            <svg className="w-8 h-8 text-[#86868b] mb-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <span className="text-[10px] text-[#86868b] truncate max-w-[80px]">{isFileAsset(asset) ? asset.filename : "Asset"}</span>
                          </div>
                        )}
                        <button
                          onClick={() => removeAsset(asset.id)}
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#1d1d1f] text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state removed per request */}
            </div>
          </div>
        );
      }

      // Step 2 & 3: Generation in progress or complete - JobEditor-style two-pane layout
      // Left: Chat panel with traces
      // Right: Preview/Assets/Data tabs with Export/History buttons

      const latestVersion = versions.length > 0 ? versions[versions.length - 1] : null;

      return (
        <div className="h-[600px] flex flex-col">
          <div className="flex-1 flex min-h-0">
            {/* Left: Chat panel with traces */}
            <div className="w-1/2 border-r border-[#d2d2d7] flex flex-col">
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
                            : isGenerating
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

                    {/* Generation traces - simplified uniform list */}
                    <div className="flex-1 min-h-0 overflow-y-auto border border-[#e8e8ed] rounded-xl bg-white">
                      <div className="p-3 space-y-1">
                        {generationTraces.length === 0 ? (
                          <div className="text-[11px] text-[#86868b] py-2">
                            Initializing...
                          </div>
                        ) : (
                          generationTraces.filter((t) => t.type !== "version").map((trace, idx) => (
                            <div key={idx} className="text-[11px]">
                              {/* User feedback */}
                              {trace.type === "user_feedback" && (
                                <div className="py-1 text-[#1d1d1f] font-medium">
                                  You: {trace.content}
                                </div>
                              )}
                              {/* Reasoning - collapsible */}
                              {trace.type === "reasoning" && (
                                <button
                                  onClick={() => toggleTraceExpanded(idx)}
                                  className="w-full flex items-center gap-1.5 py-1 text-left text-[#6e6e73] hover:text-[#1d1d1f]"
                                >
                                  <svg
                                    className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${expandedTraces.has(idx) ? "rotate-90" : ""}`}
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                  >
                                    <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                                  </svg>
                                  <span>Thinking...</span>
                                  {expandedTraces.has(idx) && (
                                    <span className="ml-2 text-[10px] text-[#86868b] whitespace-pre-wrap flex-1">{trace.content.substring(0, 100)}...</span>
                                  )}
                                </button>
                              )}
                              {expandedTraces.has(idx) && trace.type === "reasoning" && (
                                <div className="pl-4 pb-1 text-[10px] text-[#6e6e73] whitespace-pre-wrap">
                                  {trace.content}
                                </div>
                              )}
                              {/* Status */}
                              {trace.type === "status" && (
                                <div className="py-1 text-[#86868b]">
                                  {trace.content}
                                </div>
                              )}
                              {/* Tool call - always visible */}
                              {trace.type === "tool_call" && (
                                <div className="flex items-center gap-1.5 py-1 text-[#1d1d1f]">
                                  <span className="font-mono font-medium">{trace.toolName || "tool"}</span>
                                  {trace.content && !trace.content.includes(trace.toolName || "") && (
                                    <span className="text-[#86868b] ml-1">{trace.content}</span>
                                  )}
                                </div>
                              )}
                              {/* Tool result - always shown */}
                              {trace.type === "tool_result" && (
                                <div className="pl-4 pb-1 text-[10px] text-[#86868b] font-mono whitespace-pre-wrap border-l-2 border-[#e8e8ed] ml-1">
                                  {trace.content.length > 200 ? trace.content.substring(0, 200) + "..." : trace.content}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Chat input - always visible at bottom during/after generation */}
              {(isGenerating || generationComplete || generationStatus) && (
                <div className="border-t border-[#e8e8ed] p-3 flex-shrink-0">
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={feedbackInput}
                      onChange={(e) => setFeedbackInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendFeedback();
                        }
                      }}
                      placeholder="Add feedback..."
                      className="flex-1 px-3 py-2 text-[12px] bg-[#f5f5f7] border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#424245] resize-none min-h-[36px] max-h-[120px]"
                      rows={1}
                      style={{ height: 'auto', overflow: 'hidden' }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = Math.min(target.scrollHeight, 120) + 'px';
                      }}
                    />
                    <button
                      onClick={handleSendFeedback}
                      disabled={!feedbackInput.trim()}
                      className="h-8 px-3 flex items-center justify-center gap-1.5 rounded-lg bg-[#1d1d1f] text-white hover:bg-[#424245] active:scale-[0.95] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-[13px] font-medium flex-shrink-0"
                    >
                      Go
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Preview/Assets/Data tabs - matching JobEditor */}
            <div className="w-1/2 flex flex-col">
              {/* Tabs - centered with icons, black active state */}
              <div className="flex-shrink-0 px-4 pt-3 pb-2 flex items-center justify-center border-b border-[#e8e8ed]">
                <div className="flex gap-1 p-1 bg-[#f5f5f7] rounded-lg">
                  <button
                    onClick={() => setRightPanelTab("preview")}
                    className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                      rightPanelTab === "preview"
                        ? "bg-[#1d1d1f] text-white shadow-sm"
                        : "text-[#86868b] hover:text-[#1d1d1f] hover:bg-white/50"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Preview
                  </button>
                  <button
                    onClick={() => setRightPanelTab("assets")}
                    className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                      rightPanelTab === "assets"
                        ? "bg-[#1d1d1f] text-white shadow-sm"
                        : "text-[#86868b] hover:text-[#1d1d1f] hover:bg-white/50"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                    Assets
                  </button>
                  <button
                    onClick={() => setRightPanelTab("data")}
                    className={`px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                      rightPanelTab === "data"
                        ? "bg-[#1d1d1f] text-white shadow-sm"
                        : "text-[#86868b] hover:text-[#1d1d1f] hover:bg-white/50"
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 1.5v-1.5m0 0c0-.621.504-1.125 1.125-1.125m0 0h7.5" />
                    </svg>
                    Data
                  </button>
                </div>
              </div>

              {/* Tab content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {/* Preview tab */}
                {rightPanelTab === "preview" && (
                  <div className="h-full p-4 relative">
                    {latestVersion ? (
                      <>
                        {/* PDF/PNG Preview */}
                        <div className="h-full rounded-xl overflow-hidden border border-[#d2d2d7] bg-white">
                          {latestVersion.pdfBase64 ? (
                            <iframe
                              src={`${latestVersion.pdfBase64}#toolbar=0&navpanes=0`}
                              className="w-full h-full"
                              title={`Version ${latestVersion.version} PDF`}
                            />
                          ) : latestVersion.previewBase64 ? (
                            <img
                              src={latestVersion.previewBase64}
                              alt={`Version ${latestVersion.version} preview`}
                              className="w-full h-full object-contain"
                            />
                          ) : (
                            <div className="h-full flex items-center justify-center text-[#86868b] text-[13px]">
                              No preview available
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="absolute top-6 right-6 flex gap-2">
                          {/* Export dropdown */}
                          <div className="relative" ref={exportMenuRef}>
                            <button
                              onClick={() => setShowExportMenu(!showExportMenu)}
                              className="h-8 px-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-white/90 hover:bg-white shadow-sm transition-colors text-[12px] font-medium text-[#1d1d1f]"
                              title="Export"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                              </svg>
                              Export
                            </button>

                            {showExportMenu && (
                              <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-[#e8e8ed] py-1 z-50">
                                {latestVersion.pdfBase64 && (
                                  <a
                                    href={latestVersion.pdfBase64}
                                    download="template.pdf"
                                    onClick={() => setShowExportMenu(false)}
                                    className="block w-full px-3 py-2 text-left text-[12px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                                  >
                                    PDF
                                  </a>
                                )}
                                {latestVersion.templateCode && (
                                  <>
                                    <button
                                      onClick={() => {
                                        setShowExportMenu(false);
                                        // Download SVG
                                        const blob = new Blob([latestVersion.templateCode!], { type: 'image/svg+xml' });
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = 'template.svg';
                                        a.click();
                                        URL.revokeObjectURL(url);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-[12px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                                    >
                                      SVG
                                    </button>
                                    <button
                                      onClick={() => {
                                        setShowExportMenu(false);
                                        setCode(latestVersion.templateCode!);
                                        setShowCodeModal(true);
                                      }}
                                      className="block w-full px-3 py-2 text-left text-[12px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                                    >
                                      Code
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* History dropdown */}
                          {versions.length >= 1 && (
                            <div className="relative" ref={historyMenuRef}>
                              <button
                                onClick={() => setShowHistoryMenu(!showHistoryMenu)}
                                className={`h-8 px-2.5 flex items-center justify-center gap-1.5 rounded-lg shadow-sm transition-colors text-[12px] font-medium ${
                                  showHistoryMenu
                                    ? "bg-white text-[#1d1d1f]"
                                    : "bg-white/90 hover:bg-white text-[#1d1d1f]"
                                }`}
                                title="History"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                History
                              </button>

                              {showHistoryMenu && (
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-[#e8e8ed] py-1 z-50 max-h-60 overflow-y-auto">
                                  {/* Input/Source */}
                                  <button
                                    onClick={() => {
                                      setSelectedVersion(0);
                                      setShowHistoryMenu(false);
                                    }}
                                    className={`w-full px-3 py-2 text-left text-[12px] hover:bg-[#f5f5f7] transition-colors flex items-center justify-between ${
                                      selectedVersion === 0 ? "bg-[#f5f5f7]" : ""
                                    }`}
                                  >
                                    <span>Input PDF</span>
                                    {selectedVersion === 0 && <span className="text-[10px] text-[#86868b]">Viewing</span>}
                                  </button>
                                  {/* Versions - newest first */}
                                  {[...versions].reverse().map((v, idx) => (
                                    <button
                                      key={v.version}
                                      onClick={() => {
                                        setSelectedVersion(v.version);
                                        setShowHistoryMenu(false);
                                      }}
                                      className={`w-full px-3 py-2 text-left text-[12px] hover:bg-[#f5f5f7] transition-colors flex items-center justify-between ${
                                        selectedVersion === v.version ? "bg-[#f5f5f7]" : ""
                                      }`}
                                    >
                                      <span>Version {v.version}</span>
                                      {idx === 0 && <span className="text-[10px] text-[#86868b]">Latest</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    ) : pdfPreviewUrl ? (
                      /* Show source PDF when no versions yet */
                      <div className="h-full rounded-xl overflow-hidden border border-[#d2d2d7]">
                        <iframe
                          src={`${pdfPreviewUrl}#toolbar=0&navpanes=0`}
                          className="w-full h-full"
                          title="Source PDF"
                        />
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center">
                        <svg className="w-12 h-12 text-[#d2d2d7] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-[13px] text-[#86868b]">Preview will appear here</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Assets tab */}
                {rightPanelTab === "assets" && (
                  <div className="h-full overflow-y-auto p-4">
                    {parsedTemplate?.assetSlots && parsedTemplate.assetSlots.length > 0 ? (
                      <div className="space-y-3">
                        {parsedTemplate.assetSlots.map((slot) => (
                          <div key={slot.name} className="p-4 border border-[#e8e8ed] rounded-xl bg-white">
                            <div className="flex items-start justify-between">
                              <div>
                                <p className="text-[13px] font-medium text-[#1d1d1f]">{slot.name}</p>
                                <p className="text-[12px] text-[#6e6e73] mt-1">{slot.description}</p>
                              </div>
                              <span className="px-2 py-0.5 text-[10px] font-medium text-[#6e6e73] bg-[#f5f5f7] rounded">
                                {slot.kind}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center">
                        <svg className="w-12 h-12 text-[#d2d2d7] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <p className="text-[13px] text-[#86868b]">No asset slots defined</p>
                        <p className="text-[11px] text-[#aeaeb2] mt-1">Assets will appear here after generation</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Data tab */}
                {rightPanelTab === "data" && (
                  <div className="h-full overflow-y-auto p-4">
                    {parsedTemplate?.fields && parsedTemplate.fields.length > 0 ? (
                      <div className="space-y-3">
                        {parsedTemplate.fields.map((field) => (
                          <div key={field.name} className="p-4 border border-[#e8e8ed] rounded-xl bg-white">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <p className="text-[13px] font-medium text-[#1d1d1f]">{field.name}</p>
                                <p className="text-[12px] text-[#6e6e73] mt-1">{field.description}</p>
                                {field.example !== undefined && (
                                  <p className="text-[11px] text-[#86868b] mt-2 italic">
                                    Example: {typeof field.example === 'object' ? JSON.stringify(field.example) : String(field.example)}
                                  </p>
                                )}
                              </div>
                              <span className="px-2 py-0.5 text-[10px] font-medium text-[#6e6e73] bg-[#f5f5f7] rounded ml-2">
                                {field.type}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center">
                        <svg className="w-12 h-12 text-[#d2d2d7] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                        </svg>
                        <p className="text-[13px] text-[#86868b]">No fields defined</p>
                        <p className="text-[11px] text-[#aeaeb2] mt-1">Fields will appear here after generation</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // EDITING MODE - Tabs: Fields, Code, Preview
    return (
      <>
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
            Fields
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
        <div className="h-[450px] overflow-y-auto p-6">
          {activeTab === "json" && (
            <div className="space-y-6">
              {/* Template Info */}
              <div className="space-y-3">
                <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Template Info</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[#86868b] mb-1">Name</label>
                    <input
                      type="text"
                      value={parsedTemplate?.name || ""}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(jsonText);
                          parsed.name = e.target.value;
                          setJsonText(JSON.stringify(parsed, null, 2));
                        } catch { /* ignore */ }
                      }}
                      className="w-full px-3 py-2 text-[13px] bg-[#f5f5f7] border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#86868b] mb-1">ID</label>
                    <input
                      type="text"
                      value={parsedTemplate?.id || ""}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(jsonText);
                          parsed.id = e.target.value;
                          setJsonText(JSON.stringify(parsed, null, 2));
                        } catch { /* ignore */ }
                      }}
                      className="w-full px-3 py-2 text-[13px] bg-[#f5f5f7] border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
                    />
                  </div>
                </div>
              </div>

              {/* Asset Slots */}
              {parsedTemplate?.assetSlots && parsedTemplate.assetSlots.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Asset Slots</h3>
                  <div className="space-y-2">
                    {parsedTemplate.assetSlots.map((slot, index) => (
                      <div key={slot.name} className="p-3 bg-[#f5f5f7] rounded-lg">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[13px] font-medium text-[#1d1d1f]">{slot.name}</span>
                              <span className="px-1.5 py-0.5 text-[10px] font-medium text-[#6e6e73] bg-white rounded">
                                {slot.kind}
                              </span>
                            </div>
                            <input
                              type="text"
                              value={slot.description}
                              onChange={(e) => {
                                try {
                                  const parsed = JSON.parse(jsonText);
                                  if (parsed.assetSlots?.[index]) {
                                    parsed.assetSlots[index].description = e.target.value;
                                    setJsonText(JSON.stringify(parsed, null, 2));
                                  }
                                } catch { /* ignore */ }
                              }}
                              placeholder="Description..."
                              className="w-full px-2 py-1 text-[12px] bg-white border-0 rounded focus:outline-none focus:ring-1 focus:ring-[#1d1d1f]"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Fields */}
              {parsedTemplate?.fields && parsedTemplate.fields.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-[14px] font-semibold text-[#1d1d1f]">Fields</h3>
                  <div className="space-y-2">
                    {parsedTemplate.fields.map((field, index) => (
                      <div key={field.name} className="p-3 bg-[#f5f5f7] rounded-lg">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[13px] font-medium text-[#1d1d1f]">{field.name}</span>
                              <span className="px-1.5 py-0.5 text-[10px] font-medium text-[#6e6e73] bg-white rounded">
                                {field.type}
                              </span>
                            </div>
                            <input
                              type="text"
                              value={field.description}
                              onChange={(e) => {
                                try {
                                  const parsed = JSON.parse(jsonText);
                                  if (parsed.fields?.[index]) {
                                    parsed.fields[index].description = e.target.value;
                                    setJsonText(JSON.stringify(parsed, null, 2));
                                  }
                                } catch { /* ignore */ }
                              }}
                              placeholder="Description..."
                              className="w-full px-2 py-1 text-[12px] bg-white border-0 rounded focus:outline-none focus:ring-1 focus:ring-[#1d1d1f] mb-1"
                            />
                            {field.example !== undefined && (
                              <p className="text-[10px] text-[#86868b] italic">
                                Example: {typeof field.example === "object" ? JSON.stringify(field.example) : String(field.example)}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {(!parsedTemplate?.fields || parsedTemplate.fields.length === 0) &&
               (!parsedTemplate?.assetSlots || parsedTemplate.assetSlots.length === 0) && (
                <div className="text-center py-8 text-[#86868b]">
                  <p className="text-[13px]">No fields or assets defined</p>
                  <p className="text-[11px] mt-1">Edit the Code tab to add template fields</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "code" && (
            <div className="h-[400px] flex flex-col gap-2">
              <p className="text-[11px] text-[#86868b]">
                SVG template code
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
            <div className="h-[400px] flex flex-col gap-2">
              <p className="text-[12px] text-[#86868b]">
                Preview with placeholder values
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
      </>
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
          <div>
            <h2 className="text-[17px] font-semibold text-[#1d1d1f]">
              {isCreating ? "New Template" : "Edit Template"}
            </h2>
            {isCreating && (
              <p className="text-[12px] text-[#86868b] mt-0.5">
                The agent will generate an editable template with placeholder fields from your reference
              </p>
            )}
          </div>
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

          {/* Save button - available when we have at least one version or when editing */}
          {(!isCreating || hasAnyVersion) && (
            <button
              onClick={() => {
                // If generating, stop first and use latest version
                if (isGenerating) {
                  const latestVersion = versions[versions.length - 1];
                  if (latestVersion?.templateCode) {
                    setCode(latestVersion.templateCode);
                  }
                  cancelGeneration();
                }
                handleSave();
              }}
              disabled={isSaving || !!jsonError}
              className="px-4 py-2 text-[14px] font-medium text-white bg-[#1d1d1f] rounded-lg
                        hover:bg-[#424245] disabled:opacity-40 disabled:cursor-not-allowed
                        transition-all duration-200"
            >
              {isSaving ? "Saving..." : isGenerating ? `Save V${versions[versions.length - 1]?.version || 1}` : "Save"}
            </button>
          )}
        </div>
      </div>

      {/* Asset Bank Modal */}
      <AssetBankModal
        isOpen={showAssetModal}
        onClose={() => setShowAssetModal(false)}
        selectedAssets={selectedAssets}
        onToggleAsset={handleToggleAsset}
      />
    </div>
  );
}
