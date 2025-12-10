import { NextRequest, NextResponse } from "next/server";
import { getJobOutputPdf } from "@/lib/fs-utils";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;
    const pdfBuffer = await getJobOutputPdf(jobId);

    if (!pdfBuffer) {
      return NextResponse.json(
        { error: "PDF not found. Please render first." },
        { status: 404 }
      );
    }

    return new NextResponse(pdfBuffer as Buffer<ArrayBuffer>, {
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
