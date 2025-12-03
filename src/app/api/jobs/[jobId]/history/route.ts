import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  restoreJobFromHistory,
  addJobHistoryEntry,
} from "@/lib/fs-utils";

// POST - Restore job from history entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body = await request.json();
    const { historyId, description } = body;

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (historyId) {
      // Restore from specific history entry
      const restoredJob = await restoreJobFromHistory(jobId, historyId);
      if (!restoredJob) {
        return NextResponse.json(
          { error: "History entry not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Restored from history",
        job: restoredJob,
      });
    } else if (description) {
      // Create a new history entry (manual save point)
      const entry = await addJobHistoryEntry(jobId, description);
      if (!entry) {
        return NextResponse.json(
          { error: "Failed to create history entry" },
          { status: 500 }
        );
      }

      const updatedJob = await getJob(jobId);
      return NextResponse.json({
        success: true,
        message: "History entry created",
        entry,
        job: updatedJob,
      });
    }

    return NextResponse.json(
      { error: "historyId or description required" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error managing history:", error);
    return NextResponse.json(
      { error: "Failed to manage history", details: String(error) },
      { status: 500 }
    );
  }
}
