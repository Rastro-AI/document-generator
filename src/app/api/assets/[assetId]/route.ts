import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getAssetBankFile, deleteAssetBankFile } from "@/lib/fs-utils";

// GET /api/assets/[assetId] - Get asset file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;

    // Security check - prevent path traversal
    if (assetId.includes("..") || assetId.includes("/")) {
      return NextResponse.json({ error: "Invalid asset ID" }, { status: 400 });
    }

    const fileBuffer = await getAssetBankFile(assetId);

    if (!fileBuffer) {
      return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    }

    const ext = path.extname(assetId).toLowerCase();

    // Determine content type
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
        "Cache-Control": "public, max-age=31536000",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
}

// DELETE /api/assets/[assetId] - Delete asset
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;

    // Security check - prevent path traversal
    if (assetId.includes("..") || assetId.includes("/")) {
      return NextResponse.json({ error: "Invalid asset ID" }, { status: 400 });
    }

    await deleteAssetBankFile(assetId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
