import { NextRequest, NextResponse } from "next/server";
import { getJobSvgContent, getJob, getTemplateSvgContent } from "@/lib/fs-utils";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // First try to get job-specific SVG template
    let svgContent = await getJobSvgContent(jobId);
    const usedJobSvg = !!svgContent;

    // If no job-specific SVG, fall back to the original template
    if (!svgContent) {
      const job = await getJob(jobId);
      if (job) {
        svgContent = await getTemplateSvgContent(job.templateId);
      }
    }

    if (!svgContent) {
      return NextResponse.json(
        { error: "SVG template not found" },
        { status: 404 }
      );
    }

    // Log for debugging state mismatch
    const titleFontMatch = svgContent.match(/\.title-main\s*\{[^}]*font-size:\s*([^;]+)/);
    console.log(`[TemplateCode] Job ${jobId} - Using ${usedJobSvg ? "job-specific" : "original template"} SVG (${svgContent.length} chars)`);
    console.log(`[TemplateCode] Job ${jobId} - Title font-size: ${titleFontMatch ? titleFontMatch[1] : 'NOT FOUND'}`);

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error serving template code:", error);
    return NextResponse.json(
      { error: "Failed to serve template code" },
      { status: 500 }
    );
  }
}
