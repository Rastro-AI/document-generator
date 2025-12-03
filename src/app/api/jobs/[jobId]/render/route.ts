import { NextRequest, NextResponse } from "next/server";
import { getJob, getTemplate, markJobRendered, getJobTemplateContent } from "@/lib/fs-utils";
import { getJobOutputPdfPath, getTemplateRoot } from "@/lib/paths";
import { renderToBuffer } from "@react-pdf/renderer";
import fs from "fs/promises";
import * as esbuild from "esbuild";
import path from "path";
import React from "react";
import * as ReactPDF from "@react-pdf/renderer";
import sharp from "sharp";

// Fallback: Import the original template's render function
import { render as originalRender } from "../../../../../../templates/sunco-spec-v1/template";

// Dynamic template compiler
async function compileAndLoadTemplate(
  templateCode: string,
  _templateRoot: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ render: (fields: any, assets: any, templateRoot: string) => React.ReactElement }> {
  // Remove imports and exports, replace with our provided dependencies
  // Use non-anchored regex to handle multi-line imports like:
  // import {
  //   Document,
  //   Page,
  // } from "@react-pdf/renderer";
  let cleanedCode = templateCode
    // Remove multi-line or single-line import ... from "..." statements
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"];?/g, "")
    // Remove bare imports like: import "something";
    .replace(/import\s+['"][^'"]+['"];?/g, "")
    // Convert export function to regular function assignment
    .replace(/export\s+function\s+render\s*\(/g, "__exportedRender__ = function render(")
    // Remove other exports
    .replace(/export\s+/g, "");

  // Transpile TSX to JS
  const result = await esbuild.transform(cleanedCode, {
    loader: "tsx",
    target: "es2020",
    format: "cjs", // Use CommonJS - simpler output without IIFE wrapping
  });

  const transpiledCode = result.code;

  // Create a function that provides all dependencies and returns the render function
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
        // MODELS should be an array
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

    // Prepare assets - convert image paths to data URLs
    // React-PDF only supports PNG and JPG, so convert WebP/GIF to PNG
    const assets: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(job.assets)) {
      if (value) {
        try {
          const imageBuffer = await fs.readFile(value);
          const ext = value.split(".").pop()?.toLowerCase() || "png";

          // Convert WebP/GIF to PNG (React-PDF doesn't support them)
          if (ext === "webp" || ext === "gif") {
            const pngBuffer = await sharp(imageBuffer).png().toBuffer();
            assets[key] = `data:image/png;base64,${pngBuffer.toString("base64")}`;
          } else {
            const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
            assets[key] = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
          }
        } catch (err) {
          console.error(`Failed to process image ${value}:`, err);
          assets[key] = undefined;
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

    // Render the PDF using the template's render function
    const document = renderFn(fields, assets, templateRoot);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(document as any);

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
