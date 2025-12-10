import { NextRequest, NextResponse } from "next/server";
import { getJob, getTemplate, markJobRendered, getJobTemplateContent, readJobFile, writeJobFile } from "@/lib/fs-utils";
import { getTemplateRoot, getTemplateIdmlPath } from "@/lib/paths";
import { renderToBuffer } from "@react-pdf/renderer";
import * as esbuild from "esbuild";
import path from "path";
import React from "react";
import * as ReactPDF from "@react-pdf/renderer";
import sharp from "sharp";
import { renderIdmlTemplate } from "@/lib/idml-renderer";

// Fallback: Import the original template's render function
import { render as originalRender } from "../../../../../../templates/sunco-spec-v1/template";

// Dynamic template compiler for TSX templates
async function compileAndLoadTemplate(
  templateCode: string,
  _templateRoot: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ render: (fields: any, assets: any, templateRoot: string) => React.ReactElement }> {
  let cleanedCode = templateCode
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
    .replace(/import\s+['"][^'"]+['"];?/g, "")
    .replace(/export\s+function\s+render\s*\(/g, "__exportedRender__ = function render(")
    .replace(/export\s+/g, "");

  const result = await esbuild.transform(cleanedCode, {
    loader: "tsx",
    target: "es2020",
    format: "cjs",
  });

  const transpiledCode = result.code;

  const moduleCode = `
    "use strict";
    var __exportedRender__;
    var exports = {};
    var module = { exports: exports };
    var React = __React__;
    var Document = __ReactPDF__.Document;
    var Page = __ReactPDF__.Page;
    var View = __ReactPDF__.View;
    var Text = __ReactPDF__.Text;
    var Image = __ReactPDF__.Image;
    var StyleSheet = __ReactPDF__.StyleSheet;
    var Font = __ReactPDF__.Font;
    var path = __path__;
    ${transpiledCode}
    return __exportedRender__ || (typeof render !== 'undefined' ? render : null);
  `;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const moduleWrapper = new Function(
    "__React__",
    "__ReactPDF__",
    "__path__",
    moduleCode
  );

  const renderFn = moduleWrapper(React, ReactPDF, path);

  if (!renderFn || typeof renderFn !== "function") {
    throw new Error("Template does not export a render function");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { render: renderFn as (fields: any, assets: any, templateRoot: string) => React.ReactElement };
}

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

    // Check template format - IDML or TSX
    if (template.format === "idml") {
      return await renderIdmlJob(jobId, job, template);
    }

    // Default: TSX template rendering
    return await renderTsxJob(jobId, job, template);

  } catch (error) {
    console.error("Error rendering PDF:", error);
    return NextResponse.json(
      { error: "Failed to render PDF", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Render IDML-based template job
 */
async function renderIdmlJob(
  jobId: string,
  job: { templateId: string; fields: Record<string, unknown>; assets: Record<string, string | null> },
  template: { id: string }
) {
  // Get IDML template path (from local filesystem - templates are bundled)
  const idmlPath = getTemplateIdmlPath(template.id);

  // Prepare assets - they should already be data URLs from the streaming endpoint
  const assets: Record<string, string> = {};
  for (const [key, value] of Object.entries(job.assets)) {
    if (value) {
      // Check if already a data URL
      if (value.startsWith("data:")) {
        assets[key] = value;
      } else if (value.includes("/")) {
        // Looks like a Supabase path - read from storage
        try {
          const filename = value.split("/").pop() || "";
          const imageBuffer = await readJobFile(jobId, `assets/${filename}`);
          if (imageBuffer) {
            const ext = filename.split(".").pop()?.toLowerCase() || "png";
            const mimeType = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
            assets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          }
        } catch (err) {
          console.error(`Failed to load asset ${key}:`, err);
        }
      }
    }
  }

  // Render IDML template
  const result = await renderIdmlTemplate(idmlPath, {
    fields: job.fields,
    assets,
  });

  if (!result.success || !result.pdfBuffer) {
    return NextResponse.json(
      { error: result.error || "IDML render failed" },
      { status: 500 }
    );
  }

  // Save the PDF to Supabase
  await writeJobFile(jobId, "output.pdf", result.pdfBuffer);

  // Mark as rendered
  await markJobRendered(jobId);

  return NextResponse.json({
    ok: true,
    renderedAt: new Date().toISOString(),
  });
}

/**
 * Render TSX-based template job (existing logic)
 */
async function renderTsxJob(
  jobId: string,
  job: { templateId: string; fields: Record<string, unknown>; assets: Record<string, string | null> },
  template: { id: string }
) {
  // For now, we only support the sunco-spec-v1 template
  if (job.templateId !== "sunco-spec-v1") {
    return NextResponse.json(
      { error: "Unsupported template" },
      { status: 400 }
    );
  }

  // Prepare fields - handle MODELS as array, rest as strings
  const fields: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(job.fields)) {
    if (key === "MODELS") {
      if (Array.isArray(value)) {
        fields[key] = value;
      } else if (typeof value === "string" && value) {
        fields[key] = value.split(",").map((m) => m.trim());
      } else {
        fields[key] = [];
      }
    } else {
      fields[key] = value !== null ? String(value) : "";
    }
  }

  // Prepare assets - they should already be data URLs
  const assets: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(job.assets)) {
    if (value) {
      if (value.startsWith("data:")) {
        assets[key] = value;
      } else if (value.includes("/")) {
        // Supabase path - read from storage
        try {
          const filename = value.split("/").pop() || "";
          const imageBuffer = await readJobFile(jobId, `assets/${filename}`);
          if (imageBuffer) {
            const ext = filename.split(".").pop()?.toLowerCase() || "png";
            if (ext === "webp" || ext === "gif") {
              const pngBuffer = await sharp(imageBuffer).png().toBuffer();
              assets[key] = `data:image/png;base64,${pngBuffer.toString("base64")}`;
            } else {
              const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
              assets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
            }
          }
        } catch (err) {
          console.error(`Failed to process image ${value}:`, err);
          assets[key] = undefined;
        }
      }
    } else {
      assets[key] = undefined;
    }
  }

  // Get template root for font loading
  const templateRoot = getTemplateRoot(job.templateId);

  // Try to load job-specific template, fall back to original
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let renderFn: (fields: any, assets: any, templateRoot: string) => React.ReactElement;

  const jobTemplateContent = await getJobTemplateContent(jobId);
  if (jobTemplateContent) {
    try {
      const compiledTemplate = await compileAndLoadTemplate(jobTemplateContent, templateRoot);
      renderFn = compiledTemplate.render;
    } catch (compileError) {
      console.error("Failed to compile job template, using original:", compileError);
      renderFn = originalRender;
    }
  } else {
    renderFn = originalRender;
  }

  // Render the PDF
  const document = renderFn(fields, assets, templateRoot);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfBuffer = await renderToBuffer(document as any);

  // Save the PDF to Supabase
  await writeJobFile(jobId, "output.pdf", Buffer.from(pdfBuffer));

  // Mark as rendered
  await markJobRendered(jobId);

  return NextResponse.json({
    ok: true,
    renderedAt: new Date().toISOString(),
  });
}
