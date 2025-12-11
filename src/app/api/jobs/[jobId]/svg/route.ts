import { NextRequest, NextResponse } from "next/server";
import { getJobOutputSvg } from "@/lib/fs-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const svgContent = await getJobOutputSvg(jobId);

    if (!svgContent) {
      return NextResponse.json(
        { error: "SVG not found. Please render first." },
        { status: 404 }
      );
    }

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Content-Disposition": `inline; filename="output.svg"`,
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (error) {
    console.error("Error serving SVG:", error);
    return NextResponse.json(
      { error: "Failed to serve SVG" },
      { status: 500 }
    );
  }
}

