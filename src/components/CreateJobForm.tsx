"use client";

import { useState, useRef, useEffect } from "react";
import { useTemplates, useSaveTemplate, useTemplate } from "@/hooks/useTemplates";
import { streamCreateJob } from "@/hooks/useJobs";
import { Asset } from "@/hooks/useAssetBank";
import { TemplateEditorModal } from "./TemplateEditorModal";
import { AssetBankModal } from "./AssetBankModal";
import { Template } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

interface CreateJobFormProps {
  onJobCreated: (jobId: string, prompt?: string, files?: { name: string; type: string }[]) => void;
}

export function CreateJobForm({ onJobCreated }: CreateJobFormProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Template editor state
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Asset bank state
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);

  // Template preview state
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const { data: editingTemplate } = useTemplate(editingTemplateId);
  const saveTemplate = useSaveTemplate();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpenFor(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleAssetSelection = (asset: Asset) => {
    setSelectedAssets(prev => {
      const isSelected = prev.some(a => a.id === asset.id);
      if (isSelected) {
        return prev.filter(a => a.id !== asset.id);
      } else {
        return [...prev, asset];
      }
    });
  };

  const handleEditTemplate = (templateId: string) => {
    setEditingTemplateId(templateId);
    setMenuOpenFor(null);
  };

  const handleCreateTemplate = () => {
    setIsCreatingTemplate(true);
  };

  const handleSaveTemplate = async (template: Template, code?: string) => {
    await saveTemplate.mutateAsync({ template, code });
  };

  const handleCloseModal = () => {
    setEditingTemplateId(null);
    setIsCreatingTemplate(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplate) return;

    // Generate job ID client-side
    const jobId = uuidv4();

    // Combine file info from both uploaded files and selected assets
    const allFileInfo: { name: string; type: string }[] = [];
    if (files.length > 0) {
      allFileInfo.push(...files.map(f => ({ name: f.name, type: f.type })));
    }
    if (selectedAssets.length > 0) {
      allFileInfo.push(...selectedAssets.map(a => ({
        name: a.filename,
        type: a.type === "image" ? "image/png" : "application/octet-stream"
      })));
    }

    // Start streaming
    setIsStreaming(true);
    setLiveStatus("Starting...");
    setStreamError(null);

    await streamCreateJob(
      jobId,
      selectedTemplate,
      files,
      prompt || undefined,
      selectedAssets.length > 0 ? selectedAssets.map(a => a.id) : undefined,
      // onTrace - update live status
      (trace) => {
        if (trace.type === "status") {
          setLiveStatus(trace.content);
        }
      },
      // onResult - navigate to job page
      () => {
        setIsStreaming(false);
        setLiveStatus(null);
        onJobCreated(jobId, prompt || undefined, allFileInfo.length > 0 ? allFileInfo : undefined);
      },
      // onError
      (error) => {
        setIsStreaming(false);
        setLiveStatus(null);
        setStreamError(error);
      }
    );
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };


  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Template Selection - Thumbnails */}
      <div>
        <label className="block text-[13px] font-medium text-[#1d1d1f] mb-3">
          Choose Template
        </label>
        {templatesLoading ? (
          <div className="flex gap-4">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="w-32 h-40 bg-[#f5f5f7] rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {templates?.map((template) => (
              <div key={template.id} className="relative">
                <button
                  type="button"
                  onClick={() => setSelectedTemplate(prev => prev === template.id ? "" : template.id)}
                  className={`
                    relative w-32 flex flex-col rounded-xl overflow-hidden transition-all duration-200
                    ${
                      selectedTemplate === template.id
                        ? "ring-2 ring-[#1d1d1f] ring-offset-2 scale-[1.02]"
                        : "hover:scale-[1.02] hover:shadow-md"
                    }
                  `}
                >
                  {/* Thumbnail Preview */}
                  <div className="h-32 bg-[#f5f5f7] overflow-hidden">
                    <img
                      src={`/api/templates/${template.id}/thumbnail`}
                      alt={template.name}
                      className="w-full h-full object-cover object-top"
                    />
                  </div>
                  {/* Template Name */}
                  <div className="p-2 bg-white border border-t-0 border-[#e8e8ed] rounded-b-xl">
                    <p className="text-[11px] font-medium text-[#1d1d1f] text-center truncate">
                      {template.name}
                    </p>
                  </div>
                  {/* Selected Checkmark */}
                  {selectedTemplate === template.id && (
                    <div className="absolute top-2 left-2 w-5 h-5 bg-[#1d1d1f] rounded-full flex items-center justify-center">
                      <svg
                        className="w-3 h-3 text-white"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    </div>
                  )}
                </button>

                {/* 3-dot menu button */}
                <div className="absolute top-1.5 right-1.5" ref={menuOpenFor === template.id ? menuRef : undefined}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenFor(menuOpenFor === template.id ? null : template.id);
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-white/80 hover:bg-white shadow-sm transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-[#1d1d1f]" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                    </svg>
                  </button>

                  {/* Dropdown menu */}
                  {menuOpenFor === template.id && (
                    <div className="absolute right-0 top-7 w-32 bg-white rounded-lg shadow-lg border border-[#e8e8ed] py-1 z-10">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewTemplateId(template.id);
                          setMenuOpenFor(null);
                        }}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditTemplate(template.id);
                        }}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                      >
                        Edit Template
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Add Template Card */}
            <button
              type="button"
              onClick={handleCreateTemplate}
              className="w-32 flex flex-col rounded-xl overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-md border-2 border-dashed border-[#d2d2d7] hover:border-[#86868b]"
            >
              <div className="h-32 bg-[#f5f5f7] flex items-center justify-center">
                <svg className="w-8 h-8 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <div className="p-2 bg-white border border-t-0 border-[#e8e8ed] rounded-b-xl">
                <p className="text-[11px] font-medium text-[#86868b] text-center">
                  Add Template
                </p>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Provide context */}
      <div>
        <label className="block text-[13px] font-medium text-[#1d1d1f] mb-3">
          Provide context
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xlsm,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={handleFileChange}
          className="hidden"
          multiple
        />
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            relative bg-[#f5f5f7] rounded-2xl overflow-hidden
            transition-all duration-200
            ${isDragging ? "ring-2 ring-[#1d1d1f] ring-offset-1 bg-white" : "ring-0 outline-none"}
          `}
        >
          {/* Text input */}
          <textarea
            id="prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Upload product documents (XLSX, PDF, images) and add any instructions..."
            rows={2}
            className="w-full px-4 py-3 bg-transparent text-[14px] text-[#1d1d1f]
                      placeholder-[#86868b] border-0 resize-none
                      focus:outline-none focus:ring-0 focus:border-0
                      focus-visible:outline-none focus-visible:ring-0"
          />

          {/* Bottom row - buttons and inline attachments */}
          <div className="flex items-center gap-2 px-4 pb-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 px-3 flex items-center gap-1.5 rounded-lg text-[13px] text-[#86868b]
                        hover:bg-white hover:text-[#1d1d1f]
                        transition-all duration-200"
              title="Attach files"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
              </svg>
              Attach
            </button>

            {/* Asset Bank Button */}
            <button
              type="button"
              onClick={() => setShowAssetModal(true)}
              className="h-9 px-3 flex items-center gap-1.5 rounded-lg text-[13px] text-[#86868b]
                        hover:bg-white hover:text-[#1d1d1f]
                        transition-all duration-200"
              title="Select from Asset Bank"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              Asset Bank
            </button>

            {/* Inline attachment thumbnails */}
            {(files.length > 0 || selectedAssets.length > 0) && (
              <div className="flex items-center gap-1.5 ml-2 overflow-x-auto max-w-[280px]">
                {/* Selected assets from bank */}
                {selectedAssets.map((asset) => (
                  <div
                    key={`asset-${asset.id}`}
                    className="relative flex-shrink-0 w-9 h-9 rounded-md overflow-hidden bg-white shadow-sm group ring-1 ring-[#0066CC]/40"
                  >
                    {asset.type === "image" ? (
                      <img
                        src={`/api/assets/${asset.id}`}
                        alt={asset.filename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#f0f0f0]">
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => toggleAssetSelection(asset)}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center
                                opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                {/* Uploaded files */}
                {files.map((file, index) => (
                  <div
                    key={`${file.name}-${index}`}
                    className="relative flex-shrink-0 w-9 h-9 rounded-md overflow-hidden bg-white shadow-sm group"
                  >
                    {file.type.startsWith("image/") ? (
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-[#f0f0f0]">
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center
                                opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!selectedTemplate || isStreaming}
        className="w-full px-6 py-3.5 text-[15px] font-medium text-white bg-[#1d1d1f] rounded-xl
                  hover:bg-[#424245] active:scale-[0.98]
                  focus:outline-none focus:ring-2 focus:ring-[#1d1d1f] focus:ring-offset-2
                  disabled:bg-[#d2d2d7] disabled:cursor-not-allowed
                  transition-all duration-200"
      >
        {isStreaming ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            {liveStatus || "Processing..."}
          </span>
        ) : (
          "Create Document"
        )}
      </button>

      {streamError && (
        <div className="p-4 bg-red-50 rounded-xl">
          <p className="text-[13px] text-red-600">
            {streamError}
          </p>
        </div>
      )}

      {/* Template Preview Modal */}
      {previewTemplateId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPreviewTemplateId(null)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e8ed]">
              <span className="text-[15px] font-medium text-[#1d1d1f]">
                Template Preview
              </span>
              <button
                type="button"
                onClick={() => setPreviewTemplateId(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
              >
                <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-6 bg-[#f5f5f7]">
              <img
                src={`/api/templates/${previewTemplateId}/thumbnail`}
                alt="Template preview"
                className="max-w-full h-auto rounded-xl shadow-lg mx-auto"
                style={{ maxHeight: "75vh", minWidth: "500px" }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Template Editor Modal */}
      <TemplateEditorModal
        template={editingTemplate || null}
        isOpen={!!editingTemplateId || isCreatingTemplate}
        onClose={handleCloseModal}
        onSave={handleSaveTemplate}
        isCreating={isCreatingTemplate}
      />

      {/* Asset Bank Modal */}
      <AssetBankModal
        isOpen={showAssetModal}
        onClose={() => setShowAssetModal(false)}
        selectedAssets={selectedAssets}
        onToggleAsset={toggleAssetSelection}
      />
    </form>
  );
}
