/**
 * Supabase Database Client for Jobs
 * Uses Postgres for job metadata (strong consistency)
 * Files still stored in Supabase Storage
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Job } from "./types";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabaseClient: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  }
  return supabaseClient;
}

export function isDbConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

// Job row type from database
interface JobRow {
  id: string;
  template_id: string;
  fields: Record<string, string | number | null>;
  assets: Record<string, string | null>;
  created_at: string;
  rendered_at: string | null;
  initial_message: string | null;
  uploaded_files: Array<{
    filename: string;
    path: string;
    type: "document" | "image";
    uploadedAt: string;
  }> | null;
  history: Array<{
    id: string;
    fields: Record<string, string | number | null>;
    assets: Record<string, string | null>;
    timestamp: string;
    description: string;
  }> | null;
  agent_history: unknown[] | null;
}

// Convert DB row to Job type
function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    templateId: row.template_id,
    fields: row.fields || {},
    assets: row.assets || {},
    createdAt: row.created_at,
    renderedAt: row.rendered_at || undefined,
    initialMessage: row.initial_message || undefined,
    uploadedFiles: row.uploaded_files || [],
    history: row.history || [],
    agentHistory: row.agent_history || undefined,
  };
}

// Convert Job to DB row
function jobToRow(job: Job): Omit<JobRow, "created_at"> & { created_at?: string } {
  return {
    id: job.id,
    template_id: job.templateId,
    fields: job.fields,
    assets: job.assets,
    created_at: job.createdAt,
    rendered_at: job.renderedAt || null,
    initial_message: job.initialMessage || null,
    uploaded_files: job.uploadedFiles || null,
    history: job.history || null,
    agent_history: job.agentHistory || null,
  };
}

/**
 * Get a job by ID
 */
export async function getJobFromDb(jobId: string): Promise<Job | null> {
  if (!isDbConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !data) {
    if (error && error.code !== "PGRST116") {
      console.error("Error fetching job:", error);
    }
    return null;
  }

  return rowToJob(data as JobRow);
}

/**
 * Create a new job
 */
export async function createJobInDb(job: Job): Promise<void> {
  if (!isDbConfigured()) return;

  const supabase = getSupabase();
  const row = jobToRow(job);

  const { error } = await supabase.from("jobs").insert(row);

  if (error) {
    throw new Error(`Failed to create job: ${error.message}`);
  }
}

/**
 * Update job fields
 */
export async function updateJobFieldsInDb(
  jobId: string,
  fields: Record<string, string | number | null>
): Promise<Job | null> {
  if (!isDbConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .update({ fields })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    console.error("Error updating job fields:", error);
    return null;
  }

  return rowToJob(data as JobRow);
}

/**
 * Update job assets
 */
export async function updateJobAssetsInDb(
  jobId: string,
  assets: Record<string, string | null>
): Promise<Job | null> {
  if (!isDbConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .update({ assets })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    console.error("Error updating job assets:", error);
    return null;
  }

  return rowToJob(data as JobRow);
}

/**
 * Mark job as rendered
 */
export async function markJobRenderedInDb(jobId: string): Promise<Job | null> {
  if (!isDbConfigured()) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .update({ rendered_at: new Date().toISOString() })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    console.error("Error marking job rendered:", error);
    return null;
  }

  return rowToJob(data as JobRow);
}

/**
 * Add uploaded file to job
 */
export async function addUploadedFileToJobInDb(
  jobId: string,
  file: { filename: string; path: string; type: string; uploadedAt: string }
): Promise<void> {
  if (!isDbConfigured()) return;

  const job = await getJobFromDb(jobId);
  if (!job) return;

  const uploadedFiles = [...(job.uploadedFiles || []), file];

  const supabase = getSupabase();
  const { error } = await supabase
    .from("jobs")
    .update({ uploaded_files: uploadedFiles })
    .eq("id", jobId);

  if (error) {
    console.error("Error adding uploaded file:", error);
  }
}

/**
 * Add history entry to job
 */
export async function addJobHistoryEntryInDb(
  jobId: string,
  description: string,
  svgContent?: string,
  previewBase64?: string
): Promise<void> {
  if (!isDbConfigured()) return;

  const job = await getJobFromDb(jobId);
  if (!job) return;

  const historyEntry: {
    id: string;
    fields: Record<string, unknown>;
    assets: Record<string, string | null>;
    timestamp: string;
    description: string;
    svgContent?: string;
    previewBase64?: string;
  } = {
    id: crypto.randomUUID(),
    fields: { ...job.fields },
    assets: { ...job.assets },
    timestamp: new Date().toISOString(),
    description,
  };

  // Store SVG content if provided
  if (svgContent) {
    historyEntry.svgContent = svgContent;
  }

  // Store preview thumbnail if provided (small base64 PNG)
  if (previewBase64) {
    historyEntry.previewBase64 = previewBase64;
  }

  const history = [...(job.history || []), historyEntry];

  const supabase = getSupabase();
  const { error } = await supabase
    .from("jobs")
    .update({ history })
    .eq("id", jobId);

  if (error) {
    console.error("Error adding history entry:", error);
  }
}

/**
 * Update agent history
 */
export async function updateAgentHistoryInDb(
  jobId: string,
  agentHistory: unknown[]
): Promise<void> {
  if (!isDbConfigured()) return;

  const supabase = getSupabase();
  const { error } = await supabase
    .from("jobs")
    .update({ agent_history: agentHistory })
    .eq("id", jobId);

  if (error) {
    console.error("Error updating agent history:", error);
  }
}

/**
 * Delete a job
 */
export async function deleteJobFromDb(jobId: string): Promise<void> {
  if (!isDbConfigured()) return;

  const supabase = getSupabase();
  const { error } = await supabase.from("jobs").delete().eq("id", jobId);

  if (error) {
    console.error("Error deleting job:", error);
  }
}

/**
 * List all jobs
 */
export async function listJobsFromDb(): Promise<Job[]> {
  if (!isDbConfigured()) return [];

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error listing jobs:", error);
    return [];
  }

  return (data as JobRow[]).map(rowToJob);
}

/**
 * Restore job from history entry
 */
export async function restoreJobFromHistoryInDb(
  jobId: string,
  historyId: string
): Promise<Job | null> {
  if (!isDbConfigured()) return null;

  const job = await getJobFromDb(jobId);
  if (!job) return null;

  const historyEntry = job.history?.find((h) => h.id === historyId);
  if (!historyEntry) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .update({
      fields: historyEntry.fields,
      assets: historyEntry.assets,
    })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    console.error("Error restoring from history:", error);
    return null;
  }

  return rowToJob(data as JobRow);
}
