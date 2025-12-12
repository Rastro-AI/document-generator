import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getAssetBankFile, deleteAssetBankFile, uploadAssetBankFile } from "@/lib/fs-utils";

// Special files for brand kit storage
const COLORS_FILE = "_brand_colors.json";
const FONTS_FILE = "_brand_fonts.json";

interface ColorAsset {
  id: string;
  type: "color";
  name: string;
  value: string;
  usage?: string;
  createdAt: string;
}

interface FontAsset {
  id: string;
  type: "font";
  name: string;
  family: string;
  weights: string[];
  usage?: string;
  createdAt: string;
}

// Helper functions for brand kit
async function loadBrandColors(): Promise<ColorAsset[]> {
  try {
    const data = await getAssetBankFile(COLORS_FILE);
    if (data) return JSON.parse(data.toString());
  } catch { /* File doesn't exist */ }
  return [];
}

async function saveBrandColors(colors: ColorAsset[]): Promise<void> {
  await uploadAssetBankFile(COLORS_FILE, Buffer.from(JSON.stringify(colors, null, 2)), "application/json");
}

async function loadBrandFonts(): Promise<FontAsset[]> {
  try {
    const data = await getAssetBankFile(FONTS_FILE);
    if (data) return JSON.parse(data.toString());
  } catch { /* File doesn't exist */ }
  return [];
}

async function saveBrandFonts(fonts: FontAsset[]): Promise<void> {
  await uploadAssetBankFile(FONTS_FILE, Buffer.from(JSON.stringify(fonts, null, 2)), "application/json");
}

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

// DELETE /api/assets/[assetId] - Delete asset (file, color, or font)
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

    // Handle color deletion
    if (assetId.startsWith("color-")) {
      const colors = await loadBrandColors();
      const filtered = colors.filter(c => c.id !== assetId);
      if (filtered.length === colors.length) {
        return NextResponse.json({ error: "Color not found" }, { status: 404 });
      }
      await saveBrandColors(filtered);
      return NextResponse.json({ success: true });
    }

    // Handle font deletion
    if (assetId.startsWith("font-")) {
      const fonts = await loadBrandFonts();
      const filtered = fonts.filter(f => f.id !== assetId);
      if (filtered.length === fonts.length) {
        return NextResponse.json({ error: "Font not found" }, { status: 404 });
      }
      await saveBrandFonts(filtered);
      return NextResponse.json({ success: true });
    }

    // Handle file deletion
    await deleteAssetBankFile(assetId);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to delete asset" }, { status: 500 });
  }
}
