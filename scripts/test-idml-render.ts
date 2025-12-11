/**
 * Test IDML rendering with RunScript API
 */

import { renderIdmlTemplate, extractIdmlPlaceholders, readIdmlContent } from "../src/lib/idml-renderer";
import path from "path";
import fs from "fs/promises";

async function main() {
  const templatePath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");

  console.log("=== Testing IDML Template Rendering ===\n");

  // 1. Extract placeholders
  console.log("1. Extracting placeholders from IDML...");
  const placeholders = await extractIdmlPlaceholders(templatePath);
  console.log("Found placeholders:", placeholders);
  console.log("");

  // 2. Read content
  console.log("2. Reading IDML content...");
  const content = await readIdmlContent(templatePath);
  console.log("Content preview:", content.substring(0, 500));
  console.log("");

  // 3. Test render with field values
  console.log("3. Rendering IDML with test field values...");
  const testFields = {
    PRODUCT_NAME: "TEST LED BULB A19",
    PRODUCT_DESCRIPTION: "High-efficiency LED bulb with 15-year lifespan. Save 85% on energy costs compared to incandescent bulbs.",
    VOLTAGE: "120V",
    WATTAGE: "9W",
    LUMENS: "800 lm",
    CRI: "90",
    BEAM_ANGLE: "180°",
    DIMMABLE: "Yes",
    COLOR_TEMPERATURE: "2700K/3000K/4000K/5000K",
    LIFETIME: "15,000+ hrs",
    WARRANTY: "3 Years",
  };

  const result = await renderIdmlTemplate(templatePath, {
    fields: testFields,
  });

  console.log("Render result:", {
    success: result.success,
    hasBuffer: !!result.pdfBuffer,
    bufferSize: result.pdfBuffer?.length,
    error: result.error,
  });

  // Save output for inspection
  if (result.pdfBuffer) {
    const outputDir = path.join(process.cwd(), ".test-output");
    await fs.mkdir(outputDir, { recursive: true });

    // Check if it's IDML or PDF
    const header = result.pdfBuffer.slice(0, 4).toString();
    const isPdf = header === "%PDF";
    const filename = isPdf ? "idml-render-test.pdf" : "idml-render-test.idml";

    await fs.writeFile(path.join(outputDir, filename), result.pdfBuffer);
    console.log(`\nOutput saved to: .test-output/${filename}`);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
