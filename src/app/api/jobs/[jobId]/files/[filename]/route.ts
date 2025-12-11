import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  removeUploadedFileFromJob,
  getUploadedFile,
  getAssetFile,
  deleteUploadedFile,
} from "@/lib/fs-utils";
import path from "path";

// GET - Retrieve a file (for preview)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; filename: string }> }
) {
  try {
    const { jobId, filename } = await params;
    const decodedFilename = decodeURIComponent(filename);
    const url = new URL(request.url);
    const fileType = url.searchParams.get("type");

    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    let fileBuffer: Buffer | null = null;

    // If type=asset is specified, check assets folder directly
    if (fileType === "asset") {
      fileBuffer = await getAssetFile(jobId, decodedFilename);
    } else {
      // Find the file in uploadedFiles
      const uploadedFile = job.uploadedFiles?.find((f) => f.filename === decodedFilename);

      if (uploadedFile) {
        // Get file from storage based on type
        if (uploadedFile.type === "image") {
          fileBuffer = await getAssetFile(jobId, decodedFilename);
        } else {
          fileBuffer = await getUploadedFile(jobId, decodedFilename);
        }
      } else {
        // Fallback: try assets folder anyway (for uploaded assets not in uploadedFiles list)
        fileBuffer = await getAssetFile(jobId, decodedFilename);
        if (!fileBuffer) {
          fileBuffer = await getUploadedFile(jobId, decodedFilename);
        }
      }
    }

    if (!fileBuffer) {
      return NextResponse.json({ error: "File not found in storage" }, { status: 404 });
    }

    // Determine content type
    const ext = path.extname(decodedFilename).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ".xls": "application/vnd.ms-excel",
      ".csv": "text/csv",
    };

    const contentType = contentTypes[ext] || "application/octet-stream";

    return new NextResponse(fileBuffer as Buffer<ArrayBuffer>, {
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

    // Try to delete the actual file from storage
    try {
      await deleteUploadedFile(jobId, decodedFilename);
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
