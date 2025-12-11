"use client";

import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useJob, useUpdateJobFields, useUpdateJobAssets, useUploadJobAsset, useRenderJob, streamCreateJob } from "@/hooks/useJobs";
import { useTemplate } from "@/hooks/useTemplates";
import { FieldsEditor } from "./FieldsEditor";
import { PdfPreview } from "./PdfPreview";
import { ChatPanel } from "./ChatPanel";

type ReasoningMode = "none" | "low";

interface JobEditorProps {
  jobId: string;
  templateId: string;
  onBack: () => void;
  initialPrompt?: string;
  initialFiles?: File[];
  initialAssetIds?: string[];
  initialReasoningMode?: ReasoningMode;
}

export function JobEditor({ jobId, templateId, onBack, initialPrompt, initialFiles, initialAssetIds, initialReasoningMode }: JobEditorProps) {
  const queryClient = useQueryClient();
  const { data: job, isLoading: jobLoading, error: jobError, refetch } = useJob(jobId);
  const { data: template, isLoading: templateLoading } = useTemplate(
    job?.templateId || templateId || null
  );

  // Initial creation streaming state - always true if we have a templateId (streaming will happen)
  const [isCreating, setIsCreating] = useState(!!templateId);
  const [creationStatus, setCreationStatus] = useState<string>("Starting...");
  const [creationTraces, setCreationTraces] = useState<Array<{ type: "reasoning" | "tool_call" | "tool_result" | "status"; content: string; toolName?: string }>>([]);
  const hasStartedCreation = useRef(false);

  const [localFields, setLocalFields] = useState<
    Record<string, string | number | null>
  >({});
  const [hasChanges, setHasChanges] = useState(false);
  const [pdfKey, setPdfKey] = useState(0);
  const [hasEdited, setHasEdited] = useState(false);

  const updateFields = useUpdateJobFields();
  const updateAssets = useUpdateJobAssets();
  const uploadAsset = useUploadJobAsset();
  const renderJob = useRenderJob();
  const hasAutoRendered = useRef(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [templateCode, setTemplateCode] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"preview" | "assets" | "data">("preview");
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  // Locally track the last render timestamp to drive preview updates immediately
  const [previewRenderedAt, setPreviewRenderedAt] = useState<string | undefined>(undefined);

  // Sync local fields when job data loads
  useEffect(() => {
    if (job) {
      setLocalFields(job.fields);
      setHasChanges(false);
      // Keep local preview timestamp in sync with server state
      setPreviewRenderedAt(job.renderedAt);
    }
  }, [job]);

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


  // Start job creation streaming when component mounts
  useEffect(() => {
    if (hasStartedCreation.current) return;
    if (!templateId) return;

    hasStartedCreation.current = true;

    streamCreateJob(
      jobId,
      templateId,
      initialFiles || [],
      initialPrompt,
      initialAssetIds,
      // onTrace
      (trace) => {
        if (trace.type === "status") {
          setCreationStatus(trace.content);
        }
        // Collect all traces for display in chat
        setCreationTraces(prev => [...prev, trace as { type: "reasoning" | "tool_call" | "tool_result" | "status"; content: string; toolName?: string }]);
      },
      // onResult
      (result) => {
        setIsCreating(false);
        console.log("[JobEditor] Creation complete, job:", result.job?.id, "initialMessage:", result.job?.initialMessage);
        // Use the returned job's renderedAt immediately to update preview
        if (result.job?.renderedAt) {
          console.log("[JobEditor] Creation complete, renderedAt:", result.job.renderedAt);
          setPreviewRenderedAt(result.job.renderedAt);
          setPdfKey(k => k + 1);
        }
        // Update the query cache directly with the returned job data
        // This ensures initialMessage is updated immediately without waiting for refetch
        if (result.job) {
          queryClient.setQueryData(["job", jobId], result.job);
        }
        refetch();
      },
      // onError
      (error) => {
        setIsCreating(false);
        setCreationStatus(`Error: ${error}`);
      },
      undefined, // signal
      initialReasoningMode // reasoning mode
    );
  }, [jobId, templateId, initialFiles, initialPrompt, initialAssetIds, initialReasoningMode, refetch]);

  // Auto-render once on first load if not already rendered
  useEffect(() => {
    if (job && !job.renderedAt && !hasAutoRendered.current && !renderJob.isPending && !isCreating) {
      hasAutoRendered.current = true;
      renderJob.mutateAsync({ jobId }).then((res) => {
        if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
        if (res?.renderedAt) console.log("[JobEditor] Auto-render complete:", res.renderedAt);
        setPdfKey((k) => k + 1);
      }).catch((error) => {
        console.error("Failed to auto-render:", error);
        hasAutoRendered.current = false; // Allow retry on error
      });
    }
  }, [job, jobId, isCreating]);

  const handleFieldChange = (name: string, value: string | number | null) => {
    setLocalFields((prev) => ({ ...prev, [name]: value }));
    setHasChanges(true);
    setHasEdited(true);
  };

  const handleAssetChange = async (name: string, value: string | null) => {
    if (!job) return;
    try {
      await updateAssets.mutateAsync({
        jobId,
        assets: { ...job.assets, [name]: value }
      });
      // Auto re-render after asset change
      const res = await renderJob.mutateAsync({ jobId });
      if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
      if (res?.renderedAt) console.log("[JobEditor] Render after asset change:", res.renderedAt);
      setPdfKey((k) => k + 1);
    } catch (error) {
      console.error("Failed to update asset:", error);
    }
  };

  const handleAssetUpload = async (slotName: string, file: File) => {
    try {
      const uploadResult = await uploadAsset.mutateAsync({ jobId, slotName, file });
      console.log("[JobEditor] Asset uploaded:", slotName, "->", uploadResult.assetPath);

      // Auto re-render after upload (DB has strong consistency now)
      const res = await renderJob.mutateAsync({ jobId });
      if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
      if (res?.renderedAt) console.log("[JobEditor] Render after asset upload:", res.renderedAt);
      setPdfKey((k) => k + 1);

      // Refetch to update local cache
      await refetch();
    } catch (error) {
      console.error("Failed to upload asset:", error);
    }
  };

  const handleSave = async () => {
    try {
      await updateFields.mutateAsync({ jobId, fields: localFields });
      setHasChanges(false);
      // Auto-render after save
      const res = await renderJob.mutateAsync({ jobId });
      if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
      if (res?.renderedAt) console.log("[JobEditor] Render after save:", res.renderedAt);
      setPdfKey((k) => k + 1);
    } catch (error) {
      console.error("Failed to save fields:", error);
    }
  };

  const handleRegenerate = async () => {
    if (hasChanges) {
      await handleSave();
    } else {
      try {
        const res = await renderJob.mutateAsync({ jobId });
        if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
        if (res?.renderedAt) console.log("[JobEditor] Manual render:", res.renderedAt);
        setPdfKey((k) => k + 1);
      } catch (error) {
        console.error("Failed to render:", error);
      }
    }
  };

  const handleFieldsUpdated = async (newFields: Record<string, string | number | null>) => {
    // Update local fields immediately with the server-provided values
    setLocalFields(newFields);
    setHasChanges(false);
    setHasEdited(true);

    // Auto-render after chat update (DB has strong consistency now)
    try {
      const res = await renderJob.mutateAsync({ jobId });
      if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
      if (res?.renderedAt) console.log("[JobEditor] Render after chat fields update:", res.renderedAt);
      setPdfKey((k) => k + 1);
      // Refetch after render to sync any other job state changes
      await refetch();
    } catch (error) {
      console.error("Failed to render after chat update:", error);
    }
  };

  const handleTemplateUpdated = async () => {
    console.log("[JobEditor] handleTemplateUpdated called - starting render");
    setHasEdited(true);
    // Auto-render after template change
    try {
      console.log("[JobEditor] Calling renderJob.mutateAsync...");
      const res = await renderJob.mutateAsync({ jobId });
      console.log("[JobEditor] Render complete, response:", res);
      if (res?.renderedAt) {
        console.log("[JobEditor] Setting previewRenderedAt to:", res.renderedAt);
        setPreviewRenderedAt(res.renderedAt);
      }
      setPdfKey((k) => k + 1);
      console.log("[JobEditor] PdfKey incremented");
    } catch (error) {
      console.error("Failed to render after template update:", error);
    }
  };

  const handleJobUpdated = async () => {
    setHasEdited(true);
    await refetch();
    // Auto-render after job update
    try {
      const res = await renderJob.mutateAsync({ jobId });
      if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
      if (res?.renderedAt) console.log("[JobEditor] Render after job update:", res.renderedAt);
      setPdfKey((k) => k + 1);
    } catch (error) {
      console.error("Failed to render after job update:", error);
    }
  };

  // Determine if we're ready to show the full UI
  const isReady = job && template;

  if (jobError && !job) {
    return (
      <div className="flex items-center justify-center h-screen bg-white">
        <div className="text-center">
          <p className="text-[17px] font-medium text-[#1d1d1f] mb-2">Failed to load</p>
          <button onClick={onBack} className="text-[15px] text-[#86868b] hover:text-[#1d1d1f]">
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Error banner */}
      {(updateFields.isError || renderJob.isError) && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-100">
          <p className="text-[13px] text-red-600">
            {updateFields.error?.message || renderJob.error?.message}
          </p>
        </div>
      )}

      {/* Main content - 2 column layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Chat panel (50%) */}
        <div className="w-1/2 flex flex-col bg-[#f5f5f7] p-4 pr-2">
          <div className="flex-1 min-h-0 bg-white rounded-xl overflow-hidden border border-[#d2d2d7] flex flex-col">
            <ChatPanel
              jobId={jobId}
              initialMessage={job?.initialMessage}
              uploadedFiles={job?.uploadedFiles}
              initialUserPrompt={initialPrompt}
              initialUserFiles={initialFiles?.map(f => ({ name: f.name, type: f.type }))}
              isCreating={isCreating}
              creationStatus={creationStatus}
              creationTraces={creationTraces}
              initialReasoningMode={initialReasoningMode}
              onFieldsUpdated={handleFieldsUpdated}
              onTemplateUpdated={handleTemplateUpdated}
              onFilesChanged={() => refetch()}
              onBack={onBack}
            />
          </div>
        </div>

        {/* Right: Preview/Assets/Data with tabs (50%) */}
        <div className="w-1/2 flex flex-col bg-[#f5f5f7] p-4 pl-2">
          <div className="flex-1 min-h-0 bg-white rounded-xl overflow-hidden border border-[#d2d2d7] flex flex-col">
            {/* Tabs + Actions */}
            <div className="flex-shrink-0 px-4 pt-3 pb-2 flex items-center justify-between">
              <div className="flex gap-1 p-1 bg-[#f5f5f7] rounded-lg w-fit">
                <button
                  onClick={() => setRightPanelTab("preview")}
                  className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                    rightPanelTab === "preview"
                      ? "bg-white text-[#1d1d1f] shadow-sm"
                      : "text-[#86868b] hover:text-[#1d1d1f]"
                  }`}
                >
                  Preview
                </button>
                <button
                  onClick={() => setRightPanelTab("assets")}
                  className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                    rightPanelTab === "assets"
                      ? "bg-white text-[#1d1d1f] shadow-sm"
                      : "text-[#86868b] hover:text-[#1d1d1f]"
                  }`}
                >
                  Assets
                </button>
                <button
                  onClick={() => setRightPanelTab("data")}
                  className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                    rightPanelTab === "data"
                      ? "bg-white text-[#1d1d1f] shadow-sm"
                      : "text-[#86868b] hover:text-[#1d1d1f]"
                  }`}
                >
                  Data
                </button>
              </div>

              {/* Actions: Export and History dropdowns */}
              {isReady && (
                <div className="flex items-center gap-2">
                  {/* Save button when there are changes */}
                  {hasChanges && (
                    <button
                      onClick={handleSave}
                      disabled={updateFields.isPending || renderJob.isPending}
                      className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#1d1d1f] rounded-md
                                hover:bg-[#424245] active:scale-[0.98]
                                disabled:opacity-40 disabled:cursor-not-allowed
                                transition-all duration-200"
                    >
                      {updateFields.isPending || renderJob.isPending ? "Saving..." : "Save"}
                    </button>
                  )}

                  {/* Export dropdown */}
                  {job.renderedAt && (
                    <div className="relative" ref={exportMenuRef}>
                      <button
                        onClick={() => setShowExportMenu(!showExportMenu)}
                        className="px-3 py-1.5 text-[12px] font-medium text-[#86868b] hover:text-[#1d1d1f] rounded-md hover:bg-[#f5f5f7] transition-colors flex items-center gap-1"
                      >
                        Export
                        <svg className={`w-3 h-3 transition-transform ${showExportMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {showExportMenu && (
                        <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-[#e8e8ed] py-1 z-50">
                          <a
                            href={`/api/jobs/${jobId}/pdf?t=${(previewRenderedAt || job.renderedAt) ?? Date.now()}`}
                            download="output.pdf"
                            onClick={() => setShowExportMenu(false)}
                            className="block w-full px-3 py-2 text-left text-[12px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                          >
                            PDF
                          </a>
                          <a
                            href={`/api/jobs/${jobId}/svg?t=${(previewRenderedAt || job.renderedAt) ?? Date.now()}`}
                            download="output.svg"
                            onClick={() => setShowExportMenu(false)}
                            className="block w-full px-3 py-2 text-left text-[12px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                          >
                            SVG
                          </a>
                          <button
                            onClick={async () => {
                              setShowExportMenu(false);
                              const res = await fetch(`/api/jobs/${job.id}/template-code`);
                              if (res.ok) {
                                setTemplateCode(await res.text());
                                setShowCodeModal(true);
                              }
                            }}
                            className="block w-full px-3 py-2 text-left text-[12px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                          >
                            Code
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* History dropdown */}
                  <div className="relative" ref={historyMenuRef}>
                    <button
                      onClick={() => setShowHistoryMenu(!showHistoryMenu)}
                      className={`px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors flex items-center gap-1 ${
                        showHistoryMenu
                          ? "text-[#1d1d1f] bg-[#f5f5f7]"
                          : "text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7]"
                      }`}
                    >
                      History
                      <svg className={`w-3 h-3 transition-transform ${showHistoryMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {showHistoryMenu && (
                      <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-lg shadow-lg border border-[#e8e8ed] py-1 z-50 max-h-80 overflow-y-auto">
                        {job.history && job.history.length > 0 ? (
                          [...job.history].reverse().map((entry, index) => (
                            <div
                              key={entry.id}
                              className={`px-3 py-2 flex items-center justify-between gap-2 ${
                                index === 0 ? "bg-[#f5f5f7]" : "hover:bg-[#f5f5f7]"
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-[12px] font-medium text-[#1d1d1f] truncate">
                                  {entry.description}
                                </p>
                                <p className="text-[10px] text-[#86868b]">
                                  {new Date(entry.timestamp).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </p>
                              </div>
                              {index === 0 ? (
                                <span className="text-[10px] text-[#86868b]">Current</span>
                              ) : (
                                <button
                                  onClick={async () => {
                                    setShowHistoryMenu(false);
                                    try {
                                      await fetch(`/api/jobs/${job.id}/history/${entry.id}/restore`, { method: "POST" });
                                      await handleJobUpdated();
                                    } catch (error) {
                                      console.error("Failed to restore:", error);
                                    }
                                  }}
                                  className="px-2 py-1 text-[10px] font-medium text-[#1d1d1f] bg-white border border-[#d2d2d7] rounded hover:bg-[#f5f5f7] transition-colors"
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="px-3 py-4 text-center text-[12px] text-[#86868b]">
                            No history yet
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {/* Preview tab */}
              {rightPanelTab === "preview" && (
                <div className="h-full p-4 relative">
                  {isReady ? (
                    <>
                      <PdfPreview key={pdfKey} jobId={jobId} renderedAt={previewRenderedAt || job.renderedAt} isRendering={renderJob.isPending} />
                      {/* Preview action buttons */}
                      <div className="absolute top-6 right-6 flex gap-2">
                        {/* Refresh button */}
                        <button
                          onClick={() => {
                            renderJob.mutateAsync({ jobId }).then((res) => {
                              if (res?.renderedAt) setPreviewRenderedAt(res.renderedAt);
                            });
                          }}
                          disabled={renderJob.isPending}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 hover:bg-white shadow-sm transition-colors disabled:opacity-50"
                          title="Refresh preview"
                        >
                          <svg className={`w-4 h-4 text-[#1d1d1f] ${renderJob.isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        {/* Expand button */}
                        <button
                          onClick={() => setPdfExpanded(true)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 hover:bg-white shadow-sm transition-colors"
                          title="Expand preview"
                        >
                          <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                          </svg>
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center">
                      <svg className="animate-spin h-8 w-8 text-[#86868b] mb-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">Creating document...</p>
                      <p className="text-[13px] text-[#86868b]">{isCreating ? creationStatus : "Loading..."}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Assets tab */}
              {rightPanelTab === "assets" && (
                <div className="h-full overflow-y-auto p-6">
                  {isReady ? (
                    <FieldsEditor
                      template={template}
                      job={job}
                      localFields={localFields}
                      onFieldChange={handleFieldChange}
                      onAssetChange={handleAssetChange}
                      onAssetUpload={handleAssetUpload}
                      onSave={hasChanges ? handleSave : undefined}
                      disabled={updateFields.isPending || updateAssets.isPending || uploadAsset.isPending}
                      activeTab="assets"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16">
                      <svg className="animate-spin h-6 w-6 text-[#86868b] mb-3" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-[13px] text-[#86868b]">Loading assets...</p>
                    </div>
                  )}
                </div>
              )}

              {/* Data tab */}
              {rightPanelTab === "data" && (
                <div className="h-full overflow-y-auto p-6">
                  {isReady ? (
                    <FieldsEditor
                      template={template}
                      job={job}
                      localFields={localFields}
                      onFieldChange={handleFieldChange}
                      onAssetChange={handleAssetChange}
                      onAssetUpload={handleAssetUpload}
                      onSave={hasChanges ? handleSave : undefined}
                      disabled={updateFields.isPending || updateAssets.isPending || uploadAsset.isPending}
                      activeTab="data"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16">
                      <svg className="animate-spin h-6 w-6 text-[#86868b] mb-3" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-[13px] text-[#86868b]">Loading data...</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Code Modal */}
      {showCodeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowCodeModal(false)} />
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#d2d2d7]">
              <h2 className="text-[17px] font-semibold text-[#1d1d1f]">
                Template Code
              </h2>
              <button
                onClick={() => setShowCodeModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
              >
                <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-6">
              <textarea
                value={templateCode}
                onChange={(e) => setTemplateCode(e.target.value)}
                className="w-full h-[500px] px-4 py-3 bg-[#1d1d1f] text-[#e8e8ed] font-mono text-[13px]
                          rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-[#424245]"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#d2d2d7]">
              <button
                onClick={() => setShowCodeModal(false)}
                className="px-4 py-2 text-[14px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!job) return;
                  try {
                    const res = await fetch(`/api/templates/${job.templateId}/code`, {
                      method: "PUT",
                      headers: { "Content-Type": "text/plain" },
                      body: templateCode,
                    });
                    if (res.ok) {
                      setShowCodeModal(false);
                      await renderJob.mutateAsync({ jobId });
                      setPdfKey((k) => k + 1);
                    }
                  } catch (error) {
                    console.error("Failed to save code:", error);
                  }
                }}
                disabled={renderJob.isPending || !job}
                className="px-4 py-2 text-[14px] font-medium text-white bg-[#1d1d1f] rounded-lg
                          hover:bg-[#424245] disabled:opacity-40 disabled:cursor-not-allowed
                          transition-all duration-200"
              >
                {renderJob.isPending ? "Saving..." : "Save & Render"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expanded PDF Modal */}
      {pdfExpanded && job?.renderedAt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setPdfExpanded(false)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-xl overflow-hidden"
            style={{ width: "90vw", height: "90vh", maxWidth: "1200px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8e8ed]">
              <span className="text-[14px] font-medium text-[#1d1d1f]">
                Document Preview
              </span>
              <button
                onClick={() => setPdfExpanded(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
              >
                <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="h-[calc(100%-52px)]">
              <iframe
                src={`/api/jobs/${jobId}/pdf?t=${(previewRenderedAt || job.renderedAt) ?? Date.now()}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                className="w-full h-full"
                style={{ border: 0 }}
                title="PDF Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
