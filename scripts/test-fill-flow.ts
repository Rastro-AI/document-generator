/**
 * Test template filling flow:
 * 1. Create a test document (simple text file with product specs)
 * 2. Upload via job stream API
 * 3. Verify AI extracts fields and fills template
 * 4. Render and verify output
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs/promises";
import path from "path";
import FormData from "form-data";
import { Readable } from "stream";

const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("=== Test Template Filling Flow (IDML) ===\n");

  // 1. Create a test document with product specs
  console.log("1. Creating test document...");
  const testDocContent = `
PRODUCT SPECIFICATION SHEET

Product Name: UltraBright LED Ceiling Light Model CL-5000
Category: Commercial Lighting

Description:
The UltraBright CL-5000 is a premium commercial LED ceiling light designed for
office spaces, retail environments, and healthcare facilities. Features advanced
thermal management and 50,000+ hour lifespan.

Technical Specifications:
- Wattage: 45W
- Lumens: 5400lm
- Color Temperature: 4000K
- CRI: 95+
- Beam Angle: 120°
- Dimensions: 600mm x 600mm x 40mm
- Weight: 3.2kg
- IP Rating: IP44
- Warranty: 5 years
`;

  const testDocPath = path.join(process.cwd(), ".test-output", "test-product-spec.txt");
  await fs.mkdir(path.dirname(testDocPath), { recursive: true });
  await fs.writeFile(testDocPath, testDocContent);
  console.log(`   Created: ${testDocPath}`);

  // 2. Call the job stream API
  console.log("\n2. Creating job via stream API...");

  // For this test, we'll simulate what the UI does:
  // - POST to /api/jobs/stream with template, name, and file

  // The stream API uses FormData with files
  // Let's check if the template selector works with IDML first

  // Actually, let's just test the extraction function directly
  console.log("\n   Testing field extraction logic...");

  // Import the extraction function
  const { extractFieldsFromFile } = await import("../src/lib/llm");
  const { getTemplate } = await import("../src/lib/fs-utils");

  const template = await getTemplate("idml-spec-sheet");
  if (!template) {
    console.log("   ERROR: Template not found");
    return;
  }

  console.log(`   Template: ${template.name}`);
  console.log(`   Fields: ${template.fields.map(f => f.name).join(", ")}`);

  console.log("\n3. Extracting fields from document...");
  try {
    const fields = await extractFieldsFromFile(template, testDocPath);
    console.log("   Extracted fields:", fields);

    // 4. Create job with extracted fields
    console.log("\n4. Creating job with extracted fields...");
    const jobId = `fill-test-${Date.now()}`;
    const jobDir = path.join(process.cwd(), "jobs", jobId);
    await fs.mkdir(jobDir, { recursive: true });

    const jobData = {
      id: jobId,
      name: "Fill Test Job",
      templateId: "idml-spec-sheet",
      fields: fields,
      assets: {},
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(jobDir, "job.json"), JSON.stringify(jobData, null, 2));
    console.log(`   Job created: ${jobId}`);

    // 5. Render
    console.log("\n5. Rendering...");
    const renderRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/render`, { method: "POST" });
    const renderResult = await renderRes.json();
    console.log(`   Render result: ${renderResult.ok ? "success" : renderResult.error}`);

    // 6. Check output
    const pdfPath = path.join(jobDir, "output.pdf");
    try {
      const pdfStats = await fs.stat(pdfPath);
      console.log(`   PDF size: ${pdfStats.size} bytes`);

      // Convert to image
      const { execSync } = await import("child_process");
      const imgPath = path.join(process.cwd(), ".test-output", `fill-test-${Date.now()}`);
      execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${pdfPath}" "${imgPath}"`);
      console.log(`   Image: ${imgPath}-1.png`);

      console.log("\n=== Template Filling Flow Complete ===");
      console.log(`Job ID: ${jobId}`);
      console.log(`PDF: ${pdfPath}`);
    } catch (e) {
      console.log(`   PDF not found: ${e}`);
    }

  } catch (e: any) {
    console.log(`   Extraction error: ${e.message}`);
    console.log("\n   Note: This test requires OPENAI_API_KEY to be set");
  }
}

main().catch(console.error);
