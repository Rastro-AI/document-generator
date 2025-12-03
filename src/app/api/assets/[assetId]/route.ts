import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets");

// GET /api/assets/[assetId] - Get asset file
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetId: string }> }
) {
  try {
    const { assetId } = await params;
    const filePath = path.join(ASSETS_DIR, assetId);

    // Security check - prevent path traversal
    if (!filePath.startsWith(ASSETS_DIR)) {
      return NextResponse.json({ error: "Invalid asset ID" }, { status: 400 });
    }

    const fileBuffer = await fs.readFile(filePath);
    const ext = path.extname(assetId).toLowerCase();

    // Determine content type
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
    const filePath = path.join(ASSETS_DIR, assetId);

    // Security check - prevent path traversal
    if (!filePath.startsWith(ASSETS_DIR)) {
      return NextResponse.json({ error: "Invalid asset ID" }, { status: 400 });
    }

    await fs.unlink(filePath);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
