import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const templatesDir = path.join(process.cwd(), "templates");
  const thumbnailPath = path.join(templatesDir, id, "thumbnail.png");

  try {
    const thumbnailBuffer = await fs.readFile(thumbnailPath);
    return new NextResponse(thumbnailBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Thumbnail not found" },
      { status: 404 }
    );
  }
}
