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
  getAssetFile,
} from "@/lib/fs-utils";
import { renderSVGTemplate, prepareAssets, svgToPdf } from "@/lib/svg-template-renderer";

export const maxDuration = 120; // 2 minutes for rendering

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Get the job (now uses Postgres DB with strong consistency)
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
    const usedJobSvg = !!svgContent;
    if (!svgContent) {
      svgContent = await getTemplateSvgContent(job.templateId);
    }

    if (!svgContent) {
      return NextResponse.json(
        { error: "SVG template not found" },
        { status: 404 }
      );
    }

    // Calculate hash for debugging sync issues
    let svgHash = 0;
    for (let i = 0; i < svgContent.length; i++) {
      const char = svgContent.charCodeAt(i);
      svgHash = ((svgHash << 5) - svgHash) + char;
      svgHash = svgHash & svgHash;
    }
    const hashStr = svgHash.toString(16);
    const timestamp = new Date().toISOString();
    console.log(`[Render] [${timestamp}] Job ${jobId} - Using ${usedJobSvg ? "job-specific" : "template"} SVG (${svgContent.length} chars, hash=${hashStr})`);
    console.log(`[Render] Job ${jobId} - SVG preview: ${svgContent.substring(0, 200)}...`);
    // Log title font-size to debug state mismatch
    const titleFontMatch = svgContent.match(/\.title-main\s*\{[^}]*font-size:\s*([^;]+)/);
    console.log(`[Render] Job ${jobId} - Title font-size in SVG: ${titleFontMatch ? titleFontMatch[1] : 'NOT FOUND'}`);

    // Prepare assets - convert image paths/references to data URLs
    const assets: Record<string, string | null> = {};
    for (const [key, value] of Object.entries(job.assets)) {
      if (value) {
        try {
          // Value could be a job asset path or asset bank reference
          const assetFilename = value.includes("/") ? value.split("/").pop()! : value;
          let imageBuffer: Buffer | null = null;

          // First try to load from job's assets folder
          imageBuffer = await getAssetFile(jobId, assetFilename);

          // If not found in job assets, try asset bank
          if (!imageBuffer) {
            imageBuffer = await getAssetBankFile(assetFilename);
          }

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
            console.warn(`Asset not found: ${value} (tried job assets and asset bank)`);
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

    // Debug: log fields and assets being rendered
    console.log(`[Render] Job ${jobId} - Fields:`, JSON.stringify(job.fields, null, 2));
    console.log(`[Render] Job ${jobId} - Job assets (raw):`, JSON.stringify(job.assets, null, 2));
    console.log(`[Render] Job ${jobId} - Prepared assets:`, Object.entries(preparedAssets).map(([k, v]) =>
      `${k}: ${v ? (v.startsWith('data:') ? `data URL (${v.length} chars)` : v) : 'null'}`
    ));

    // Render SVG template with field values
    const renderedSvg = renderSVGTemplate(svgContent, job.fields, preparedAssets);

    // Debug: check if placeholders remain
    const remainingPlaceholders = renderedSvg.match(/\{\{[A-Z_]+\}\}/g);
    if (remainingPlaceholders && remainingPlaceholders.length > 0) {
      console.log(`[Render] Job ${jobId} - Remaining placeholders:`, remainingPlaceholders);
    }

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
