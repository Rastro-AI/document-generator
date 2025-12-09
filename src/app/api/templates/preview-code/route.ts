import { NextRequest } from "next/server";
import { renderTemplateCode } from "@/lib/template-renderer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Render template code to PNG image for preview
 * Uses shared template renderer utility
 */
export async function POST(request: NextRequest) {
  try {
    const { code, fields } = await request.json();

    if (!code) {
      return new Response(JSON.stringify({ error: "Template code is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Use shared renderer
    const result = await renderTemplateCode(code, {
      fields: fields || {},
      assets: {},
      outputFormat: "png",
      dpi: 150,
    });

    if (!result.success) {
      return new Response(
        JSON.stringify({ error: result.error }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Convert base64 to buffer and return as PNG
    const base64Data = result.pngBase64!.replace(/^data:image\/png;base64,/, "");
    const pngBuffer = Buffer.from(base64Data, "base64");

    return new Response(pngBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Preview failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
