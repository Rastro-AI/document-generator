import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import { getTemplate, pathExists } from "@/lib/fs-utils";
import { getTemplateJsonPath, getTemplateDir, getTemplateSvgPath, getTemplateThumbnailPath, getTemplateSatoriDocPath } from "@/lib/paths";
import { Template, TemplateField, SatoriPageContent } from "@/lib/types";
import { renderSVGTemplate, svgToPng } from "@/lib/svg-template-renderer";
import { renderSatoriDocument } from "@/lib/satori-renderer";

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
    const body: Template & { satoriPages?: SatoriPageContent[] } = await request.json();

    // Ensure the template directory exists
    const templateDir = getTemplateDir(id);
    if (!(await pathExists(templateDir))) {
      await fs.mkdir(templateDir, { recursive: true });
    }

    // Extract satoriPages if present (they're sent with the template but stored separately)
    const satoriPages = body.satoriPages;
    delete body.satoriPages;

    // Set default format if not specified
    if (!body.format) {
      body.format = "svg";
    }

    // Write the template.json
    const jsonPath = getTemplateJsonPath(id);
    await fs.writeFile(jsonPath, JSON.stringify(body, null, 2), "utf-8");

    // Handle Satori format templates
    if (body.format === "satori" && satoriPages && satoriPages.length > 0) {
      // Save satori document
      const satoriDocPath = getTemplateSatoriDocPath(id);
      await fs.writeFile(satoriDocPath, JSON.stringify({ pages: satoriPages }, null, 2), "utf-8");

      // Generate thumbnail from Satori render
      try {
        // Build sample fields from template
        const sampleFields: Record<string, unknown> = {};
        for (const field of body.fields || []) {
          sampleFields[field.name] = generatePlaceholderValue(field);
        }

        // Build sample assets (placeholder images)
        const sampleAssets: Record<string, string> = {};
        for (const slot of body.assetSlots || []) {
          // Use a small gray placeholder
          sampleAssets[slot.name] = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6QwQCjUEm/YvVwAAABl0RVh0Q29tbWVudABDcmVhdGVkIHdpdGggR0lNUFeBDhcAAABYSURBVHja7cExAQAAAMKg9U9tCy+gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4GYNTgAB/dJqXwAAAABJRU5ErkJggg==";
        }

        const result = await renderSatoriDocument(
          {
            pageSize: body.satoriConfig?.pageSize || "A4",
            header: body.satoriConfig?.header,
            footer: body.satoriConfig?.footer,
            pages: satoriPages,
          },
          sampleFields,
          sampleAssets
        );

        if (result.pngBuffers.length > 0) {
          const thumbnailPath = getTemplateThumbnailPath(id);
          await fs.writeFile(thumbnailPath, result.pngBuffers[0]);
        }
      } catch (thumbnailError) {
        console.error("Failed to generate Satori thumbnail:", thumbnailError);
        // Don't fail the save if thumbnail generation fails
      }
    }
    // Handle SVG format templates
    else if (body.format === "svg") {
      const svgPath = getTemplateSvgPath(id);
      if (await pathExists(svgPath)) {
        try {
          const svgContent = await fs.readFile(svgPath, "utf-8");

          // Build sample fields from template - generate type-appropriate placeholders
          const sampleFields: Record<string, unknown> = {};
          for (const field of body.fields || []) {
            sampleFields[field.name] = generatePlaceholderValue(field);
          }

          // Render SVG with placeholders
          const renderedSvg = renderSVGTemplate(svgContent, sampleFields, {});

          // Convert to PNG for thumbnail
          const pngBuffer = await svgToPng(renderedSvg);
          const thumbnailPath = getTemplateThumbnailPath(id);
          await fs.writeFile(thumbnailPath, pngBuffer);
        } catch (thumbnailError) {
          console.error("Failed to generate thumbnail:", thumbnailError);
          // Don't fail the save if thumbnail generation fails
        }
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
