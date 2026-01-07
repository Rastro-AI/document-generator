import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getTemplate } from "@/lib/fs-utils";
import { renderSatoriPage } from "@/lib/satori-renderer";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const templatesDir = path.join(process.cwd(), "templates");
  const thumbnailPath = path.join(templatesDir, id, "thumbnail.png");

  // First try static thumbnail
  try {
    const thumbnailBuffer = await fs.readFile(thumbnailPath);
    return new NextResponse(thumbnailBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    // No static thumbnail - check if Satori template and generate one
  }

  // For Satori templates, generate a dynamic preview
  const template = await getTemplate(id);
  if (template?.format === "satori") {
    try {
      // Create a simple preview page with template info
      const previewJsx = `
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#f9fafb', padding: 48 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#1d1d1f', marginBottom: 16 }}>${template.name}</div>
            <div style={{ fontSize: 16, color: '#6b7280', marginBottom: 32 }}>Satori Document Template</div>
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, backgroundColor: 'white', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#1d1d1f' }}>${template.fields.length}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Fields</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 16, backgroundColor: 'white', borderRadius: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 600, color: '#1d1d1f' }}>${template.assetSlots.length}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Assets</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: '#9ca3af' }}>Multi-page • CSS/Flexbox • Dynamic content</div>
          </div>
        </div>
      `;

      const pageSize = template.satoriConfig?.pageSize || "A4";
      const { pngBuffer } = await renderSatoriPage(previewJsx, pageSize, {}, {}, template.fonts);

      return new NextResponse(new Uint8Array(pngBuffer), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=60", // Shorter cache for dynamic
        },
      });
    } catch (err) {
      console.error("[thumbnail] Failed to generate Satori preview:", err);
    }
  }

  return NextResponse.json(
    { error: "Thumbnail not found" },
    { status: 404 }
  );
}
