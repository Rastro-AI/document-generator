import { NextRequest, NextResponse } from "next/server";
import {
  getJob,
  getTemplate,
  markJobRendered,
  getJobSatoriDocument,
  saveJobOutputPdf,
  saveJobOutputSvg,
  getAssetBankFile,
  getAssetFile,
} from "@/lib/fs-utils";
import { prepareAssets } from "@/lib/svg-template-renderer";
import { renderSatoriDocument, SatoriDocument } from "@/lib/satori-renderer";

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

    // Always use Satori format - SVG is deprecated
    const satoriDocument = await getJobSatoriDocument(jobId);

    if (!satoriDocument || satoriDocument.pages.length === 0) {
      return NextResponse.json(
        { error: "No Satori document pages found" },
        { status: 404 }
      );
    }

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

    // Prepare assets for rendering
    const preparedAssets = await prepareAssets(assets);

    // Debug: log fields and assets being rendered
    console.log(`[Render] Job ${jobId} - Fields:`, JSON.stringify(job.fields, null, 2));
    console.log(`[Render] Job ${jobId} - Job assets (raw):`, JSON.stringify(job.assets, null, 2));
    console.log(`[Render] Job ${jobId} - Prepared assets:`, Object.entries(preparedAssets).map(([k, v]) =>
      `${k}: ${v ? (v.startsWith('data:') ? `data URL (${v.length} chars)` : v) : 'null'}`
    ));

    // Always use Satori rendering
    console.log(`[Render] Job ${jobId} - Using Satori renderer (${satoriDocument.pages.length} pages)`);

    const satoriDoc: SatoriDocument = {
      pageSize: template.satoriConfig?.pageSize || "A4",
      header: template.satoriConfig?.header,
      footer: template.satoriConfig?.footer,
      pages: satoriDocument.pages,
    };

    const result = await renderSatoriDocument(satoriDoc, job.fields, preparedAssets, template.fonts);

    // Use first page SVG as the "rendered" SVG for preview
    const renderedSvg = result.svgs[0] || "<svg></svg>";
    const pdfBuffer = result.pdfBuffer;

    console.log(`[Render] Job ${jobId} - Satori rendered ${result.svgs.length} pages, PDF size: ${pdfBuffer.length}`);

    // Save both SVG and PDF outputs to Supabase storage
    await saveJobOutputSvg(jobId, renderedSvg);
    await saveJobOutputPdf(jobId, pdfBuffer);

    // Mark as rendered and get the updated job with the renderedAt timestamp
    const updatedJob = await markJobRendered(jobId);

    return NextResponse.json({
      ok: true,
      // Use the same timestamp that was stored in DB to avoid sync issues
      renderedAt: updatedJob?.renderedAt || new Date().toISOString(),
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
