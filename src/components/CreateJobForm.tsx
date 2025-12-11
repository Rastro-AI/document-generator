"use client";

import { useState, useRef, useEffect } from "react";
import { useTemplates, useSaveTemplate, useTemplate, useDeleteTemplate } from "@/hooks/useTemplates";
import { Asset } from "@/hooks/useAssetBank";
import { TemplateEditorModal } from "./TemplateEditorModal";
import { AssetBankModal } from "./AssetBankModal";
import { Template } from "@/lib/types";
import { v4 as uuidv4 } from "uuid";

type ReasoningMode = "none" | "low";

interface CreateJobFormProps {
  onJobCreated: (data: {
    jobId: string;
    templateId: string;
    prompt?: string;
    files?: File[];
    assetIds?: string[];
    reasoningMode?: ReasoningMode;
  }) => void;
}

export function CreateJobForm({ onJobCreated }: CreateJobFormProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [prompt, setPrompt] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>("none");
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

  // File preview state
  const [previewFile, setPreviewFile] = useState<{ type: 'file' | 'asset'; index?: number; asset?: Asset; file?: File } | null>(null);


  const { data: templates, isLoading: templatesLoading } = useTemplates();
  const { data: editingTemplate } = useTemplate(editingTemplateId);
  const saveTemplate = useSaveTemplate();
  const deleteTemplate = useDeleteTemplate();

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

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm("Are you sure you want to delete this template?")) return;
    setMenuOpenFor(null);
    if (selectedTemplate === templateId) {
      setSelectedTemplate("");
    }
    await deleteTemplate.mutateAsync(templateId);
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

    // Generate job ID client-side and navigate immediately
    const jobId = uuidv4();

    // Navigate immediately - streaming will happen in JobEditor
    onJobCreated({
      jobId,
      templateId: selectedTemplate,
      prompt: prompt || undefined,
      files: files.length > 0 ? files : undefined,
      assetIds: selectedAssets.length > 0 ? selectedAssets.map(a => a.id) : undefined,
      reasoningMode: reasoningMode,
    });
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
                    relative w-32 flex flex-col rounded-xl overflow-hidden transition-all duration-200 border border-[#e8e8ed]
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
                  <div className="p-2 bg-white border-t border-[#e8e8ed]">
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

                {/* Settings button */}
                <div className="absolute top-1.5 right-1.5" ref={menuOpenFor === template.id ? menuRef : undefined}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenFor(menuOpenFor === template.id ? null : template.id);
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded-md bg-white/80 hover:bg-white shadow-sm transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteTemplate(template.id);
                        }}
                        className="w-full px-3 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 transition-colors"
                      >
                        Delete
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
              className="w-32 flex flex-col rounded-xl overflow-hidden transition-all duration-200 hover:scale-[1.02] hover:shadow-md border border-[#e8e8ed] hover:border-[#86868b]"
            >
              <div className="h-32 bg-[#f5f5f7] flex items-center justify-center">
                <svg className="w-8 h-8 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </div>
              <div className="p-2 bg-white border-t border-[#e8e8ed]">
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
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && selectedTemplate) {
                e.preventDefault();
                handleSubmit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="Upload product documents (XLSX, PDF, images) and add any instructions..."
            rows={2}
            className="w-full px-4 py-3 bg-transparent text-[14px] text-[#1d1d1f]
                      placeholder-[#86868b] border-0 resize-none
                      focus:outline-none focus:ring-0 focus:border-0
                      focus-visible:outline-none focus-visible:ring-0"
          />

          {/* Bottom row - buttons left, mode+submit right */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium text-[#86868b]
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
                className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium text-[#86868b]
                          hover:bg-white hover:text-[#1d1d1f]
                          transition-all duration-200"
                title="Select from Asset Bank"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                Asset Bank
              </button>

              {/* Inline attachment thumbnails - clickable to preview */}
              {(files.length > 0 || selectedAssets.length > 0) && (
                <div className="flex items-center gap-1.5 ml-2 overflow-x-auto max-w-[200px]">
                  {/* Selected assets from bank */}
                  {selectedAssets.map((asset) => (
                    <button
                      key={`asset-${asset.id}`}
                      type="button"
                      onClick={() => setPreviewFile({ type: 'asset', asset })}
                      className="relative flex-shrink-0 w-8 h-8 rounded-md overflow-hidden bg-white shadow-sm ring-1 ring-[#86868b]/30 hover:ring-[#1d1d1f]/50 transition-all cursor-pointer"
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
                    </button>
                  ))}
                  {/* Uploaded files */}
                  {files.map((file, index) => (
                    <button
                      key={`${file.name}-${index}`}
                      type="button"
                      onClick={() => setPreviewFile({ type: 'file', index, file })}
                      className="relative flex-shrink-0 w-8 h-8 rounded-md overflow-hidden bg-white shadow-sm ring-1 ring-[#86868b]/30 hover:ring-[#1d1d1f]/50 transition-all cursor-pointer"
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
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Fast/Slow Mode Toggle */}
              <button
                type="button"
                onClick={() => setReasoningMode(reasoningMode === "none" ? "low" : "none")}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-[12px] font-medium bg-white border border-[#e8e8ed] text-[#86868b] hover:text-[#1d1d1f] hover:border-[#d2d2d7] transition-all duration-200"
                title={reasoningMode === "low" ? "Slow mode (more reasoning)" : "Fast mode (no reasoning)"}
              >
                {reasoningMode === "low" ? (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    Slow
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Fast
                  </>
                )}
              </button>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!selectedTemplate}
                className="h-8 px-3 flex items-center justify-center gap-1.5 rounded-lg bg-[#1d1d1f] text-white
                          hover:bg-[#424245] active:scale-[0.95]
                          disabled:bg-[#d2d2d7] disabled:cursor-not-allowed
                          transition-all duration-200 text-[13px] font-medium"
              >
                Go
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

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

      {/* File Preview Modal */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#e8e8ed]">
              <span className="text-[15px] font-medium text-[#1d1d1f] truncate max-w-[400px]">
                {previewFile.type === 'asset' ? previewFile.asset?.filename : previewFile.file?.name}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (previewFile.type === 'asset' && previewFile.asset) {
                      toggleAssetSelection(previewFile.asset);
                    } else if (previewFile.type === 'file' && previewFile.index !== undefined) {
                      removeFile(previewFile.index);
                    }
                    setPreviewFile(null);
                  }}
                  className="px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewFile(null)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
                >
                  <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Content */}
            <div className="p-6 bg-[#f5f5f7] flex items-center justify-center min-h-[300px]">
              {previewFile.type === 'asset' && previewFile.asset?.type === 'image' ? (
                <img
                  src={`/api/assets/${previewFile.asset.id}`}
                  alt={previewFile.asset.filename}
                  className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg"
                />
              ) : previewFile.type === 'file' && previewFile.file?.type.startsWith('image/') ? (
                <img
                  src={URL.createObjectURL(previewFile.file)}
                  alt={previewFile.file.name}
                  className="max-w-full max-h-[60vh] object-contain rounded-lg shadow-lg"
                />
              ) : (
                <div className="text-center">
                  <svg className="w-16 h-16 text-[#86868b] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-[14px] font-medium text-[#1d1d1f]">
                    {previewFile.type === 'asset' ? previewFile.asset?.filename : previewFile.file?.name}
                  </p>
                  <p className="text-[12px] text-[#86868b] mt-1">
                    {previewFile.type === 'file' && previewFile.file
                      ? `${(previewFile.file.size / 1024).toFixed(1)} KB`
                      : 'Document file'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
