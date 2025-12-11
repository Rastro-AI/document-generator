import { NextRequest, NextResponse } from "next/server";
import { updateJobAssets, addJobHistoryEntry, saveAssetFile, getJob } from "@/lib/fs-utils";

// PUT /api/jobs/[jobId]/assets - Update asset assignments
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const body = await request.json();
    const { assets } = body;

    if (!assets || typeof assets !== "object") {
      return NextResponse.json(
        { error: "assets object is required" },
        { status: 400 }
      );
    }

    // Save current state to history before updating
    await addJobHistoryEntry(jobId, "Asset assignment change");

    const job = await updateJobAssets(jobId, assets);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error("Error updating job assets:", error);
    return NextResponse.json(
      { error: "Failed to update job assets" },
      { status: 500 }
    );
  }
}

// POST /api/jobs/[jobId]/assets - Upload a new asset image
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const slotName = formData.get("slotName") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "file is required" },
        { status: 400 }
      );
    }

    if (!slotName) {
      return NextResponse.json(
        { error: "slotName is required" },
        { status: 400 }
      );
    }

    // Save the file to job's assets folder
    const buffer = Buffer.from(await file.arrayBuffer());
    await saveAssetFile(jobId, file.name, buffer);
    console.log(`[AssetUpload] Job ${jobId} - File saved: ${file.name}`);

    // Get current job to merge assets
    const currentJob = await getJob(jobId);
    if (!currentJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.log(`[AssetUpload] Job ${jobId} - Current assets:`, JSON.stringify(currentJob.assets));

    // Update the job's asset assignment (merge with existing)
    const assetPath = `${jobId}/assets/${file.name}`;
    const updatedAssets = { ...currentJob.assets, [slotName]: assetPath };
    console.log(`[AssetUpload] Job ${jobId} - Updating slot "${slotName}" to "${assetPath}"`);
    console.log(`[AssetUpload] Job ${jobId} - Updated assets will be:`, JSON.stringify(updatedAssets));

    const job = await updateJobAssets(jobId, updatedAssets);

    if (!job) {
      return NextResponse.json({ error: "Failed to update job" }, { status: 500 });
    }
    console.log(`[AssetUpload] Job ${jobId} - Job updated, final assets:`, JSON.stringify(job.assets));

    return NextResponse.json({
      success: true,
      assetPath,
      job
    });
  } catch (error) {
    console.error("Error uploading asset:", error);
    return NextResponse.json(
      { error: "Failed to upload asset" },
      { status: 500 }
    );
  }
}
