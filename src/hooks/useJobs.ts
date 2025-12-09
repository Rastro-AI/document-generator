import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Job } from "@/lib/types";

export function useJob(jobId: string | null) {
  return useQuery<Job>({
    queryKey: ["job", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (!res.ok) throw new Error("Failed to fetch job");
      return res.json();
    },
    enabled: !!jobId,
    retry: 10,
    retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 3000),
    refetchInterval: (query) => {
      // Poll while job doesn't exist or is still processing
      if (!query.state.data) return 1000;
      return false;
    },
  });
}

export function useCreateJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      templateId,
      files,
      prompt,
      assetIds,
    }: {
      jobId: string;
      templateId: string;
      files?: File[];
      prompt?: string;
      assetIds?: string[];
    }) => {
      const formData = new FormData();
      formData.append("jobId", jobId);
      formData.append("templateId", templateId);
      if (files && files.length > 0) {
        for (const file of files) {
          formData.append("files", file);
        }
      }
      if (prompt) {
        formData.append("prompt", prompt);
      }
      if (assetIds && assetIds.length > 0) {
        formData.append("assetIds", JSON.stringify(assetIds));
      }

      const res = await fetch("/api/jobs", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create job");
      }

      return res.json() as Promise<{ jobId: string }>;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
    },
  });
}

export function useUpdateJobFields() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      fields,
    }: {
      jobId: string;
      fields: Record<string, string | number | null>;
    }) => {
      const res = await fetch(`/api/jobs/${jobId}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to update fields");
      }

      return res.json() as Promise<Job>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["job", data.id], data);
    },
  });
}

export function useRenderJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/jobs/${jobId}/render`, {
        method: "POST",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to render PDF");
      }

      return res.json() as Promise<{ ok: boolean; renderedAt: string }>;
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
  });
}

interface AgentTrace {
  type: "reasoning" | "tool_call" | "tool_result" | "status";
  content: string;
  toolName?: string;
}

interface ChatResponse {
  success: boolean;
  mode: "fields" | "template";
  message: string;
  fields?: Record<string, string | number | null>;
  traces?: AgentTrace[];
  templateChanged?: boolean;
}

export function useUploadFiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      files,
      prompt,
      regenerate,
    }: {
      jobId: string;
      files: File[];
      prompt?: string;
      regenerate?: boolean;
    }) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
      if (prompt) {
        formData.append("prompt", prompt);
      }
      if (regenerate) {
        formData.append("regenerate", "true");
      }

      const res = await fetch(`/api/jobs/${jobId}/files`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to upload files");
      }

      return res.json() as Promise<{ success: boolean; message: string; job: Job }>;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["job", variables.jobId], data.job);
    },
  });
}

export function useRestoreHistory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      historyId,
    }: {
      jobId: string;
      historyId: string;
    }) => {
      const res = await fetch(`/api/jobs/${jobId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to restore history");
      }

      return res.json() as Promise<{ success: boolean; message: string; job: Job }>;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["job", variables.jobId], data.job);
    },
  });
}

export function useSaveHistoryPoint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      description,
    }: {
      jobId: string;
      description: string;
    }) => {
      const res = await fetch(`/api/jobs/${jobId}/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save history point");
      }

      return res.json() as Promise<{ success: boolean; message: string; job: Job }>;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["job", variables.jobId], data.job);
    },
  });
}

export function useChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      message,
      mode,
    }: {
      jobId: string;
      message: string;
      mode: "fields" | "template" | "auto";
    }) => {
      const res = await fetch(`/api/jobs/${jobId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, mode }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Chat request failed");
      }

      return res.json() as Promise<ChatResponse>;
    },
    onSuccess: (data, variables) => {
      if (data.mode === "fields") {
        queryClient.invalidateQueries({ queryKey: ["job", variables.jobId] });
      }
    },
  });
}

export function useRemoveUploadedFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      jobId,
      filename,
    }: {
      jobId: string;
      filename: string;
    }) => {
      const res = await fetch(`/api/jobs/${jobId}/files/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to remove file");
      }

      return res.json() as Promise<{ success: boolean; job: Job }>;
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData(["job", variables.jobId], data.job);
    },
  });
}

// Streaming job creation with SSE for real-time status updates
export async function streamCreateJob(
  jobId: string,
  templateId: string,
  files: File[],
  prompt: string | undefined,
  assetIds: string[] | undefined,
  onTrace: (trace: { type: string; content: string }) => void,
  onResult: (result: { jobId: string; job: Job }) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
  reasoning?: "none" | "low"
): Promise<void> {
  const formData = new FormData();
  formData.append("jobId", jobId);
  formData.append("templateId", templateId);
  for (const file of files) {
    formData.append("files", file);
  }
  if (prompt) {
    formData.append("prompt", prompt);
  }
  if (assetIds && assetIds.length > 0) {
    formData.append("assetIds", JSON.stringify(assetIds));
  }
  if (reasoning) {
    formData.append("reasoning", reasoning);
  }

  const response = await fetch("/api/jobs/stream", {
    method: "POST",
    body: formData,
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    onError(error.error || "Job creation failed");
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (eventType === "trace") {
            onTrace(parsed);
          } else if (eventType === "result") {
            onResult(parsed);
          } else if (eventType === "error") {
            onError(parsed.error);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// Streaming chat with SSE for real-time status updates
export async function streamChat(
  jobId: string,
  message: string,
  mode: "auto" | "template",
  reasoning: "none" | "low" = "none",
  onTrace: (trace: AgentTrace) => void,
  onResult: (result: ChatResponse) => void,
  onError: (error: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`/api/jobs/${jobId}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, mode, reasoning }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json();
    onError(error.error || "Chat request failed");
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    let eventType = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        eventType = line.slice(7);
      } else if (line.startsWith("data: ")) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          if (eventType === "trace") {
            onTrace(parsed);
          } else if (eventType === "result") {
            onResult(parsed);
          } else if (eventType === "error") {
            onError(parsed.error);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}
