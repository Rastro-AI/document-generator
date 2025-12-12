import { NextRequest, NextResponse } from "next/server";
import path from "path";
import {
  listAssetBankFiles,
  uploadAssetBankFile,
  getAssetBankFile,
} from "@/lib/fs-utils";

// File asset (images, documents)
export interface FileAsset {
  id: string;
  filename: string;
  type: "image" | "document";
  size: number;
  createdAt: string;
}

// Color asset for brand colors
export interface ColorAsset {
  id: string;
  type: "color";
  name: string;
  value: string;
  usage?: "primary" | "secondary" | "accent" | "text" | "background";
  createdAt: string;
}

// Font asset for brand fonts
export interface FontAsset {
  id: string;
  type: "font";
  name: string;
  family: string;
  weights: string[];
  usage?: "heading" | "body" | "accent";
  createdAt: string;
}

export type Asset = FileAsset | ColorAsset | FontAsset;

// Special files for brand kit storage
const COLORS_FILE = "_brand_colors.json";
const FONTS_FILE = "_brand_fonts.json";

// Helper to load brand colors
async function loadBrandColors(): Promise<ColorAsset[]> {
  try {
    const data = await getAssetBankFile(COLORS_FILE);
    if (data) {
      return JSON.parse(data.toString());
    }
  } catch {
    // File doesn't exist yet
  }
  return [];
}

// Helper to save brand colors
async function saveBrandColors(colors: ColorAsset[]): Promise<void> {
  await uploadAssetBankFile(COLORS_FILE, Buffer.from(JSON.stringify(colors, null, 2)), "application/json");
}

// Helper to load brand fonts
async function loadBrandFonts(): Promise<FontAsset[]> {
  try {
    const data = await getAssetBankFile(FONTS_FILE);
    if (data) {
      return JSON.parse(data.toString());
    }
  } catch {
    // File doesn't exist yet
  }
  return [];
}

// Helper to save brand fonts
async function saveBrandFonts(fonts: FontAsset[]): Promise<void> {
  await uploadAssetBankFile(FONTS_FILE, Buffer.from(JSON.stringify(fonts, null, 2)), "application/json");
}

// GET /api/assets - List all assets (files + colors + fonts)
export async function GET() {
  try {
    const files = await listAssetBankFiles();
    const assets: Asset[] = [];

    // Load file assets
    for (const filename of files) {
      // Skip special files
      if (filename === ".gitkeep" || filename === ".emptyFolderPlaceholder") continue;
      if (filename === COLORS_FILE || filename === FONTS_FILE) continue;

      const ext = path.extname(filename).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext);

      assets.push({
        id: filename,
        filename,
        type: isImage ? "image" : "document",
        size: 0,
        createdAt: new Date().toISOString(),
      });
    }

    // Load brand colors and fonts
    const colors = await loadBrandColors();
    const fonts = await loadBrandFonts();

    // Combine all assets
    const allAssets: Asset[] = [...assets, ...colors, ...fonts];

    // Sort files by filename, keep colors and fonts grouped
    allAssets.sort((a, b) => {
      // Sort by type first: colors, fonts, then files
      const typeOrder = { color: 0, font: 1, image: 2, document: 3 };
      const aOrder = typeOrder[a.type];
      const bOrder = typeOrder[b.type];
      if (aOrder !== bOrder) return aOrder - bOrder;

      // Then by name/filename
      const aName = a.type === "color" || a.type === "font" ? a.name : a.filename;
      const bName = b.type === "color" || b.type === "font" ? b.name : b.filename;
      return aName.localeCompare(bName);
    });

    return NextResponse.json(allAssets);
  } catch (error) {
    console.error("Failed to list assets:", error);
    return NextResponse.json({ error: "Failed to list assets" }, { status: 500 });
  }
}

// POST /api/assets - Upload new asset (files via FormData, colors/fonts via JSON)
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";

    // Handle JSON body for colors and fonts
    if (contentType.includes("application/json")) {
      const body = await request.json();

      if (body.type === "color") {
        const colors = await loadBrandColors();
        const newColor: ColorAsset = {
          id: `color-${Date.now()}`,
          type: "color",
          name: body.name,
          value: body.value,
          usage: body.usage,
          createdAt: new Date().toISOString(),
        };
        colors.push(newColor);
        await saveBrandColors(colors);
        return NextResponse.json({ success: true, asset: newColor });
      }

      if (body.type === "font") {
        const fonts = await loadBrandFonts();
        const newFont: FontAsset = {
          id: `font-${Date.now()}`,
          type: "font",
          name: body.name,
          family: body.family,
          weights: body.weights || ["400"],
          usage: body.usage,
          createdAt: new Date().toISOString(),
        };
        fonts.push(newFont);
        await saveBrandFonts(fonts);
        return NextResponse.json({ success: true, asset: newFont });
      }

      return NextResponse.json({ error: "Invalid asset type" }, { status: 400 });
    }

    // Handle FormData for file uploads
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const uploadedAssets: Asset[] = [];

    for (const file of files) {
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
