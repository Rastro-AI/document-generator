/**
 * Test script for PDF form filling
 * Usage: npx tsx scripts/test-pdf-fill.ts
 */

import path from "path";
import fs from "fs/promises";
import { fillPdfTemplate, FormTemplateSchema } from "../src/lib/pdf-filler";

async function main() {
  const testOutputDir = path.join(process.cwd(), ".test-output");
  const basePdfPath = path.join(testOutputDir, "base.pdf");
  const schemaPath = path.join(testOutputDir, "schema.json");

  console.log("\n" + "=".repeat(60));
  console.log("PDF FORM FILL TEST");
  console.log("=".repeat(60));

  // Load schema
  const schemaJson = await fs.readFile(schemaPath, "utf-8");
  const schema: FormTemplateSchema = JSON.parse(schemaJson);
  console.log(`Schema loaded: ${schema.pages.length} pages`);

  // Create sample field values
  const fields: Record<string, string> = {};
  const assets: Record<string, string | null> = {};

  for (const page of schema.pages) {
    for (const field of page.fields) {
      if (field.type === "text") {
        fields[field.name] = `{{${field.name}}}`;
      } else {
        assets[field.name] = null; // No image for test
      }
    }
  }

  console.log(`Filling ${Object.keys(fields).length} text fields`);
  console.log(`Filling ${Object.keys(assets).length} image fields (null)`);

  // Fill template
  const result = await fillPdfTemplate(basePdfPath, schema, {
    fields,
    assets,
    templateRoot: testOutputDir,
  });

  console.log("\n" + "=".repeat(60));
  console.log("RESULT");
  console.log("=".repeat(60));
  console.log(`Success: ${result.success}`);

  if (result.success) {
    // Save filled PDF
    if (result.pdfBuffer) {
      const filledPdfPath = path.join(testOutputDir, "filled.pdf");
      await fs.writeFile(filledPdfPath, result.pdfBuffer);
      console.log(`Saved filled.pdf (${result.pdfBuffer.length} bytes)`);
    }

    // Save PNG preview
    if (result.pngBase64) {
      const pngPath = path.join(testOutputDir, "filled_preview.png");
      const pngData = result.pngBase64.split(",")[1];
      await fs.writeFile(pngPath, Buffer.from(pngData, "base64"));
      console.log(`Saved filled_preview.png`);
    }
  } else {
    console.log(`Error: ${result.error}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("TEST COMPLETE");
  console.log("=".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
