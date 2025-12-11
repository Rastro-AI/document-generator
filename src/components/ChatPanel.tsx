"use client";

import { useState, useRef, useEffect } from "react";
import { useUploadFiles, useRemoveUploadedFile, streamChat } from "@/hooks/useJobs";
import { UploadedFile } from "@/lib/types";
import { AssetBankModal } from "./AssetBankModal";
import { Asset } from "@/hooks/useAssetBank";

interface AgentTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status";
  content: string;
  toolName?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  attachments?: { filename: string; type: "document" | "image" }[];
  traces?: AgentTrace[];
}

interface ChatPanelProps {
  jobId: string;
  initialMessage?: string;
  uploadedFiles?: UploadedFile[];
  initialUserPrompt?: string;
  initialUserFiles?: { name: string; type: string }[];
  isCreating?: boolean;
  creationStatus?: string;
  creationTraces?: AgentTrace[];
  initialReasoningMode?: ReasoningMode;
  onFieldsUpdated: (fields: Record<string, string | number | null>) => void;
  onTemplateUpdated: () => void;
  onFilesChanged?: () => void;
  onBack?: () => void;
}

/**
 * TracesDisplay - Expandable reasoning traces like o3's UI
 */
function TracesDisplay({ traces }: { traces: AgentTrace[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const reasoningCount = traces.filter(t => t.type === "reasoning").length;
  const toolCount = traces.filter(t => t.type === "tool_call").length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-[11px] text-[#86868b] hover:text-[#1d1d1f] transition-colors"
      >
        <svg
          className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">
          {reasoningCount > 0 && `${reasoningCount} thought${reasoningCount > 1 ? "s" : ""}`}
          {reasoningCount > 0 && toolCount > 0 && ", "}
          {toolCount > 0 && `${toolCount} tool call${toolCount > 1 ? "s" : ""}`}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-2 pl-4 border-l-2 border-[#e8e8ed] space-y-2">
          {traces.map((trace, idx) => (
            <div key={idx} className="text-[11px]">
              {trace.type === "reasoning" && (
                <div className="text-[#86868b] italic">
                  {trace.content}
                </div>
              )}
              {trace.type === "tool_call" && (
                <div className="flex items-center gap-1">
                  <span className="text-[#0066CC] font-mono">{trace.toolName}</span>
                  <span className="text-[#86868b]">()</span>
                </div>
              )}
              {trace.type === "tool_result" && (
                <div className="text-[#00aa00] font-mono text-[10px] bg-white/50 px-1.5 py-0.5 rounded">
                  {trace.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ReasoningMode = "none" | "low";

export function ChatPanel({ jobId, initialMessage, uploadedFiles, initialUserPrompt, initialUserFiles, isCreating, creationStatus, creationTraces, initialReasoningMode, onFieldsUpdated, onTemplateUpdated, onFilesChanged, onBack }: ChatPanelProps) {
  const [reasoningMode, setReasoningMode] = useState<ReasoningMode>(initialReasoningMode || "none");
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const msgs: ChatMessage[] = [];

    // Show initial user message immediately (before server response)
    if (initialUserPrompt || (initialUserFiles && initialUserFiles.length > 0)) {
      const fileNames = initialUserFiles?.map(f => f.name) || [];
      const content = initialUserPrompt
        ? (fileNames.length > 0 ? `${initialUserPrompt} [${fileNames.join(", ")}]` : initialUserPrompt)
        : `Uploaded files [${fileNames.join(", ")}]`;
      msgs.push({
        id: "initial-user",
        role: "user",
        content,
        timestamp: new Date(),
      });
    }

    // Show initial assistant message (don't show files as message, we'll show them separately)
    if (initialMessage) {
      msgs.push({
        id: "initial",
        role: "assistant",
        content: initialMessage,
        timestamp: new Date(),
      });
    }

    return msgs;
  });
  const [input, setInput] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isFocused, setIsFocused] = useState(false);
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ file: File; url: string } | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [liveTraces, setLiveTraces] = useState<AgentTrace[]>([]);
  const [showAssetBank, setShowAssetBank] = useState(false);
  const [selectedAssets, setSelectedAssets] = useState<Asset[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const uploadFilesHook = useUploadFiles();
  const removeFile = useRemoveUploadedFile();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Add or update assistant message when it arrives from server (with traces if available)
  useEffect(() => {
    if (!initialMessage) return;

    setMessages(prev => {
      const existingIndex = prev.findIndex(m => m.id === "initial");
      const newMessage: ChatMessage = {
        id: "initial",
        role: "assistant",
        content: initialMessage,
        timestamp: new Date(),
        traces: creationTraces && creationTraces.length > 0 ? creationTraces : undefined,
      };

      if (existingIndex >= 0) {
        // Update existing message (handles "Processing..." -> real message transition)
        const updated = [...prev];
        updated[existingIndex] = newMessage;
        return updated;
      } else {
        // Add new message
        return [...prev, newMessage];
      }
    });
  }, [initialMessage, creationTraces]);

  // Handle click outside to unfocus
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleRemoveUploadedFile = async (filename: string) => {
    try {
      await removeFile.mutateAsync({ jobId, filename });
      onFilesChanged?.();
    } catch (error) {
      console.error("Failed to remove file:", error);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...files]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const openAttachmentPreview = (file: File) => {
    const url = URL.createObjectURL(file);
    setPreviewAttachment({ file, url });
  };

  const closeAttachmentPreview = () => {
    if (previewAttachment) {
      URL.revokeObjectURL(previewAttachment.url);
    }
    setPreviewAttachment(null);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData.items);
    const imageFiles: File[] = [];

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      setAttachedFiles((prev) => [...prev, ...imageFiles]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...files]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  // Handle asset bank selection - fetch asset file and add to attachedFiles
  const handleToggleAsset = async (asset: Asset) => {
    // Check if already in selectedAssets
    const isSelected = selectedAssets.some(a => a.id === asset.id);
    if (isSelected) {
      setSelectedAssets(prev => prev.filter(a => a.id !== asset.id));
    } else {
      setSelectedAssets(prev => [...prev, asset]);
      // Fetch the asset file and add to attachedFiles
      try {
        const response = await fetch(`/api/assets/${asset.id}`);
        if (response.ok) {
          const blob = await response.blob();
          const file = new File([blob], asset.filename, { type: blob.type });
          setAttachedFiles(prev => [...prev, file]);
        }
      } catch (err) {
        console.error("Failed to fetch asset:", err);
      }
    }
  };

  const isProcessing = isStreaming || uploadFilesHook.isPending || isCreating;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && attachedFiles.length === 0) return;

    // Abort any ongoing request to allow interruption
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: attachedFiles.length > 0
        ? `${input || "Uploaded files"} [${attachedFiles.map(f => f.name).join(", ")}]`
        : input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const currentInput = input;
    const currentFiles = [...attachedFiles];
    setInput("");
    setAttachedFiles([]);

    try {
      // If files are attached, upload them first
      if (currentFiles.length > 0) {
        const uploadResult = await uploadFilesHook.mutateAsync({
          jobId,
          files: currentFiles,
          prompt: currentInput || undefined,
          regenerate: true,
        });

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: uploadResult.message,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);

        // Notify parent of field updates
        if (uploadResult.job?.fields) {
          onFieldsUpdated(uploadResult.job.fields);
        }
      } else {
        // Use streaming chat for real-time updates
        setIsStreaming(true);
        setLiveStatus("Thinking...");
        setLiveTraces([]);

        // Create abort controller for this request
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
          await streamChat(
            jobId,
            currentInput,
            "auto",
            reasoningMode,
            // onTrace - live status updates
            (trace) => {
              if (trace.type === "status") {
                setLiveStatus(trace.content);
              }
              setLiveTraces((prev) => [...prev, trace]);
            },
            // onResult - final result
            (result) => {
              // Use result.traces if available, otherwise use the liveTraces we collected
              const finalTraces = (result.traces && result.traces.length > 0) ? result.traces : [...liveTraces];

              const assistantMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: result.message || "Done",
                timestamp: new Date(),
                traces: finalTraces.length > 0 ? finalTraces : undefined,
              };

              setMessages((prev) => [...prev, assistantMessage]);

              // Notify parent of updates
              console.log("[ChatPanel] Stream result:", { mode: result.mode, templateChanged: result.templateChanged, hasFields: !!result.fields });

              // Handle fields updates (mode can be "fields" or "both")
              if ((result.mode === "fields" || result.mode === "both") && result.fields) {
                console.log("[ChatPanel] Calling onFieldsUpdated");
                onFieldsUpdated(result.fields);
              }
              // Handle template updates (mode can be "template" or "both", or templateChanged flag)
              if (result.mode === "template" || result.mode === "both" || result.templateChanged) {
                console.log("[ChatPanel] Calling onTemplateUpdated - will trigger render");
                onTemplateUpdated();
              }
            },
            // onError
            (error) => {
              // Don't show error if it was aborted (user interrupted)
              if (abortController.signal.aborted) return;
              const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: "assistant",
                content: `Error: ${error}`,
                timestamp: new Date(),
              };
              setMessages((prev) => [...prev, errorMessage]);
            },
            abortController.signal
          );
        } catch (err) {
          // Silently ignore abort errors (user interrupted)
          if (err instanceof Error && err.name === "AbortError") {
            // User interrupted, don't show error
          }
        }

        // Only clear state if this wasn't aborted
        if (!abortController.signal.aborted) {
          setIsStreaming(false);
          setLiveStatus(null);
          setLiveTraces([]);
        }
        abortControllerRef.current = null;
      }
    } catch (error) {
      setIsStreaming(false);
      setLiveStatus(null);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Something went wrong"}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    }
  };

  return (
    <div
      ref={containerRef}
      onClick={() => setIsFocused(true)}
      className="flex flex-col h-full bg-white transition-all duration-200 cursor-text overflow-visible"
    >
      {/* Back button */}
      {onBack && (
        <div className="flex-shrink-0 px-3 pt-3">
          <button
            onClick={onBack}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
          >
            <svg className="w-4 h-4 text-[#1d1d1f]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Messages - increased height for more conversation history */}
      <div className="flex-[1.2] overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (!uploadedFiles || uploadedFiles.length === 0) && (
          <div className="text-center text-[13px] text-[#86868b] py-8">
            <p className="font-medium text-[#1d1d1f] mb-1">Edit with AI</p>
            <p>Ask me to update values or modify the design.</p>
            <p className="mt-2 text-[12px]">
              Examples: &quot;Change wattage to 15W&quot; &bull; &quot;Make the header blue&quot;
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-3 py-2 rounded-xl text-[13px] ${
                msg.role === "user"
                  ? "bg-[#1d1d1f] text-white"
                  : "bg-[#f5f5f7] text-[#1d1d1f]"
              }`}
            >
              {msg.attachments && msg.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {msg.attachments.map((att, i) => (
                    <div
                      key={`${att.filename}-${i}`}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] ${
                        msg.role === "user"
                          ? "bg-white/20 text-white"
                          : "bg-white text-[#1d1d1f]"
                      }`}
                    >
                      {att.type === "image" ? (
                        <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                      <span className="max-w-[100px] truncate">{att.filename}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Traces display - o3-style reasoning UI */}
              {msg.traces && msg.traces.length > 0 && (
                <TracesDisplay traces={msg.traces} />
              )}
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-[#f5f5f7] px-3 py-2 rounded-xl max-w-[80%]">
              {(() => {
                const tracesToShow = isCreating && creationTraces && creationTraces.length > 0 ? creationTraces : liveTraces;
                // Filter to only tool_call and tool_result traces
                const toolTraces = tracesToShow.filter(t => t.type === "tool_call" || t.type === "tool_result");

                if (toolTraces.length > 0) {
                  // Find the last tool call that doesn't have a result yet
                  const lastToolCall = [...toolTraces].reverse().find(t => t.type === "tool_call");
                  const completedTraces = toolTraces.slice(0, -1); // All but the last
                  const isLastPending = toolTraces[toolTraces.length - 1]?.type === "tool_call";

                  return (
                    <div>
                      {/* Expandable completed traces */}
                      {completedTraces.length > 0 && (
                        <details className="mb-2">
                          <summary className="text-[11px] text-[#86868b] cursor-pointer hover:text-[#1d1d1f]">
                            {completedTraces.filter(t => t.type === "tool_result").length} tool{completedTraces.filter(t => t.type === "tool_result").length !== 1 ? "s" : ""} completed
                          </summary>
                          <div className="mt-1 pl-2 border-l-2 border-[#e8e8ed] space-y-0.5">
                            {completedTraces.map((trace, idx) => (
                              <div key={idx} className="text-[10px] flex items-center gap-1">
                                {trace.type === "tool_call" && (
                                  <span className="text-[#86868b] font-mono">{trace.toolName}</span>
                                )}
                                {trace.type === "tool_result" && (
                                  <span className="text-[#00aa00]">✓ {trace.toolName}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {/* Current/last tool call with spinner if pending */}
                      {isLastPending && lastToolCall && (
                        <div className="flex items-center gap-2">
                          <svg className="animate-spin h-3.5 w-3.5 text-[#0066CC] flex-shrink-0" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-[12px] text-[#0066CC] font-mono">{lastToolCall.toolName}()</span>
                        </div>
                      )}
                      {/* If last was a result, show waiting for response */}
                      {!isLastPending && (
                        <div className="flex items-center gap-2">
                          <svg className="animate-spin h-3.5 w-3.5 text-[#86868b] flex-shrink-0" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-[12px] text-[#86868b]">Thinking...</span>
                        </div>
                      )}
                    </div>
                  );
                }
                // No tool traces yet, show simple spinner
                return (
                  <div className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-[#86868b] flex-shrink-0" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-[13px] text-[#86868b]">Thinking...</span>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input - ChatGPT style */}
      <form onSubmit={handleSubmit} className="px-4 pb-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".xlsx,.xlsm,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp"
          onChange={handleFileSelect}
          className="hidden"
        />

        <div
          className="bg-[#f5f5f7] rounded-2xl overflow-hidden"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
        >
          {/* Uploaded files + Attached files preview - inside the input box */}
          {((uploadedFiles && uploadedFiles.length > 0) || attachedFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {/* Already uploaded files */}
              {uploadedFiles?.map((file) => (
                <div
                  key={file.filename}
                  className="group flex items-center gap-2 px-2.5 py-1.5 bg-white rounded-lg text-[12px] text-[#1d1d1f] shadow-sm cursor-pointer hover:bg-[#f5f5f7] transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewFile(file);
                  }}
                >
                  {file.type === "image" ? (
                    <svg className="w-3.5 h-3.5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  <span className="max-w-[100px] truncate">{file.filename}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveUploadedFile(file.filename);
                    }}
                    disabled={removeFile.isPending}
                    className="ml-0.5 text-[#86868b] hover:text-[#ff3b30] opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {/* Newly attached files (pending upload) */}
              {attachedFiles.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  onClick={() => openAttachmentPreview(file)}
                  className="flex items-center gap-2 px-2.5 py-1.5 bg-white rounded-lg text-[12px] text-[#1d1d1f] shadow-sm cursor-pointer hover:bg-[#f5f5f7] transition-colors"
                >
                  {file.type.startsWith("image/") ? (
                    <svg className="w-3.5 h-3.5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  ) : (
                    <svg className="w-3.5 h-3.5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  <span className="max-w-[120px] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAttachedFile(index);
                    }}
                    className="ml-1 text-[#86868b] hover:text-[#ff3b30]"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Text input - textarea for multi-line support */}
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
            }}
            onPaste={handlePaste}
            onFocus={() => setIsFocused(true)}
            onKeyDown={(e) => {
              // Submit on Enter (without shift), or Cmd/Ctrl+Enter
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() || attachedFiles.length > 0) {
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }
            }}
            placeholder="Ask to edit values or design..."
            disabled={isProcessing}
            rows={1}
            className="w-full px-4 py-3 bg-transparent text-[14px] text-[#1d1d1f]
                      placeholder-[#86868b] border-0 resize-none
                      focus:outline-none focus:ring-0
                      focus-visible:outline-none focus-visible:ring-0
                      disabled:opacity-50"
          />

          {/* Bottom row - attachment buttons left, mode picker and send button right */}
          <div className="flex items-center justify-between px-3 pb-3">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium text-[#86868b]
                          hover:bg-white hover:text-[#1d1d1f]
                          disabled:opacity-40 disabled:cursor-not-allowed
                          transition-all duration-200"
                title="Attach files (or paste/drag images)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                </svg>
                Attach
              </button>

              {/* Asset Bank Button */}
              <button
                type="button"
                onClick={() => setShowAssetBank(true)}
                disabled={isProcessing}
                className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg text-[12px] font-medium text-[#86868b]
                          hover:bg-white hover:text-[#1d1d1f]
                          disabled:opacity-40 disabled:cursor-not-allowed
                          transition-all duration-200"
                title="Select from Asset Bank"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                </svg>
                Asset Bank
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Model picker - Fast/Slow toggle */}
              <button
                type="button"
                onClick={() => setReasoningMode(reasoningMode === "none" ? "low" : "none")}
                disabled={isProcessing}
                className="h-8 px-3 flex items-center gap-1.5 rounded-lg text-[12px] font-medium bg-white border border-[#e8e8ed] text-[#86868b] hover:text-[#1d1d1f] hover:border-[#d2d2d7] disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
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

              <button
                type="submit"
                disabled={(!input.trim() && attachedFiles.length === 0) || isProcessing}
                className="h-8 px-3 flex items-center justify-center gap-1.5 rounded-lg bg-[#1d1d1f] text-white
                          hover:bg-[#424245] active:scale-[0.95]
                          disabled:opacity-40 disabled:cursor-not-allowed
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
      </form>

      {/* File preview modal */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-xl max-w-2xl max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e8e8ed]">
              <span className="text-[14px] font-medium text-[#1d1d1f] truncate max-w-[300px]">
                {previewFile.filename}
              </span>
              <button
                onClick={() => setPreviewFile(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
              >
                <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[60vh]">
              {previewFile.type === "image" ? (
                <img
                  src={`/api/jobs/${jobId}/files/${encodeURIComponent(previewFile.filename)}`}
                  alt={previewFile.filename}
                  className="max-w-full h-auto rounded-lg"
                />
              ) : previewFile.filename.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  src={`/api/jobs/${jobId}/files/${encodeURIComponent(previewFile.filename)}`}
                  className="w-full h-[500px] rounded-lg border border-[#e8e8ed]"
                  title={previewFile.filename}
                />
              ) : previewFile.filename.toLowerCase().match(/\.(xlsx?|csv)$/) ? (
                <iframe
                  src={`/api/jobs/${jobId}/files/${encodeURIComponent(previewFile.filename)}/preview`}
                  className="w-full h-[500px] rounded-lg border border-[#e8e8ed] bg-white"
                  title={previewFile.filename}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-[#86868b]">
                  <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-[14px]">Document preview not available</p>
                  <p className="text-[12px] mt-1">{previewFile.filename}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Asset Bank Modal */}
      <AssetBankModal
        isOpen={showAssetBank}
        onClose={() => setShowAssetBank(false)}
        selectedAssets={selectedAssets}
        onToggleAsset={handleToggleAsset}
      />
    </div>
  );
}
