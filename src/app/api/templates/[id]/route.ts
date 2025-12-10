import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getTemplate, pathExists } from "@/lib/fs-utils";
import {
  getTemplateJsonPath,
  getTemplateDir,
  getTemplateThumbnailPath,
  getTemplateSchemaPath,
  getTemplateBasePdfPath,
  getTemplateOriginalPdfPath,
} from "@/lib/paths";
import { Template } from "@/lib/types";
import { fillPdfTemplate, FormTemplateSchema } from "@/lib/pdf-filler";

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
    const body = await request.json();

    // Ensure the template directory exists
    const templateDir = getTemplateDir(id);
    if (!(await pathExists(templateDir))) {
      await fs.mkdir(templateDir, { recursive: true });
    }

    // Handle new form-fill template save
    if (body.schema && body.basePdfBase64) {
      // Save schema.json
      const schemaPath = getTemplateSchemaPath(id);
      await fs.writeFile(schemaPath, JSON.stringify(body.schema, null, 2), "utf-8");

      // Save base.pdf
      const basePdfPath = getTemplateBasePdfPath(id);
      const basePdfData = body.basePdfBase64.split(",")[1];
      await fs.writeFile(basePdfPath, Buffer.from(basePdfData, "base64"));

      // Save original.pdf if provided
      if (body.originalPdfBase64) {
        const originalPdfPath = getTemplateOriginalPdfPath(id);
        const originalPdfData = body.originalPdfBase64.split(",")[1];
        await fs.writeFile(originalPdfPath, Buffer.from(originalPdfData, "base64"));
      }

      // Create template.json from schema
      const template: Template = body.templateJson || {
        id,
        name: body.name || "Generated Template",
        canvas: { width: 612, height: 792 },
        fonts: [],
        fields: schemaToFields(body.schema),
        assetSlots: schemaToAssetSlots(body.schema),
      };

      const jsonPath = getTemplateJsonPath(id);
      await fs.writeFile(jsonPath, JSON.stringify(template, null, 2), "utf-8");

      // Generate thumbnail from filled template
      try {
        const schema: FormTemplateSchema = body.schema;
        const fields: Record<string, string> = {};
        const assets: Record<string, string | null> = {};

        for (const page of schema.pages) {
          for (const field of page.fields) {
            if (field.type === "text") {
              fields[field.name] = `{{${field.name}}}`;
            } else {
              assets[field.name] = null;
            }
          }
        }

        const result = await fillPdfTemplate(basePdfPath, schema, {
          fields,
          assets,
          templateRoot: templateDir,
        });

        if (result.success && result.pngBase64) {
          const thumbnailPath = getTemplateThumbnailPath(id);
          const pngData = result.pngBase64.split(",")[1];
          await fs.writeFile(thumbnailPath, Buffer.from(pngData, "base64"));
        }
      } catch (thumbnailError) {
        console.error("Failed to generate thumbnail:", thumbnailError);
      }

      return NextResponse.json(template);
    }

    // Legacy template.json save
    const template: Template = body;
    const jsonPath = getTemplateJsonPath(id);
    await fs.writeFile(jsonPath, JSON.stringify(template, null, 2), "utf-8");

    return NextResponse.json(template);
  } catch (error) {
    console.error("Error updating template:", error);
    return NextResponse.json(
      { error: "Failed to update template" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const templateDir = getTemplateDir(id);

    if (!(await pathExists(templateDir))) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    await fs.rm(templateDir, { recursive: true, force: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting template:", error);
    return NextResponse.json(
      { error: "Failed to delete template" },
      { status: 500 }
    );
  }
}

/**
 * Convert form schema to template fields
 */
function schemaToFields(schema: FormTemplateSchema) {
  const fields: Array<{ name: string; type: string; description: string }> = [];

  for (const page of schema.pages) {
    for (const field of page.fields) {
      if (field.type === "text") {
        fields.push({
          name: field.name,
          type: "string",
          description: `Text field on page ${page.pageNumber}`,
        });
      }
    }
  }

  return fields;
}

/**
 * Convert form schema to asset slots
 */
function schemaToAssetSlots(schema: FormTemplateSchema) {
  const assetSlots: Array<{ name: string; kind: "photo" | "graph" | "logo"; description: string }> = [];

  for (const page of schema.pages) {
    for (const field of page.fields) {
      if (field.type === "image") {
        assetSlots.push({
          name: field.name,
          kind: "photo",
          description: `Image field on page ${page.pageNumber}`,
        });
      }
    }
  }

  return assetSlots;
}
