/**
 * Generate thumbnail for a template
 * Usage: npx tsx scripts/generate-thumbnail.ts sunco-spec-v1
 */

import { renderToBuffer } from "@react-pdf/renderer";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

async function main() {
  const templateId = process.argv[2] || "sunco-spec-v1";
  const templatesDir = path.join(process.cwd(), "templates");
  const templateDir = path.join(templatesDir, templateId);

  console.log(`Generating thumbnail for template: ${templateId}`);

  // Load template
  const templatePath = path.join(templateDir, "template.tsx");
  const templateModule = await import(templatePath);

  // Load template.json for field examples
  const configPath = path.join(templateDir, "template.json");
  const configRaw = await fs.readFile(configPath, "utf-8");
  const config = JSON.parse(configRaw);

  // Build sample fields from config examples
  const sampleFields: Record<string, unknown> = {};
  for (const field of config.fields) {
    sampleFields[field.name] = field.example;
  }

  // No assets for thumbnail
  const assets: Record<string, string | undefined> = {};

  console.log("Rendering PDF with sample data...");

  // Render PDF
  const element = templateModule.render(sampleFields, assets, templateDir);
  const pdfBuffer = await renderToBuffer(element);

  // Write temp PDF
  const tempPdfPath = path.join(templateDir, ".thumbnail-temp.pdf");
  await fs.writeFile(tempPdfPath, pdfBuffer);

  console.log("Converting to PNG thumbnail...");

  // Convert to PNG using pdftoppm
  const thumbnailPath = path.join(templateDir, "thumbnail");
  execSync(`pdftoppm -png -f 1 -l 1 -scale-to 400 "${tempPdfPath}" "${thumbnailPath}"`, {
    stdio: "inherit",
  });

  // pdftoppm outputs thumbnail-1.png, rename to thumbnail.png
  const generatedPath = `${thumbnailPath}-1.png`;
  const finalPath = path.join(templateDir, "thumbnail.png");
  await fs.rename(generatedPath, finalPath);

  // Clean up temp PDF
  await fs.unlink(tempPdfPath);

  console.log(`Thumbnail generated: ${finalPath}`);
}

main().catch(console.error);
