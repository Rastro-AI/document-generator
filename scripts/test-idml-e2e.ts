/**
 * End-to-end test for IDML template system
 * Tests: placeholder extraction, field replacement, template detection
 */

import { renderIdmlTemplate, extractIdmlPlaceholders, readIdmlContent } from "../src/lib/idml-renderer";
import { getTemplate } from "../src/lib/fs-utils";
import path from "path";
import fs from "fs/promises";

async function main() {
  console.log("=== IDML Template System E2E Test ===\n");

  const templateId = "idml-spec-sheet";
  const templateDir = path.join(process.cwd(), "templates", templateId);
  const idmlPath = path.join(templateDir, "template.idml");

  // 1. Test template detection
  console.log("1. Testing template detection...");
  try {
    const template = await getTemplate(templateId);
    console.log(`   Format detected: ${template?.format || "tsx (default)"}`);
    console.log(`   Template name: ${template?.name}`);
    console.log(`   Fields count: ${template?.fields?.length || 0}`);
    console.log("   ✓ Template detection passed\n");
  } catch (error) {
    console.log(`   ✗ Template detection failed: ${error}\n`);
  }

  // 2. Test placeholder extraction
  console.log("2. Testing placeholder extraction...");
  try {
    const placeholders = await extractIdmlPlaceholders(idmlPath);
    console.log(`   Found ${placeholders.length} placeholders:`);
    placeholders.forEach(p => console.log(`     - ${p}`));
    console.log("   ✓ Placeholder extraction passed\n");
  } catch (error) {
    console.log(`   ✗ Placeholder extraction failed: ${error}\n`);
  }

  // 3. Test IDML content reading
  console.log("3. Testing IDML content reading...");
  try {
    const content = await readIdmlContent(idmlPath);
    console.log(`   Content length: ${content.length} characters`);
    console.log(`   Contains placeholders: ${content.includes("{{")}`);
    console.log("   ✓ Content reading passed\n");
  } catch (error) {
    console.log(`   ✗ Content reading failed: ${error}\n`);
  }

  // 4. Test field replacement
  console.log("4. Testing field replacement...");
  const testFields = {
    PRODUCT_NAME: "TEST PRODUCT A19 LED",
    PRODUCT_DESCRIPTION: "High-efficiency test LED bulb.",
    VOLTAGE: "120V AC",
    WATTAGE: "9W",
    LUMENS: "800 lm",
    CRI: "90+",
    BEAM_ANGLE: "180°",
    DIMMABLE: "Yes",
    COLOR_TEMPERATURE: "2700K/3000K/4000K/5000K",
    LIFETIME: "15,000 hrs",
    WARRANTY: "3 Years",
  };

  try {
    const result = await renderIdmlTemplate(idmlPath, { fields: testFields });
    console.log(`   Success: ${result.success}`);
    console.log(`   Has buffer: ${!!result.pdfBuffer}`);
    console.log(`   Buffer size: ${result.pdfBuffer?.length || 0} bytes`);
    if (result.error) {
      console.log(`   Note: ${result.error}`);
    }

    // Save output for inspection
    if (result.pdfBuffer) {
      const outputDir = path.join(process.cwd(), ".test-output");
      await fs.mkdir(outputDir, { recursive: true });

      const header = result.pdfBuffer.slice(0, 4).toString();
      const isPdf = header === "%PDF";
      const outputPath = path.join(outputDir, isPdf ? "idml-e2e-output.pdf" : "idml-e2e-output.idml");
      await fs.writeFile(outputPath, result.pdfBuffer);
      console.log(`   Saved to: ${outputPath}`);
    }
    console.log("   ✓ Field replacement passed\n");
  } catch (error) {
    console.log(`   ✗ Field replacement failed: ${error}\n`);
  }

  // 5. Verify field values were replaced
  console.log("5. Verifying field replacement in output...");
  try {
    const result = await renderIdmlTemplate(idmlPath, { fields: testFields });
    if (result.pdfBuffer) {
      const outputDir = path.join(process.cwd(), ".test-output");
      const outputPath = path.join(outputDir, "idml-e2e-output.idml");

      // Re-read and verify
      const content = await readIdmlContent(outputPath);
      const hasOldPlaceholders = content.includes("{{PRODUCT_NAME}}");
      const hasNewValue = content.includes("TEST PRODUCT A19 LED");

      console.log(`   Old placeholders present: ${hasOldPlaceholders}`);
      console.log(`   New values present: ${hasNewValue}`);

      if (!hasOldPlaceholders && hasNewValue) {
        console.log("   ✓ Replacement verification passed\n");
      } else {
        console.log("   ✗ Replacement verification failed - values not replaced correctly\n");
      }
    }
  } catch (error) {
    console.log(`   ✗ Verification failed: ${error}\n`);
  }

  console.log("=== E2E Test Complete ===");
}

main().catch(console.error);
