import { NextRequest, NextResponse } from "next/server";
import { getTemplate, getTemplateSvgContent } from "@/lib/fs-utils";
import { renderSVGTemplate, svgToPdf } from "@/lib/svg-template-renderer";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the template
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Check query params for format preference
    const searchParams = request.nextUrl.searchParams;
    const outputFormat = searchParams.get("format") || "pdf"; // "pdf" or "svg"

    // Get SVG template content
    const svgContent = await getTemplateSvgContent(id);
    if (!svgContent) {
      return NextResponse.json(
        { error: "SVG template not found" },
        { status: 404 }
      );
    }

    // Generate placeholder values from template fields
    const fields: Record<string, unknown> = {};
    for (const field of template.fields) {
      if (field.type === "array") {
        fields[field.name] = [`{{${field.name}[0]}}`, `{{${field.name}[1]}}`];
      } else {
        fields[field.name] = `{{${field.name}}}`;
      }
    }

    // Generate empty/placeholder assets
    const assets: Record<string, string | null> = {};
    for (const slot of template.assetSlots) {
      assets[slot.name] = null;
    }

    // Render SVG template with placeholder values
    const renderedSvg = renderSVGTemplate(svgContent, fields, assets);

    // Return SVG directly if requested
    if (outputFormat === "svg") {
      return new NextResponse(renderedSvg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache",
        },
      });
    }

    // Convert to PDF
    try {
      const pdfBuffer = await svgToPdf(renderedSvg);
      return new NextResponse(new Uint8Array(pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Cache-Control": "no-cache",
        },
      });
    } catch (pdfError) {
      console.error("SVG to PDF conversion failed:", pdfError);
      // Fall back to returning SVG if PDF conversion fails
      return new NextResponse(renderedSvg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "no-cache",
        },
      });
    }
  } catch (error) {
    console.error("Error generating preview:", error);
    return NextResponse.json(
      { error: "Failed to generate preview", details: String(error) },
      { status: 500 }
    );
  }
}
