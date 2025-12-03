import { NextRequest, NextResponse } from "next/server";
import { getJob, removeUploadedFileFromJob } from "@/lib/fs-utils";
import { getJobDir, getJobAssetsDir } from "@/lib/paths";
import fs from "fs/promises";
import path from "path";

// GET - Retrieve a file (for preview)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; filename: string }> }
) {
  try {
    const { jobId, filename } = await params;
    const decodedFilename = decodeURIComponent(filename);

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Find the file in uploadedFiles
    const uploadedFile = job.uploadedFiles?.find((f) => f.filename === decodedFilename);
    if (!uploadedFile) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Determine the file path
    let filePath: string;
    if (uploadedFile.type === "image") {
      filePath = path.join(getJobAssetsDir(jobId), decodedFilename);
    } else {
      filePath = path.join(getJobDir(jobId), decodedFilename);
    }

    // Read the file
    const fileBuffer = await fs.readFile(filePath);

    // Determine content type
    const ext = path.extname(decodedFilename).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".pdf": "application/pdf",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".csv": "text/csv",
    };

    const contentType = contentTypes[ext] || "application/octet-stream";

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${decodedFilename}"`,
      },
    });
  } catch (error) {
    console.error("Error retrieving file:", error);
    return NextResponse.json(
      { error: "Failed to retrieve file", details: String(error) },
      { status: 500 }
    );
  }
}

// DELETE - Remove an uploaded file
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; filename: string }> }
) {
  try {
    const { jobId, filename } = await params;
    const decodedFilename = decodeURIComponent(filename);

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Find the file in uploadedFiles
    const uploadedFile = job.uploadedFiles?.find((f) => f.filename === decodedFilename);
    if (!uploadedFile) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    // Determine the file path and try to delete the actual file
    let filePath: string;
    if (uploadedFile.type === "image") {
      filePath = path.join(getJobAssetsDir(jobId), decodedFilename);
    } else {
      filePath = path.join(getJobDir(jobId), decodedFilename);
    }

    try {
      await fs.unlink(filePath);
    } catch {
      // File might not exist, that's okay
    }

    // Remove from job record
    const updatedJob = await removeUploadedFileFromJob(jobId, decodedFilename);

    return NextResponse.json({
      success: true,
      job: updatedJob,
    });
  } catch (error) {
    console.error("Error removing file:", error);
    return NextResponse.json(
      { error: "Failed to remove file", details: String(error) },
      { status: 500 }
    );
  }
}
