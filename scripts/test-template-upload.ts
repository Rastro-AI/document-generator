/**
 * Test template upload API
 */

import fs from "fs/promises";
import path from "path";

const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("=== Test Template Upload API ===\n");

  // Read existing IDML template
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  console.log(`1. Loaded IDML: ${idmlBuffer.length} bytes`);

  // Create form data for analysis
  const formData = new FormData();
  formData.append("file", new Blob([idmlBuffer], { type: "application/octet-stream" }), "template.idml");
  formData.append("action", "analyze");

  // Step 1: Analyze
  console.log("\n2. Analyzing IDML...");
  const analyzeRes = await fetch(`${BASE_URL}/api/templates/upload`, {
    method: "POST",
    body: formData,
  });
  const analyzeResult = await analyzeRes.json();

  if (!analyzeResult.success) {
    console.log(`   Error: ${analyzeResult.error}`);
    return;
  }

  console.log(`   Text placeholders: ${analyzeResult.analysis.textPlaceholders.length}`);
  for (const p of analyzeResult.analysis.textPlaceholders) {
    console.log(`     - ${p.name} (in ${p.storyFile})`);
  }

  console.log(`   Named rectangles: ${analyzeResult.analysis.namedRectangles.length}`);
  for (const r of analyzeResult.analysis.namedRectangles) {
    console.log(`     - ${r.name} (in ${r.spreadFile})`);
  }

  console.log(`   Page count: ${analyzeResult.analysis.pageCount}`);
  console.log(`   Dimensions: ${analyzeResult.analysis.dimensions?.width}x${analyzeResult.analysis.dimensions?.height}`);

  // Step 2: Create template with rectangle naming
  console.log("\n3. Creating template with named rectangles...");

  const createFormData = new FormData();
  createFormData.append("file", new Blob([idmlBuffer], { type: "application/octet-stream" }), "template.idml");
  createFormData.append("action", "create");
  createFormData.append("templateId", "test-upload-template");
  createFormData.append("templateName", "Test Upload Template");
  // Name the first rectangle as PRODUCT_IMAGE
  createFormData.append("rectangleNames", JSON.stringify([{ index: 0, name: "PRODUCT_IMAGE" }]));

  const createRes = await fetch(`${BASE_URL}/api/templates/upload`, {
    method: "POST",
    body: createFormData,
  });
  const createResult = await createRes.json();

  if (!createResult.success) {
    console.log(`   Error: ${createResult.error}`);
    // Clean up if exists
    if (createResult.error?.includes("already exists")) {
      console.log("   (Template already exists - try deleting templates/test-upload-template)");
    }
    return;
  }

  console.log(`   Created template: ${createResult.templateId}`);
  console.log(`   Path: ${createResult.templatePath}`);
  console.log(`   Fields: ${createResult.template.fields.length}`);
  console.log(`   Asset slots: ${createResult.template.assetSlots.length}`);

  for (const slot of createResult.template.assetSlots) {
    console.log(`     - ${slot.name}: ${slot.description}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
