import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  listAssetBankFiles,
  uploadAssetBankFile,
  getAssetBankFile,
} from "@/lib/fs-utils";

export interface Asset {
  id: string;
  filename: string;
  type: "image" | "document";
  size: number;
  createdAt: string;
}

// GET /api/assets - List all assets
export async function GET() {
  try {
    const files = await listAssetBankFiles();
    const assets: Asset[] = [];

    for (const filename of files) {
      if (filename === ".gitkeep" || filename === ".emptyFolderPlaceholder") continue;

      const ext = path.extname(filename).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext);

      // For storage-based assets, we don't have exact size/date without additional calls
      // Use reasonable defaults
      assets.push({
        id: filename,
        filename,
        type: isImage ? "image" : "document",
        size: 0, // Size not available without downloading
        createdAt: new Date().toISOString(),
      });
    }

    // Sort by filename as we don't have creation dates
    assets.sort((a, b) => a.filename.localeCompare(b.filename));

    return NextResponse.json(assets);
  } catch (error) {
    console.error("Failed to list assets:", error);
    return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
  }
}

// POST /api/assets - Upload new asset
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploadedAssets: Asset[] = [];

    for (const file of files) {
      // Use the provided filename (user can customize it in the upload dialog)
      const filename = file.name;

      const buffer = Buffer.from(await file.arrayBuffer());

      await uploadAssetBankFile(filename, buffer, file.type);

      const isImage = file.type.startsWith("image/");

      uploadedAssets.push({
        id: filename,
        filename: filename,
        type: isImage ? "image" : "document",
        size: buffer.length,
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ success: true, assets: uploadedAssets });
  } catch (error) {
    console.error("Failed to upload assets:", error);
    return NextResponse.json({ error: "Failed to upload assets" }, { status: 500 });
  }
}
