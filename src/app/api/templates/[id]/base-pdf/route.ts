import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { pathExists } from "@/lib/fs-utils";
import { getTemplateBasePdfPath } from "@/lib/paths";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const basePdfPath = getTemplateBasePdfPath(id);

    if (!(await pathExists(basePdfPath))) {
      return NextResponse.json(
        { error: "Base PDF not found for this template" },
        { status: 404 }
      );
    }

    const pdfBuffer = await fs.readFile(basePdfPath);

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${id}-base.pdf"`,
      },
    });
  } catch (error) {
    console.error("Error getting base PDF:", error);
    return NextResponse.json(
      { error: "Failed to get base PDF" },
      { status: 500 }
    );
  }
}
