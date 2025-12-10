/**
 * Storage interface - always uses Supabase
 */

import {
  uploadFile as supabaseUpload,
  downloadFile as supabaseDownload,
  deleteFile as supabaseDelete,
  listFiles as supabaseList,
  fileExists as supabaseExists,
  BUCKETS,
  ensureBucketsExist,
} from "./supabase";

/**
 * Initialize storage (ensure buckets exist)
 */
export async function initStorage(): Promise<void> {
  await ensureBucketsExist();
}

/**
 * Upload a file
 */
export async function storageUpload(
  bucket: string,
  filePath: string,
  data: Buffer,
  options?: { contentType?: string }
): Promise<void> {
  await supabaseUpload(bucket, filePath, data, options);
}

/**
 * Download a file
 */
export async function storageDownload(bucket: string, filePath: string): Promise<Buffer> {
  return await supabaseDownload(bucket, filePath);
}

/**
 * Delete a file
 */
export async function storageDelete(bucket: string, filePath: string | string[]): Promise<void> {
  await supabaseDelete(bucket, filePath);
}

/**
 * List files in a folder
 */
export async function storageList(bucket: string, folder?: string): Promise<string[]> {
  return await supabaseList(bucket, folder);
}

/**
 * Check if a file exists
 */
export async function storageExists(bucket: string, filePath: string): Promise<boolean> {
  return await supabaseExists(bucket, filePath);
}

/**
 * Read a text file
 */
export async function storageReadText(bucket: string, filePath: string): Promise<string> {
  const buffer = await storageDownload(bucket, filePath);
  return buffer.toString("utf-8");
}

/**
 * Write a text file
 */
export async function storageWriteText(bucket: string, filePath: string, content: string): Promise<void> {
  await storageUpload(bucket, filePath, Buffer.from(content, "utf-8"), { contentType: "text/plain" });
}

/**
 * Read JSON file
 */
export async function storageReadJson<T>(bucket: string, filePath: string): Promise<T> {
  const content = await storageReadText(bucket, filePath);
  return JSON.parse(content) as T;
}

/**
 * Write JSON file
 */
export async function storageWriteJson(bucket: string, filePath: string, data: unknown): Promise<void> {
  await storageUpload(bucket, filePath, Buffer.from(JSON.stringify(data, null, 2), "utf-8"), {
    contentType: "application/json",
  });
}

// Re-export bucket names
export { BUCKETS };
