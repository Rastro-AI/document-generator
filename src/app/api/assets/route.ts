import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const ASSETS_DIR = path.join(process.cwd(), "data", "assets");

// Ensure assets directory exists
async function ensureAssetsDir() {
  try {
    await fs.mkdir(ASSETS_DIR, { recursive: true });
  } catch (error) {
    // Directory may already exist
  }
}

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
    await ensureAssetsDir();

    const files = await fs.readdir(ASSETS_DIR);
    const assets: Asset[] = [];

    for (const filename of files) {
      if (filename === ".gitkeep") continue;

      const filePath = path.join(ASSETS_DIR, filename);
      const stats = await fs.stat(filePath);

      const ext = path.extname(filename).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext);

      assets.push({
        id: filename,
        filename,
        type: isImage ? "image" : "document",
        size: stats.size,
        createdAt: stats.birthtime.toISOString(),
      });
    }

    // Sort by creation date, newest first
    assets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json(assets);
  } catch (error) {
    console.error("Failed to list assets:", error);
    return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
  }
}

// POST /api/assets - Upload new asset
export async function POST(request: NextRequest) {
  try {
    await ensureAssetsDir();

    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploadedAssets: Asset[] = [];

    for (const file of files) {
      // Generate unique filename
      const ext = path.extname(file.name);
      const baseName = path.basename(file.name, ext);
      const timestamp = Date.now();
      const uniqueFilename = `${baseName}-${timestamp}${ext}`;

      const filePath = path.join(ASSETS_DIR, uniqueFilename);
      const buffer = Buffer.from(await file.arrayBuffer());

      await fs.writeFile(filePath, buffer);

      const isImage = file.type.startsWith("image/");

      uploadedAssets.push({
        id: uniqueFilename,
        filename: uniqueFilename,
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
