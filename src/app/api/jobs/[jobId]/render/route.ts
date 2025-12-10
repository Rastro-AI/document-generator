import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  getTemplate,
  markJobRendered,
  getTemplateSvgContent,
  getJobSvgContent,
  saveJobOutputPdf,
  saveJobOutputSvg,
  getAssetBankFile,
} from "@/lib/fs-utils";
import { renderSVGTemplate, prepareAssets, svgToPdf } from "@/lib/svg-template-renderer";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Get the job
    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get the template
    const template = await getTemplate(job.templateId);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Get SVG template content
    // Try job-specific SVG first, then fall back to template SVG
    let svgContent = await getJobSvgContent(jobId);
    if (!svgContent) {
      svgContent = await getTemplateSvgContent(job.templateId);
    }

    if (!svgContent) {
      return NextResponse.json(
        { error: "SVG template not found" },
        { status: 404 }
      );
    }

    // Prepare assets - convert image paths/references to data URLs
    const assets: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(job.assets)) {
      if (value) {
        try {
          // Value could be a storage path or asset bank reference
          // Try to load from asset bank
          const assetFilename = value.includes("/") ? value.split("/").pop()! : value;
          const imageBuffer = await getAssetBankFile(assetFilename);

          if (imageBuffer) {
            const ext = assetFilename.split(".").pop()?.toLowerCase() || "png";
            const mimeTypes: Record<string, string> = {
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              gif: "image/gif",
              webp: "image/webp",
              svg: "image/svg+xml",
            };
            const mimeType = mimeTypes[ext] || "application/octet-stream";
            assets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          } else {
            assets[key] = null;
          }
        } catch (err) {
          console.error(`Failed to process image ${value}:`, err);
          assets[key] = null;
        }
      } else {
        assets[key] = null;
      }
    }

    // Prepare assets for SVG rendering
    const preparedAssets = await prepareAssets(assets);

    // Render SVG template with field values
    const renderedSvg = renderSVGTemplate(svgContent, job.fields, preparedAssets);

    // Convert SVG to PDF
    const pdfBuffer = await svgToPdf(renderedSvg);

    // Save both SVG and PDF outputs to Supabase storage
    await saveJobOutputSvg(jobId, renderedSvg);
    await saveJobOutputPdf(jobId, pdfBuffer);

    // Mark as rendered
    await markJobRendered(jobId);

    return NextResponse.json({
      ok: true,
      renderedAt: new Date().toISOString(),
      format: "svg",
    });
  } catch (error) {
    console.error("Error rendering PDF:", error);
    return NextResponse.json(
      { error: "Failed to render PDF", details: String(error) },
      { status: 500 }
    );
  }
}
