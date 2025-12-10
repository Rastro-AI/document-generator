/**
 * Supabase client and storage utilities
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Storage bucket names
export const BUCKETS = {
  TEMPLATES: "templates",
  JOBS: "jobs",
  ASSETS: "assets",
} as const;

let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create Supabase client
 */
export function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) return supabaseClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_KEY environment variables");
  }

  supabaseClient = createClient(url, key);
  return supabaseClient;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY));
}

/**
 * Upload a file to Supabase storage
 */
export async function uploadFile(
  bucket: string,
  path: string,
  data: Buffer | Blob | File,
  options?: { contentType?: string; upsert?: boolean }
): Promise<string> {
  const client = getSupabaseClient();

  const { error } = await client.storage.from(bucket).upload(path, data, {
    contentType: options?.contentType,
    upsert: options?.upsert ?? true,
  });

  if (error) {
    throw new Error(`Failed to upload to ${bucket}/${path}: ${error.message}`);
  }

  return path;
}

/**
 * Download a file from Supabase storage
 */
export async function downloadFile(bucket: string, path: string): Promise<Buffer> {
  const client = getSupabaseClient();

  const { data, error } = await client.storage.from(bucket).download(path);

  if (error) {
    throw new Error(`Failed to download ${bucket}/${path}: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Delete a file from Supabase storage
 */
export async function deleteFile(bucket: string, paths: string | string[]): Promise<void> {
  const client = getSupabaseClient();
  const pathArray = Array.isArray(paths) ? paths : [paths];

  const { error } = await client.storage.from(bucket).remove(pathArray);

  if (error) {
    throw new Error(`Failed to delete from ${bucket}: ${error.message}`);
  }
}

/**
 * List files in a bucket/folder (excludes folders, only returns actual files)
 */
export async function listFiles(bucket: string, folder?: string): Promise<string[]> {
  const client = getSupabaseClient();

  const { data, error } = await client.storage.from(bucket).list(folder || "", {
    limit: 1000,
  });

  if (error) {
    throw new Error(`Failed to list ${bucket}/${folder || ""}: ${error.message}`);
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
  const client = getSupabaseClient();

  const { data, error } = await client.storage.from(bucket).list(
    path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "",
    { limit: 1, search: path.split("/").pop() }
  );

  if (error) return false;
  return data.length > 0;
}

/**
 * Get public URL for a file
 */
export function getPublicUrl(bucket: string, path: string): string {
  const client = getSupabaseClient();
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Create a signed URL for temporary access
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = getSupabaseClient();

  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error) {
    throw new Error(`Failed to create signed URL for ${bucket}/${path}: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Ensure storage buckets exist
 */
export async function ensureBucketsExist(): Promise<void> {
  const client = getSupabaseClient();

  for (const bucketName of Object.values(BUCKETS)) {
    const { data: buckets } = await client.storage.listBuckets();
    const exists = buckets?.some((b) => b.name === bucketName);

    if (!exists) {
      const { error } = await client.storage.createBucket(bucketName, {
        public: false,
      });
      if (error && !error.message.includes("already exists")) {
        console.error(`Failed to create bucket ${bucketName}:`, error);
      }
    }
  }
}
