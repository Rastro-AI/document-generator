/**
 * Template Upload API
 * POST /api/templates/upload
 *
 * Upload an IDML file to create a new template.
 * Analyzes the IDML and returns structure info for configuration.
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { analyzeIdml, setRectangleNames } from "@/lib/idml-analyzer";
import { TEMPLATES_DIR } from "@/lib/paths";
import { renderIdmlTemplate } from "@/lib/idml-renderer";
import { execSync } from "child_process";

interface FieldConfig {
  name: string;
  type: "text" | "textarea" | "number";
  description: string;
  required: boolean;
}

interface AssetSlotConfig {
  name: string;
  description: string;
  required: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const templateId = formData.get("templateId") as string | null;
    const templateName = formData.get("templateName") as string | null;
    const action = formData.get("action") as string | null; // "analyze", "preview", or "create"

    // Field and asset slot configurations
    const fieldConfigsJson = formData.get("fieldConfigs") as string | null;
    const assetSlotConfigsJson = formData.get("assetSlotConfigs") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.name.endsWith(".idml")) {
      return NextResponse.json({ error: "File must be an IDML file" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Action: Analyze only
    if (action === "analyze" || !action) {
      const analysis = await analyzeIdml(buffer as Buffer<ArrayBuffer>);

      return NextResponse.json({
        success: true,
        analysis,
      });
    }

    // Action: Generate preview image
    if (action === "preview") {
      try {
        const analysis = await analyzeIdml(buffer as Buffer<ArrayBuffer>);

        // Create temp directory for preview
        const tempDir = `/tmp/idml-preview-${Date.now()}`;
        await fs.mkdir(tempDir, { recursive: true });
        const tempIdmlPath = path.join(tempDir, "template.idml");
        await fs.writeFile(tempIdmlPath, buffer);

        // Render with placeholder values
        const emptyFields: Record<string, string> = {};
        for (const placeholder of analysis.textPlaceholders) {
          emptyFields[placeholder.name] = `{{${placeholder.name}}}`;
        }

        const result = await renderIdmlTemplate(tempIdmlPath, { fields: emptyFields, assets: {} });

        // Cleanup temp IDML
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

        if (!result.pdfBuffer) {
          console.error("IDML render failed:", result.error);
          return NextResponse.json({ error: result.error || "Failed to render preview" }, { status: 500 });
        }

        // Convert PDF to PNG
        const tempPdfPath = `/tmp/preview-${Date.now()}.pdf`;
        const tempPngBase = `/tmp/preview-${Date.now()}`;
        await fs.writeFile(tempPdfPath, result.pdfBuffer);

        try {
          execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${tempPdfPath}" "${tempPngBase}"`);
          const pngBuffer = await fs.readFile(`${tempPngBase}-1.png`);

          // Cleanup
          await fs.unlink(tempPdfPath).catch(() => {});
          await fs.unlink(`${tempPngBase}-1.png`).catch(() => {});

          return new NextResponse(pngBuffer, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "no-cache",
            },
          });
        } catch (err) {
          console.error("Failed to convert PDF to PNG:", err);
          // Return PDF if PNG conversion fails
          await fs.unlink(tempPdfPath).catch(() => {});
          return new NextResponse(result.pdfBuffer as Buffer<ArrayBuffer>, {
            headers: {
              "Content-Type": "application/pdf",
              "Cache-Control": "no-cache",
            },
          });
        }
      } catch (err) {
        console.error("Preview generation error:", err);
        const errMsg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `Failed to generate preview: ${errMsg}` }, { status: 500 });
      }
    }

    // Action: Create template
    if (action === "create") {
      if (!templateId || !templateName) {
        return NextResponse.json(
          { error: "templateId and templateName required for create action" },
          { status: 400 }
        );
      }

      // Validate templateId format
      if (!/^[a-z0-9-]+$/.test(templateId)) {
        return NextResponse.json(
          { error: "templateId must contain only lowercase letters, numbers, and hyphens" },
          { status: 400 }
        );
      }

      // Check if template already exists
      const templateDir = path.join(TEMPLATES_DIR, templateId);
      if (await fs.stat(templateDir).catch(() => null)) {
        return NextResponse.json(
          { error: "Template with this ID already exists" },
          { status: 409 }
        );
      }

      // Parse field and asset slot configs
      let fieldConfigs: FieldConfig[] = [];
      let assetSlotConfigs: AssetSlotConfig[] = [];

      if (fieldConfigsJson) {
        try {
          fieldConfigs = JSON.parse(fieldConfigsJson);
        } catch (e) {
          console.error("Failed to parse fieldConfigs:", e);
        }
      }

      if (assetSlotConfigsJson) {
        try {
          assetSlotConfigs = JSON.parse(assetSlotConfigsJson);
        } catch (e) {
          console.error("Failed to parse assetSlotConfigs:", e);
        }
      }

      // If no field configs provided, analyze and generate defaults
      if (fieldConfigs.length === 0) {
        const analysis = await analyzeIdml(buffer as Buffer<ArrayBuffer>);
        fieldConfigs = analysis.textPlaceholders.map((p) => ({
          name: p.name,
          type: "text" as const,
          description: `Text field: ${p.name}`,
          required: true,
        }));
        assetSlotConfigs = analysis.namedRectangles.map((r) => ({
          name: r.name,
          description: `Image: ${r.name}`,
          required: false,
        }));
      }

      // Process IDML - set rectangle names if we have asset slot configs
      let processedBuffer: Buffer = buffer;
      if (assetSlotConfigs.length > 0) {
        try {
          const rectangleNames = assetSlotConfigs.map((s, i) => ({ index: i, name: s.name }));
          processedBuffer = await setRectangleNames(buffer as Buffer<ArrayBuffer>, rectangleNames);
        } catch (e) {
          console.error("Failed to set rectangle names:", e);
        }
      }

      // Create template directory
      await fs.mkdir(templateDir, { recursive: true });

      // Save IDML file
      const idmlPath = path.join(templateDir, "template.idml");
      await fs.writeFile(idmlPath, processedBuffer);

      // Generate template.json with field and asset slot configs
      const templateJson = {
        id: templateId,
        name: templateName,
        format: "idml",
        fields: fieldConfigs.map((f) => ({
          name: f.name,
          type: f.type,
          description: f.description,
          required: f.required,
        })),
        assetSlots: assetSlotConfigs.map((s) => ({
          name: s.name,
          description: s.description,
          required: s.required,
        })),
      };

      const jsonPath = path.join(templateDir, "template.json");
      await fs.writeFile(jsonPath, JSON.stringify(templateJson, null, 2));

      // Generate thumbnail by rendering IDML to PDF then converting to PNG
      try {
        console.log("Generating thumbnail for template:", templateId);

        // Render IDML to PDF with placeholder values
        const emptyFields: Record<string, string> = {};
        for (const field of fieldConfigs) {
          emptyFields[field.name] = `{{${field.name}}}`;
        }

        const result = await renderIdmlTemplate(idmlPath, { fields: emptyFields, assets: {} });
        if (!result.pdfBuffer) {
          throw new Error("No PDF generated");
        }
        const pdfBuffer = result.pdfBuffer;

        // Save PDF temporarily
        const tempPdfPath = path.join(templateDir, "temp-preview.pdf");
        await fs.writeFile(tempPdfPath, pdfBuffer);

        // Convert PDF to PNG using pdftoppm
        const thumbnailPath = path.join(templateDir, "thumbnail.png");
        const tempBase = path.join(templateDir, "thumb-temp");
        execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${tempPdfPath}" "${tempBase}"`);

        // Rename the output (pdftoppm adds -1 suffix)
        await fs.rename(`${tempBase}-1.png`, thumbnailPath);

        // Clean up temp PDF
        await fs.unlink(tempPdfPath).catch(() => {});

        console.log("Thumbnail generated:", thumbnailPath);
      } catch (err) {
        console.error("Failed to generate thumbnail:", err);
        // Continue without thumbnail - not critical
      }

      return NextResponse.json({
        success: true,
        templateId,
        templatePath: templateDir,
        template: templateJson,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });

  } catch (error) {
    console.error("Template upload error:", error);
    return NextResponse.json(
      { error: "Failed to process template", details: String(error) },
      { status: 500 }
    );
  }
}
