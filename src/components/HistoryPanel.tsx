"use client";

import { Job, JobHistoryEntry } from "@/lib/types";
import { useRestoreHistory } from "@/hooks/useJobs";

interface HistoryPanelProps {
  job: Job;
  onJobUpdated: () => void;
}

export function HistoryPanel({ job, onJobUpdated }: HistoryPanelProps) {
  const restoreHistory = useRestoreHistory();

  const handleRestore = async (historyId: string) => {
    try {
      await restoreHistory.mutateAsync({ jobId: job.id, historyId });
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

      <div className="flex-1 overflow-y-auto p-4">
        {history.length > 0 ? (
          <div className="space-y-2">
            {[...history].reverse().map((entry, index) => (
              <div
                key={entry.id}
                className={`p-3 rounded-lg border transition-colors ${
                  index === 0
                    ? "bg-[#f5f5f7] border-transparent"
                    : "bg-white border-[#d2d2d7] hover:bg-[#f5f5f7]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#1d1d1f]">
                      {entry.description}
                    </p>
                    <p className="text-[11px] text-[#86868b] mt-0.5">
                      {formatDate(entry.timestamp)}
                    </p>
                  </div>
                  {index !== 0 && (
                    <button
                      onClick={() => handleRestore(entry.id)}
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
