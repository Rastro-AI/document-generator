import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { pathExists } from "@/lib/fs-utils";
import { getTemplateSchemaPath } from "@/lib/paths";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const schemaPath = getTemplateSchemaPath(id);

    if (!(await pathExists(schemaPath))) {
      return NextResponse.json(
        { error: "Schema not found for this template" },
        { status: 404 }
      );
    }

    const schemaContent = await fs.readFile(schemaPath, "utf-8");
    const schema = JSON.parse(schemaContent);

    return NextResponse.json(schema);
  } catch (error) {
    console.error("Error getting schema:", error);
    return NextResponse.json(
      { error: "Failed to get schema" },
      { status: 500 }
    );
  }
}
