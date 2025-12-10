import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getTemplateSvgPath, getTemplateDir } from "@/lib/paths";
import { pathExists } from "@/lib/fs-utils";

// GET - Get template SVG code
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const codePath = getTemplateSvgPath(id);

    if (!(await pathExists(codePath))) {
      return new NextResponse("Template SVG not found", { status: 404 });
    }

    const code = await fs.readFile(codePath, "utf-8");
    return new NextResponse(code, {
      headers: { "Content-Type": "image/svg+xml" },
    });
  } catch (error) {
    console.error("Error reading template SVG:", error);
    return NextResponse.json(
      { error: "Failed to read template SVG" },
      { status: 500 }
    );
  }
}

// PUT - Update template SVG code
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const code = await request.text();
    const codePath = getTemplateSvgPath(id);
    const templateDir = getTemplateDir(id);

    // Ensure template directory exists
    await fs.mkdir(templateDir, { recursive: true });

    await fs.writeFile(codePath, code, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating template SVG:", error);
    return NextResponse.json(
      { error: "Failed to update template SVG" },
      { status: 500 }
    );
  }
}
