import { NextRequest } from "next/server";
import { renderSVGTemplate, svgToPng } from "@/lib/svg-template-renderer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Render SVG template code to PNG image for preview
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

    // Check if it looks like SVG
    if (!code.trim().startsWith("<svg") && !code.trim().startsWith("<?xml")) {
      return new Response(
        JSON.stringify({ error: "Invalid SVG template - must start with <svg" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Render SVG with field values
    const renderedSvg = renderSVGTemplate(code, fields || {}, {});

    // Convert to PNG
    const pngBuffer = await svgToPng(renderedSvg);

    return new Response(new Uint8Array(pngBuffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Preview-code error:", error);
    return new Response(
      JSON.stringify({ error: "Preview failed", details: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
