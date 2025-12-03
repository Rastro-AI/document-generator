import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getTemplate, pathExists } from "@/lib/fs-utils";
import { getTemplateJsonPath, getTemplateDir } from "@/lib/paths";
import { Template } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const template = await getTemplate(id);

    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(template);
  } catch (error) {
    console.error("Error getting template:", error);
    return NextResponse.json(
      { error: "Failed to get template" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: Template = await request.json();

    // Ensure the template directory exists
    const templateDir = getTemplateDir(id);
    if (!(await pathExists(templateDir))) {
      await fs.mkdir(templateDir, { recursive: true });
    }

    // Write the template.json
    const jsonPath = getTemplateJsonPath(id);
    await fs.writeFile(jsonPath, JSON.stringify(body, null, 2), "utf-8");

    return NextResponse.json(body);
  } catch (error) {
    console.error("Error updating template:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}
