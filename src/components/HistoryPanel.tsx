"use client";

import { useState } from "react";
import { Job, JobHistoryEntry } from "@/lib/types";
import { useRestoreHistory } from "@/hooks/useJobs";

interface HistoryPanelProps {
  job: Job;
  onJobUpdated: () => void;
}

export function HistoryPanel({ job, onJobUpdated }: HistoryPanelProps) {
  const restoreHistory = useRestoreHistory();
  const [previewEntry, setPreviewEntry] = useState<JobHistoryEntry | null>(null);

  const handleRestore = async (historyId: string) => {
    try {
      await restoreHistory.mutateAsync({ jobId: job.id, historyId });
      setPreviewEntry(null);
      onJobUpdated();
    } catch (error) {
      console.error("Failed to restore:", error);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const history = job.history || [];

  return (
    <div className="flex flex-col h-full bg-white border-l border-[#d2d2d7]">
      <div className="px-4 py-3 border-b border-[#d2d2d7]">
        <h3 className="text-[13px] font-semibold text-[#1d1d1f]">History</h3>
      </div>

      {/* Preview area - shown when hovering over a history entry */}
      {previewEntry?.previewBase64 && (
        <div className="p-3 border-b border-[#d2d2d7] bg-[#fafafa]">
          <img
            src={previewEntry.previewBase64}
            alt="History preview"
            className="w-full h-auto rounded-lg border border-[#e8e8ed]"
          />
          <p className="text-[10px] text-[#86868b] mt-2 text-center">
            {previewEntry.description} - {formatDate(previewEntry.timestamp)}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {history.length > 0 ? (
          <div className="space-y-2">
            {[...history].reverse().map((entry, index) => (
              <div
                key={entry.id}
                className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                  index === 0
                    ? "bg-[#f5f5f7] border-transparent"
                    : previewEntry?.id === entry.id
                      ? "bg-[#e8f4fd] border-[#0066CC]"
                      : "bg-white border-[#d2d2d7] hover:bg-[#f5f5f7]"
                }`}
                onClick={() => {
                  if (index !== 0 && entry.previewBase64) {
                    setPreviewEntry(previewEntry?.id === entry.id ? null : entry);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-[#1d1d1f]">
                        {entry.description}
                      </p>
                      {entry.previewBase64 && index !== 0 && (
                        <svg className="w-3.5 h-3.5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 19.5h16.5a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0020.25 4.5H3.75A2.25 2.25 0 001.5 6.75v10.5A2.25 2.25 0 003.75 19.5z" />
                        </svg>
                      )}
                    </div>
                    <p className="text-[11px] text-[#86868b] mt-0.5">
                      {formatDate(entry.timestamp)}
                    </p>
                  </div>
                  {index !== 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRestore(entry.id);
                      }}
                      disabled={restoreHistory.isPending}
                      className="px-2.5 py-1 text-[11px] font-medium text-[#1d1d1f] bg-white border border-[#d2d2d7] rounded-md
                                hover:bg-[#f5f5f7] active:scale-[0.98]
                                disabled:opacity-40 disabled:cursor-not-allowed
                                transition-all duration-200"
                    >
                      Restore
                    </button>
                  )}
                  {index === 0 && (
                    <span className="px-2 py-0.5 text-[10px] font-medium text-[#86868b] bg-white rounded-full border border-[#d2d2d7]">
                      Current
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-[13px] text-[#86868b] py-8">
            <p>No history yet.</p>
            <p className="mt-1">Changes will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
