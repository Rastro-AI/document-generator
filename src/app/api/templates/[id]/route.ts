import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getTemplate, pathExists } from "@/lib/fs-utils";
import { getTemplateJsonPath, getTemplateDir, getTemplateCodePath, getTemplateThumbnailPath } from "@/lib/paths";
import { Template, TemplateField } from "@/lib/types";
import { renderTemplateCode } from "@/lib/template-renderer";

/**
 * Generate placeholder value for a field based on its type
 */
function generatePlaceholderValue(field: TemplateField): unknown {
  const placeholder = `{{${field.name}}}`;

  switch (field.type) {
    case "array":
      if (field.items?.type === "object" && field.items.properties) {
        const sampleObject: Record<string, string> = {};
        for (const key of Object.keys(field.items.properties)) {
          sampleObject[key] = `{{${field.name}[].${key}}}`;
        }
        return [sampleObject, sampleObject];
      } else {
        return [`{{${field.name}[0]}}`, `{{${field.name}[1]}}`];
      }

    case "object":
      if (field.properties) {
        const sampleObject: Record<string, unknown> = {};
        for (const [key, prop] of Object.entries(field.properties)) {
          if (prop.type === "array") {
            sampleObject[key] = [`{{${field.name}.${key}[0]}}`, `{{${field.name}.${key}[1]}}`];
          } else {
            sampleObject[key] = `{{${field.name}.${key}}}`;
          }
        }
        return sampleObject;
      }
      return { value: placeholder };

    case "boolean":
      return true;

    case "string":
    case "number":
    default:
      return placeholder;
  }
}

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

    // Generate thumbnail if template code exists
    const codePath = getTemplateCodePath(id);
    if (await pathExists(codePath)) {
      try {
        const code = await fs.readFile(codePath, "utf-8");

        // Build sample fields from template - generate type-appropriate placeholders
        const sampleFields: Record<string, unknown> = {};
        for (const field of body.fields || []) {
          sampleFields[field.name] = generatePlaceholderValue(field);
        }

        const result = await renderTemplateCode(code, {
          fields: sampleFields,
          assets: {},
          templateRoot: templateDir,
          outputFormat: "png",
          dpi: 150,
        });

        if (result.success && result.pngBase64) {
          const thumbnailPath = getTemplateThumbnailPath(id);
          const pngData = result.pngBase64.split(",")[1];
          await fs.writeFile(thumbnailPath, Buffer.from(pngData, "base64"));
        }
      } catch (thumbnailError) {
        console.error("Failed to generate thumbnail:", thumbnailError);
        // Don't fail the save if thumbnail generation fails
      }
    }

    return NextResponse.json(body);
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

    // Delete the entire template directory
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
