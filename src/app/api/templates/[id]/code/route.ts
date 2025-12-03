import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getTemplateTsxPath, getTemplateJsonPath } from "@/lib/paths";
import { pathExists } from "@/lib/fs-utils";

// GET - Get template code
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const codePath = getTemplateTsxPath(id);

    if (!(await pathExists(codePath))) {
      return new NextResponse("Template code not found", { status: 404 });
    }

    const code = await fs.readFile(codePath, "utf-8");
    return new NextResponse(code, {
      headers: { "Content-Type": "text/plain" },
    });
  } catch (error) {
    console.error("Error reading template code:", error);
    return NextResponse.json(
      { error: "Failed to read template code" },
      { status: 500 }
    );
  }
}

// PUT - Update template code
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const code = await request.text();
    const codePath = getTemplateTsxPath(id);

    await fs.writeFile(codePath, code, "utf-8");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating template code:", error);
    return NextResponse.json(
      { error: "Failed to update template code" },
      { status: 500 }
    );
  }
}
