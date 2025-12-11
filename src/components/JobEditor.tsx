"use client";

import { useState, useEffect, useRef } from "react";
import { useJob, useUpdateJobFields, useUpdateJobAssets, useUploadJobAsset, useRenderJob, streamCreateJob } from "@/hooks/useJobs";
import { useTemplate } from "@/hooks/useTemplates";
import { FieldsEditor } from "./FieldsEditor";
import { PdfPreview } from "./PdfPreview";
import { ChatPanel } from "./ChatPanel";
import { HistoryPanel } from "./HistoryPanel";

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
  const { data: job, isLoading: jobLoading, error: jobError, refetch } = useJob(jobId);
  const { data: template, isLoading: templateLoading } = useTemplate(
    job?.templateId || templateId || null
  );

  // Initial creation streaming state
  const [isCreating, setIsCreating] = useState(!!initialFiles || !!initialAssetIds || !!initialPrompt);
  const [creationStatus, setCreationStatus] = useState<string>("Starting...");
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
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [templateCode, setTemplateCode] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<"preview" | "assets" | "data">("preview");
  const exportMenuRef = useRef<HTMLDivElement>(null);
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

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
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
      },
      // onResult
      () => {
        setIsCreating(false);
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
      {/* Header - compact */}
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-[#d2d2d7]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
          >
            <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-[15px] font-semibold text-[#1d1d1f]">
            {template?.name || "Loading..."}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {isReady && (
            <>
              {hasChanges && (
                <span className="text-[12px] text-[#86868b]">Unsaved</span>
              )}
              {hasChanges && (
                <button
                  onClick={handleSave}
                  disabled={updateFields.isPending || renderJob.isPending}
                  className="px-3 py-1.5 text-[13px] font-medium text-white bg-[#1d1d1f] rounded-lg
                            hover:bg-[#424245] active:scale-[0.98]
                            disabled:opacity-40 disabled:cursor-not-allowed
                            transition-all duration-200"
                >
                  {updateFields.isPending || renderJob.isPending ? "Saving..." : "Save"}
                </button>
              )}
              {job.renderedAt && (
                <div className="relative" ref={exportMenuRef}>
                  <button
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    className="px-3 py-1.5 text-[13px] font-medium text-[#1d1d1f] bg-white border border-[#d2d2d7] rounded-lg
                              hover:bg-[#f5f5f7] active:scale-[0.98]
                              transition-all duration-200 flex items-center gap-1.5"
                  >
                    Export
                    <svg className={`w-3.5 h-3.5 transition-transform ${showExportMenu ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {showExportMenu && (
                    <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-[#e8e8ed] py-1 z-50">
                      <a
                        href={`/api/jobs/${jobId}/pdf?t=${(previewRenderedAt || job.renderedAt) ?? Date.now()}`}
                        download="output.pdf"
                        onClick={() => setShowExportMenu(false)}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        PDF
                      </a>
                      <a
                        href={`/api/jobs/${jobId}/svg?t=${(previewRenderedAt || job.renderedAt) ?? Date.now()}`}
                        download="output.svg"
                        onClick={() => setShowExportMenu(false)}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a2.25 2.25 0 001.5 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                        </svg>
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
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                        </svg>
                        Code
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => setShowHistoryPanel(!showHistoryPanel)}
                className={`px-3 py-1.5 text-[13px] font-medium rounded-lg transition-colors flex items-center gap-1.5 border ${
                  showHistoryPanel
                    ? "bg-[#1d1d1f] text-white border-[#1d1d1f]"
                    : "bg-white text-[#1d1d1f] border-[#d2d2d7] hover:bg-[#f5f5f7]"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                History
              </button>
            </>
          )}
        </div>
      </header>

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
              initialReasoningMode={initialReasoningMode}
              onFieldsUpdated={handleFieldsUpdated}
              onTemplateUpdated={handleTemplateUpdated}
              onFilesChanged={() => refetch()}
            />
          </div>
        </div>

        {/* Right: Preview/Assets/Data with tabs (50%) */}
        <div className="w-1/2 flex flex-col bg-[#f5f5f7] p-4 pl-2">
          <div className="flex-1 min-h-0 bg-white rounded-xl overflow-hidden border border-[#d2d2d7] flex flex-col">
            {/* Tabs */}
            <div className="flex-shrink-0 border-b border-[#e8e8ed] px-4 pt-3">
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
            </div>

            {/* Tab content */}
            <div className="flex-1 min-h-0 overflow-hidden">
              {/* Preview tab */}
              {rightPanelTab === "preview" && (
                <div className="h-full p-4 relative">
                  {isReady ? (
                    <>
                      <PdfPreview key={pdfKey} jobId={jobId} renderedAt={previewRenderedAt || job.renderedAt} isRendering={renderJob.isPending} />
                      {/* Expand button */}
                      <button
                        onClick={() => setPdfExpanded(true)}
                        className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 hover:bg-white shadow-sm transition-colors"
                        title="Expand preview"
                      >
                        <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                        </svg>
                      </button>
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

          {/* History panel */}
          {showHistoryPanel && isReady && (
            <div className="mt-4 flex-shrink-0 h-[200px]">
              <HistoryPanel job={job} onJobUpdated={handleJobUpdated} />
            </div>
          )}
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
