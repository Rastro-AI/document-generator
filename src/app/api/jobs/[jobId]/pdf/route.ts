import { NextRequest, NextResponse } from "next/server";
import { getJobOutputPdfPath } from "@/lib/paths";
import { pathExists } from "@/lib/fs-utils";
import fs from "fs/promises";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const pdfPath = getJobOutputPdfPath(jobId);

    if (!(await pathExists(pdfPath))) {
      return NextResponse.json(
        { error: "PDF not found. Please render first." },
        { status: 404 }
      );
    }

    const pdfBuffer = await fs.readFile(pdfPath);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="output.pdf"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Error serving PDF:", error);
    return NextResponse.json(
      { error: "Failed to serve PDF" },
      { status: 500 }
    );
  }
}
