"use client";

import { useState, useRef, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";

interface IdmlAnalysis {
  textPlaceholders: Array<{
    name: string;
    storyFile: string;
    context: string;
  }>;
  namedRectangles: Array<{
    name: string;
    spreadFile: string;
    hasExistingImage: boolean;
  }>;
  pageCount: number;
  dimensions?: {
    width: number;
    height: number;
  };
}

interface FieldConfig {
  name: string;
  type: "text" | "textarea" | "number";
  description: string;
  required: boolean;
}

interface AssetSlotConfig {
  name: string;
  description: string;
  required: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onTemplateCreated?: () => void;
}

export function IdmlTemplateUploadModal({ isOpen, onClose, onTemplateCreated }: Props) {
  const [step, setStep] = useState<"upload" | "configure">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<IdmlAnalysis | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([]);
  const [assetSlotConfigs, setAssetSlotConfigs] = useState<AssetSlotConfig[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate preview when file is analyzed
  useEffect(() => {
    if (file && analysis && step === "configure") {
      generatePreview();
    }
  }, [file, analysis, step]);

  const generatePreview = async () => {
    if (!file) return;

    setIsGeneratingPreview(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("action", "preview");

      const res = await fetch("/api/templates/upload", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }
    } catch (err) {
      console.error("Failed to generate preview:", err);
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith(".idml")) {
      setError("Please select an IDML file");
      return;
    }

    setFile(selectedFile);
    setError(null);
    setIsAnalyzing(true);
    setPreviewUrl(null);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("action", "analyze");

    try {
      const res = await fetch("/api/templates/upload", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();

      if (!result.success) {
        setError(result.error || "Failed to analyze IDML");
        setIsAnalyzing(false);
        return;
      }

      setAnalysis(result.analysis);

      // Generate default template name from filename
      setTemplateName(selectedFile.name.replace(".idml", ""));

      // Initialize field configs from detected placeholders
      const fields: FieldConfig[] = result.analysis.textPlaceholders.map((p: { name: string; context: string }) => ({
        name: p.name,
        type: p.name.includes("DESCRIPTION") || p.name.includes("TEXT") ? "textarea" : "text",
        description: inferDescription(p.name, p.context),
        required: true,
      }));
      setFieldConfigs(fields);

      // Initialize asset slot configs from named rectangles
      const slots: AssetSlotConfig[] = result.analysis.namedRectangles.map((r: { name: string }) => ({
        name: r.name,
        description: inferAssetDescription(r.name),
        required: false,
      }));
      setAssetSlotConfigs(slots);

      setStep("configure");
    } catch (err) {
      setError("Failed to analyze IDML file");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const inferDescription = (name: string, context: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes("product_name") || lower.includes("title")) return "Product or item name";
    if (lower.includes("description")) return "Detailed description text";
    if (lower.includes("price")) return "Price value";
    if (lower.includes("model")) return "Model number or identifier";
    if (lower.includes("spec")) return "Technical specification";
    if (lower.includes("feature")) return "Feature description";
    if (context) return context.substring(0, 50);
    return "Text content";
  };

  const inferAssetDescription = (name: string): string => {
    const lower = name.toLowerCase();
    if (lower.includes("product")) return "Product photo or image";
    if (lower.includes("logo")) return "Company or brand logo";
    if (lower.includes("hero")) return "Main hero image";
    if (lower.includes("icon")) return "Icon or symbol";
    if (lower.includes("background") || lower.includes("bg")) return "Background image";
    return "Image asset";
  };

  const handleCreate = async () => {
    if (!file || !templateName) {
      setError("Please enter a template name");
      return;
    }

    setIsCreating(true);
    setError(null);

    // Generate template ID from name
    const templateId = templateName.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + uuidv4().slice(0, 8);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("action", "create");
    formData.append("templateId", templateId);
    formData.append("templateName", templateName);
    formData.append("fieldConfigs", JSON.stringify(fieldConfigs));
    formData.append("assetSlotConfigs", JSON.stringify(assetSlotConfigs));

    try {
      const res = await fetch("/api/templates/upload", {
        method: "POST",
        body: formData,
      });
      const result = await res.json();

      if (!result.success) {
        setError(result.error || "Failed to create template");
        setIsCreating(false);
        return;
      }

      onTemplateCreated?.();
      handleClose();
    } catch (err) {
      setError("Failed to create template");
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setStep("upload");
    setFile(null);
    setAnalysis(null);
    setTemplateName("");
    setFieldConfigs([]);
    setAssetSlotConfigs([]);
    setError(null);
    setPreviewUrl(null);
    onClose();
  };

  const updateFieldDescription = (index: number, description: string) => {
    const updated = [...fieldConfigs];
    updated[index].description = description;
    setFieldConfigs(updated);
  };

  const updateFieldType = (index: number, type: "text" | "textarea" | "number") => {
    const updated = [...fieldConfigs];
    updated[index].type = type;
    setFieldConfigs(updated);
  };

  const updateAssetDescription = (index: number, description: string) => {
    const updated = [...assetSlotConfigs];
    updated[index].description = description;
    setAssetSlotConfigs(updated);
  };

  const addAssetSlot = () => {
    const name = `IMAGE_${assetSlotConfigs.length + 1}`;
    setAssetSlotConfigs([
      ...assetSlotConfigs,
      { name, description: "Image asset", required: false }
    ]);
  };

  const removeAssetSlot = (index: number) => {
    setAssetSlotConfigs(assetSlotConfigs.filter((_, i) => i !== index));
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                {step === "upload" ? "New Template" : templateName || "Configure Template"}
              </h2>
              <p className="text-xs text-gray-500">
                {step === "upload" ? "Upload an InDesign IDML file" : `${fieldConfigs.length} fields · ${assetSlotConfigs.length} images`}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {step === "upload" ? (
            <div className="flex-1 p-8 flex items-center justify-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".idml"
                onChange={handleFileSelect}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-full max-w-md aspect-[4/3] flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-2xl cursor-pointer hover:border-gray-900 hover:bg-gray-50 transition-all group"
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-12 h-12 border-3 border-gray-900 border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-sm font-medium text-gray-900">Analyzing template...</p>
                    <p className="text-xs text-gray-500 mt-1">Detecting fields and image slots</p>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-gray-900 mb-1">Upload IDML file</p>
                    <p className="text-xs text-gray-500 text-center max-w-xs">
                      Drag and drop or click to browse. Export from InDesign via File → Export → InDesign Markup.
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Preview Panel */}
              <div className="w-1/2 bg-gray-50 border-r border-gray-100 p-6 flex flex-col">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Preview</div>
                <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex items-center justify-center">
                  {isGeneratingPreview ? (
                    <div className="text-center">
                      <div className="w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-xs text-gray-500">Generating preview...</p>
                    </div>
                  ) : previewUrl ? (
                    <img src={previewUrl} alt="Template preview" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <svg className="w-12 h-12 mx-auto mb-2 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <p className="text-xs">Preview unavailable</p>
                    </div>
                  )}
                </div>
                {analysis && (
                  <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
                    <span>{analysis.pageCount} page{analysis.pageCount > 1 ? "s" : ""}</span>
                    {analysis.dimensions && (
                      <span>{Math.round(analysis.dimensions.width)} × {Math.round(analysis.dimensions.height)} pt</span>
                    )}
                  </div>
                )}
              </div>

              {/* Configuration Panel */}
              <div className="w-1/2 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {error && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-xs">
                      {error}
                    </div>
                  )}

                  {/* Template Info */}
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Template Info</div>
                    <div>
                      <label className="block text-xs text-gray-600 mb-1">Name</label>
                      <input
                        type="text"
                        value={templateName}
                        onChange={(e) => setTemplateName(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                        placeholder="My Template"
                      />
                    </div>
                  </div>

                  {/* Text Fields */}
                  {fieldConfigs.length > 0 && (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Text Fields ({fieldConfigs.length})
                      </div>
                      <div className="space-y-2">
                        {fieldConfigs.map((field, idx) => (
                          <div key={field.name} className="p-3 bg-gray-50 rounded-lg space-y-2">
                            <div className="flex items-center gap-2">
                              <code className="text-xs font-mono bg-white px-2 py-0.5 rounded border border-gray-200 text-gray-900">
                                {`{{${field.name}}}`}
                              </code>
                              <select
                                value={field.type}
                                onChange={(e) => updateFieldType(idx, e.target.value as "text" | "textarea" | "number")}
                                className="text-xs bg-white border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-gray-900"
                              >
                                <option value="text">Text</option>
                                <option value="textarea">Long Text</option>
                                <option value="number">Number</option>
                              </select>
                            </div>
                            <input
                              type="text"
                              value={field.description}
                              onChange={(e) => updateFieldDescription(idx, e.target.value)}
                              placeholder="Description for this field..."
                              className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-900"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Image Slots */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Image Slots ({assetSlotConfigs.length})
                      </div>
                      <button
                        onClick={addAssetSlot}
                        className="text-xs text-gray-900 hover:text-gray-600 font-medium"
                      >
                        + Add slot
                      </button>
                    </div>
                    {assetSlotConfigs.length === 0 ? (
                      <p className="text-xs text-gray-400 italic py-2">
                        No image slots detected. Add slots for dynamic images.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {assetSlotConfigs.map((slot, idx) => (
                          <div key={slot.name} className="p-3 bg-gray-100 rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                              <code className="text-xs font-mono bg-white px-2 py-0.5 rounded border border-gray-300 text-gray-900">
                                {slot.name}
                              </code>
                              <button
                                onClick={() => removeAssetSlot(idx)}
                                className="text-gray-400 hover:text-gray-900 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            <input
                              type="text"
                              value={slot.description}
                              onChange={(e) => updateAssetDescription(idx, e.target.value)}
                              placeholder="Description for this image..."
                              className="w-full px-2 py-1.5 text-xs bg-white border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-900"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex items-center justify-between">
                  <button
                    onClick={() => {
                      setStep("upload");
                      setFile(null);
                      setAnalysis(null);
                      setPreviewUrl(null);
                    }}
                    className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    ← Choose different file
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={isCreating || !templateName}
                    className="px-4 py-2 bg-black text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                  >
                    {isCreating && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    Create Template
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
