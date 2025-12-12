import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

// Base asset for files (images, documents)
export interface FileAsset {
  id: string;
  filename: string;
  type: "image" | "document";
  size: number;
  createdAt: string;
}

// Color asset for brand colors
export interface ColorAsset {
  id: string;
  type: "color";
  name: string;
  value: string; // hex code like "#0066CC"
  usage?: "primary" | "secondary" | "accent" | "text" | "background";
  createdAt: string;
}

// Font asset for brand fonts (Google Fonts)
export interface FontAsset {
  id: string;
  type: "font";
  name: string;
  family: string; // e.g., "Inter"
  weights: string[]; // e.g., ["400", "600", "700"]
  usage?: "heading" | "body" | "accent";
  createdAt: string;
}

// Union type for all assets
export type Asset = FileAsset | ColorAsset | FontAsset;

// Helper type guards
export function isFileAsset(asset: Asset): asset is FileAsset {
  return asset.type === "image" || asset.type === "document";
}

export function isColorAsset(asset: Asset): asset is ColorAsset {
  return asset.type === "color";
}

export function isFontAsset(asset: Asset): asset is FontAsset {
  return asset.type === "font";
}

export function useAssets() {
  return useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () => {
      const res = await fetch("/api/assets");
      if (!res.ok) throw new Error("Failed to fetch assets");
      return res.json();
    },
  });
}

export function useUploadAssets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

      const res = await fetch("/api/assets", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to upload assets");
      }

      return res.json() as Promise<{ success: boolean; assets: Asset[] }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assetId: string) => {
      const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to delete asset");
      }

      return res.json() as Promise<{ success: boolean }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

// Create a brand color
export function useCreateColor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; value: string; usage?: ColorAsset["usage"] }) => {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "color", ...data }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create color");
      }

      return res.json() as Promise<{ success: boolean; asset: ColorAsset }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

// Create a brand font
export function useCreateFont() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; family: string; weights?: string[]; usage?: FontAsset["usage"] }) => {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "font", ...data }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to create font");
      }

      return res.json() as Promise<{ success: boolean; asset: FontAsset }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}
