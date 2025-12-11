/**
 * Supabase Storage Client
 * Handles file storage operations using Supabase Storage buckets
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Storage bucket names
export const BUCKETS = {
  JOBS: "jobs",
  ASSETS: "assets",
} as const;

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create the Supabase client
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables");
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  return supabaseClient;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

/**
 * Upload a file to Supabase storage
 */
export async function uploadFile(
  bucket: string,
  path: string,
  data: Buffer | Blob | string,
  options?: { contentType?: string; upsert?: boolean }
): Promise<{ path: string }> {
  const supabase = getSupabase();

  // Convert string to buffer if needed
  let fileData: Buffer | Blob;
  if (typeof data === "string") {
    fileData = Buffer.from(data, "utf-8");
  } else {
    fileData = data;
  }

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, fileData, {
      contentType: options?.contentType,
      upsert: options?.upsert ?? true,
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  return { path };
}

/**
 * Download a file from Supabase storage
 * @param bucket - The storage bucket name
 * @param path - The file path within the bucket
 */
export async function downloadFile(bucket: string, path: string): Promise<Buffer> {
  const supabase = getSupabase();

  const { data, error } = await supabase.storage.from(bucket).download(path);

  if (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Delete a file from Supabase storage
 */
export async function deleteFile(bucket: string, path: string): Promise<void> {
  const supabase = getSupabase();

  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

/**
 * Delete multiple files from Supabase storage
 */
export async function deleteFiles(bucket: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const supabase = getSupabase();

  const { error } = await supabase.storage.from(bucket).remove(paths);

  if (error) {
    throw new Error(`Failed to delete files: ${error.message}`);
  }
}

/**
 * List files in a folder
 */
export async function listFiles(bucket: string, folder?: string): Promise<string[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase.storage.from(bucket).list(folder || "", {
    limit: 1000,
  });

  if (error) {
    throw new Error(`Failed to list files: ${error.message}`);
  }

  // Filter out folders (they have id: null) and placeholder files
  return data
    .filter((f) => f.id !== null && f.name !== ".emptyFolderPlaceholder")
    .map((f) => (folder ? `${folder}/${f.name}` : f.name));
}

/**
 * Check if a file exists
 */
export async function fileExists(bucket: string, path: string): Promise<boolean> {
  const supabase = getSupabase();

  const folder = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
  const filename = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;

  const { data, error } = await supabase.storage.from(bucket).list(folder, {
    search: filename,
  });

  if (error) {
    return false;
  }

  return data.some((f) => f.name === filename);
}

/**
 * Get a public URL for a file
 */
export function getPublicUrl(bucket: string, path: string): string {
  const supabase = getSupabase();
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Get a signed URL for temporary access
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600
): Promise<string> {
  const supabase = getSupabase();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new Error(`Failed to create signed URL: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Copy a file within storage
 */
export async function copyFile(
  bucket: string,
  sourcePath: string,
  destPath: string
): Promise<void> {
  // Download and re-upload (Supabase doesn't have native copy)
  const data = await downloadFile(bucket, sourcePath);
  await uploadFile(bucket, destPath, data, { upsert: true });
}

/**
 * Move a file (copy then delete)
 */
export async function moveFile(
  bucket: string,
  sourcePath: string,
  destPath: string
): Promise<void> {
  await copyFile(bucket, sourcePath, destPath);
  await deleteFile(bucket, sourcePath);
}
