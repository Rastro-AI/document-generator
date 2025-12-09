import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Template, TemplateListItem } from "@/lib/types";

export function useTemplates() {
  return useQuery<TemplateListItem[]>({
    queryKey: ["templates"],
    queryFn: async () => {
      const res = await fetch("/api/templates");
      if (!res.ok) throw new Error("Failed to fetch templates");
      return res.json();
    },
  });
}

export function useTemplate(id: string | null) {
  return useQuery<Template>({
    queryKey: ["template", id],
    queryFn: async () => {
      const res = await fetch(`/api/templates/${id}`);
      if (!res.ok) throw new Error("Failed to fetch template");
      return res.json();
    },
    enabled: !!id,
  });
}

export function useSaveTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ template, code }: { template: Template; code?: string }) => {
      // Save template code first if provided (so thumbnail can be generated)
      if (code !== undefined) {
        const codeRes = await fetch(`/api/templates/${template.id}/code`, {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: code,
        });
        if (!codeRes.ok) throw new Error("Failed to save template code");
      }

      // Save template metadata (this also generates thumbnail)
      const metaRes = await fetch(`/api/templates/${template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(template),
      });
      if (!metaRes.ok) throw new Error("Failed to save template");

      return template;
    },
    onSuccess: (template) => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      queryClient.invalidateQueries({ queryKey: ["template", template.id] });
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete template");
      return templateId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
  });
}
