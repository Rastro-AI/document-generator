"use client";

import { useState, useEffect, useRef } from "react";
import { useJob, useUpdateJobFields, useRenderJob } from "@/hooks/useJobs";
import { useTemplate } from "@/hooks/useTemplates";
import { FieldsEditor } from "./FieldsEditor";
import { PdfPreview } from "./PdfPreview";
import { ChatPanel } from "./ChatPanel";
import { HistoryPanel } from "./HistoryPanel";

interface JobEditorProps {
  jobId: string;
  onBack: () => void;
  initialPrompt?: string;
  initialFiles?: { name: string; type: string }[];
}

export function JobEditor({ jobId, onBack, initialPrompt, initialFiles }: JobEditorProps) {
  const { data: job, isLoading: jobLoading, error: jobError, refetch } = useJob(jobId);
  const { data: template, isLoading: templateLoading } = useTemplate(
    job?.templateId || null
  );

  const [localFields, setLocalFields] = useState<
    Record<string, string | number | null>
  >({});
  const [hasChanges, setHasChanges] = useState(false);
  const [pdfKey, setPdfKey] = useState(0);
  const [hasEdited, setHasEdited] = useState(false);

  const updateFields = useUpdateJobFields();
  const renderJob = useRenderJob();
  const hasAutoRendered = useRef(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [templateCode, setTemplateCode] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [pdfExpanded, setPdfExpanded] = useState(false);
  const [chatMinimized, setChatMinimized] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Sync local fields when job data loads
  useEffect(() => {
    if (job) {
      setLocalFields(job.fields);
      setHasChanges(false);
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

  // Auto-render once on first load if not already rendered
  useEffect(() => {
    if (job && !job.renderedAt && !hasAutoRendered.current && !renderJob.isPending) {
      hasAutoRendered.current = true;
      renderJob.mutateAsync(jobId).then(() => {
        setPdfKey((k) => k + 1);
      }).catch((error) => {
        console.error("Failed to auto-render:", error);
        hasAutoRendered.current = false; // Allow retry on error
      });
    }
  }, [job, jobId]);

  const handleFieldChange = (name: string, value: string | number | null) => {
    setLocalFields((prev) => ({ ...prev, [name]: value }));
    setHasChanges(true);
    setHasEdited(true);
  };

  const handleSave = async () => {
    try {
      await updateFields.mutateAsync({ jobId, fields: localFields });
      setHasChanges(false);
      // Auto-render after save
      await renderJob.mutateAsync(jobId);
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
        await renderJob.mutateAsync(jobId);
        setPdfKey((k) => k + 1);
      } catch (error) {
        console.error("Failed to render:", error);
      }
    }
  };

  const handleFieldsUpdated = async (newFields: Record<string, string | number | null>) => {
    setLocalFields(newFields);
    setHasChanges(false);
    setHasEdited(true);
    refetch();
    // Auto-render after chat update
    try {
      await renderJob.mutateAsync(jobId);
      setPdfKey((k) => k + 1);
    } catch (error) {
      console.error("Failed to render after chat update:", error);
    }
  };

  const handleTemplateUpdated = async () => {
    setHasEdited(true);
    // Auto-render after template change
    try {
      await renderJob.mutateAsync(jobId);
      setPdfKey((k) => k + 1);
    } catch (error) {
      console.error("Failed to render after template update:", error);
    }
  };

  const handleJobUpdated = async () => {
    setHasEdited(true);
    await refetch();
    // Auto-render after job update
    try {
      await renderJob.mutateAsync(jobId);
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
                        href={`/api/jobs/${jobId}/pdf`}
                        download="output.pdf"
                        onClick={() => setShowExportMenu(false)}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        PDF
                      </a>
                      <button
                        onClick={async () => {
                          setShowExportMenu(false);
                          // TODO: Implement SVG export
                          alert("SVG export coming soon");
                        }}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                        </svg>
                        SVG
                      </button>
                      <button
                        onClick={async () => {
                          setShowExportMenu(false);
                          // TODO: Implement save to catalog
                          alert("Save to catalog coming soon");
                        }}
                        className="w-full px-3 py-2 text-left text-[13px] text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                        </svg>
                        Save to Catalog
                      </button>
                      <div className="border-t border-[#e8e8ed] my-1" />
                      <button
                        onClick={async () => {
                          setShowExportMenu(false);
                          const res = await fetch(`/api/templates/${job.templateId}/code`);
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
              <button
                onClick={() => alert("Deploy coming soon")}
                className="px-3 py-1.5 text-[13px] font-medium text-[#1d1d1f] bg-white border border-[#d2d2d7] rounded-lg
                          hover:bg-[#f5f5f7] active:scale-[0.98]
                          transition-all duration-200"
              >
                Deploy
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

      {/* Main content + Chat */}
      <div className="flex flex-1 min-h-0 flex-col">
        {/* 2-pane layout */}
        <div className="flex min-h-0 flex-1">
          {/* Left: Fields editor */}
          <div className="w-[380px] border-r border-[#d2d2d7] bg-white overflow-y-auto">
            <div className="p-6">
              {isReady ? (
                <FieldsEditor
                  template={template}
                  job={{ ...job, fields: localFields }}
                  onFieldChange={handleFieldChange}
                  disabled={updateFields.isPending}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <svg className="animate-spin h-6 w-6 text-[#86868b] mb-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <p className="text-[13px] text-[#86868b]">Loading fields...</p>
                </div>
              )}
            </div>
          </div>

          {/* Middle: PDF preview */}
          <div className="flex-1 p-6 bg-[#f5f5f7] relative">
            {isReady ? (
              <>
                <PdfPreview key={pdfKey} jobId={jobId} renderedAt={job.renderedAt} isRendering={renderJob.isPending} />
                {/* Expand button */}
                <button
                  onClick={() => setPdfExpanded(true)}
                  className="absolute top-8 right-8 w-8 h-8 flex items-center justify-center rounded-lg bg-white/80 hover:bg-white shadow-sm transition-colors"
                  title="Expand preview"
                >
                  <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                  </svg>
                </button>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center bg-white rounded-xl shadow-sm">
                <svg className="animate-spin h-8 w-8 text-[#86868b] mb-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">Creating document...</p>
                <p className="text-[13px] text-[#86868b]">Processing your files</p>
              </div>
            )}
          </div>

          {/* Right: History panel */}
          {showHistoryPanel && isReady && (
            <div className="w-[260px] flex-shrink-0">
              <HistoryPanel job={job} onJobUpdated={handleJobUpdated} />
            </div>
          )}
        </div>

        {/* Chat panel - collapsible */}
        <div className={`flex-shrink-0 px-4 pb-4 bg-[#f5f5f7] transition-all duration-300 ${chatMinimized ? "" : "h-[350px]"}`}>
          {/* Chat header - clickable to toggle */}
          <div
            onClick={() => setChatMinimized(!chatMinimized)}
            className="flex items-center justify-between py-2 cursor-pointer group"
          >
            <span className="text-[12px] font-medium text-[#86868b] group-hover:text-[#1d1d1f] transition-colors">
              Chat
            </span>
            <svg
              className={`w-4 h-4 text-[#86868b] group-hover:text-[#1d1d1f] transition-all ${chatMinimized ? "" : "rotate-180"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          {/* Chat content */}
          {!chatMinimized && (
            <div className="h-[calc(100%-32px)]">
              <ChatPanel
                jobId={jobId}
                initialMessage={job?.initialMessage}
                uploadedFiles={job?.uploadedFiles}
                initialUserPrompt={initialPrompt}
                initialUserFiles={initialFiles}
                onFieldsUpdated={handleFieldsUpdated}
                onTemplateUpdated={handleTemplateUpdated}
                onFilesChanged={() => refetch()}
              />
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
                      await renderJob.mutateAsync(jobId);
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
                src={`/api/jobs/${jobId}/pdf?t=${job.renderedAt}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
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
