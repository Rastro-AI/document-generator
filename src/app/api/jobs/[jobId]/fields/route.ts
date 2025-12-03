import { NextRequest, NextResponse } from "next/server";
import { updateJobFields, addJobHistoryEntry } from "@/lib/fs-utils";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body = await request.json();
    const { fields } = body;

    if (!fields || typeof fields !== "object") {
      return NextResponse.json(
        { error: "fields object is required" },
        { status: 400 }
      );
    }

    // Save current state to history before updating
    await addJobHistoryEntry(jobId, "Manual edit");

    const job = await updateJobFields(jobId, fields);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error("Error updating job fields:", error);
    return NextResponse.json(
      { error: "Failed to update job fields" },
      { status: 500 }
    );
  }
}
