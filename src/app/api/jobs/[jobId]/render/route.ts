import { NextRequest, NextResponse } from "next/server";
import { getJob, getTemplate, markJobRendered } from "@/lib/fs-utils";
import { getJobOutputPdfPath, getTemplateBasePdfPath, getTemplateOriginalPdfPath, getTemplateSchemaPath, getTemplateTsxPath, getTemplateRoot } from "@/lib/paths";
import { fillPdfWithPyMuPDF, FormSchema } from "@/lib/pdf-filler-pymupdf";
import { renderTemplateCode } from "@/lib/template-renderer";
import fs from "fs/promises";
import sharp from "sharp";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params;

    // Get the job
    const job = await getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get the template
    const template = await getTemplate(job.templateId);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const schemaPath = getTemplateSchemaPath(job.templateId);
    const tsxPath = getTemplateTsxPath(job.templateId);

    // Check if this is a schema-based template (has schema.json) or tsx-based template
    let useSchemaMode = false;
    try {
      await fs.access(schemaPath);
      useSchemaMode = true;
    } catch {
      // No schema.json - check for tsx
      try {
        await fs.access(tsxPath);
      } catch {
        return NextResponse.json(
          { error: "Template not found - missing schema.json or template.tsx" },
          { status: 400 }
        );
      }
    }

    let pdfBuffer: Buffer;

    if (useSchemaMode) {
      // Schema-based rendering with PyMuPDF
      const originalPdfPath = getTemplateOriginalPdfPath(job.templateId);
      const basePdfPath = getTemplateBasePdfPath(job.templateId);

      // Prefer original.pdf for PyMuPDF redaction (cleaner results)
      let pdfPath = originalPdfPath;
      try {
        await fs.access(originalPdfPath);
      } catch {
        try {
          await fs.access(basePdfPath);
          pdfPath = basePdfPath;
        } catch {
          return NextResponse.json(
            { error: "Template not found - missing original.pdf or base.pdf" },
            { status: 400 }
          );
        }
      }

      // Load schema
      const schemaContent = await fs.readFile(schemaPath, "utf-8");
      const schema: FormSchema = JSON.parse(schemaContent);

      // Prepare fields - convert all to strings
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(job.fields)) {
        if (value !== null && value !== undefined) {
          fields[key] = String(value);
        }
      }

      // Prepare assets - convert image paths to data URLs
      const assets: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(job.assets)) {
        if (value) {
          try {
            const imageBuffer = await fs.readFile(value);
            const ext = value.split(".").pop()?.toLowerCase() || "png";

            // Convert WebP/GIF to PNG
            if (ext === "webp" || ext === "gif") {
              const pngBuffer = await sharp(imageBuffer).png().toBuffer();
              assets[key] = `data:image/png;base64,${pngBuffer.toString("base64")}`;
            } else {
              const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
              assets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
            }
          } catch (err) {
            console.error(`Failed to process image ${value}:`, err);
            assets[key] = null;
          }
        } else {
          assets[key] = null;
        }
      }

      // Fill template using PyMuPDF (proper redaction - removes original content cleanly)
      const result = await fillPdfWithPyMuPDF(pdfPath, schema, {
        fields,
        assets,
      });

      if (!result.success || !result.pdfBuffer) {
        return NextResponse.json(
          { error: "Failed to render PDF", details: result.error },
          { status: 500 }
        );
      }

      pdfBuffer = result.pdfBuffer;
    } else {
      // TSX-based rendering with @react-pdf/renderer
      const templateCode = await fs.readFile(tsxPath, "utf-8");
      const templateRoot = getTemplateRoot(job.templateId);

      // Prepare assets - convert image paths to data URLs for tsx renderer
      const assets: Record<string, string> = {};
      for (const [key, value] of Object.entries(job.assets)) {
        if (value) {
          try {
            const imageBuffer = await fs.readFile(value);
            const ext = value.split(".").pop()?.toLowerCase() || "png";

            // Convert WebP/GIF to PNG
            if (ext === "webp" || ext === "gif") {
              const pngBuffer = await sharp(imageBuffer).png().toBuffer();
              assets[key] = `data:image/png;base64,${pngBuffer.toString("base64")}`;
            } else {
              const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
              assets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
            }
          } catch (err) {
            console.error(`Failed to process image ${value}:`, err);
          }
        }
      }

      // Prepare fields - convert MODELS from comma-separated string to array if needed
      const fields: Record<string, unknown> = { ...job.fields };
      if (typeof fields.MODELS === "string") {
        fields.MODELS = fields.MODELS.split(",").map((m: string) => m.trim());
      }

      const result = await renderTemplateCode(templateCode, {
        fields,
        assets,
        templateRoot,
        outputFormat: "both",
        skipValidation: true, // Trust existing templates in the templates directory
      });

      if (!result.success || !result.pdfBuffer) {
        return NextResponse.json(
          { error: "Failed to render PDF", details: result.error },
          { status: 500 }
        );
      }

      pdfBuffer = result.pdfBuffer;
    }

    // Save the PDF
    const outputPath = getJobOutputPdfPath(jobId);
    await fs.writeFile(outputPath, pdfBuffer);

    // Mark as rendered
    await markJobRendered(jobId);

    return NextResponse.json({
      ok: true,
      renderedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error rendering PDF:", error);
    return NextResponse.json(
      { error: "Failed to render PDF", details: String(error) },
      { status: 500 }
    );
  }
}
