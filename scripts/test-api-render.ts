/**
 * Test the render API endpoint with the IDML template
 */

import fs from "fs/promises";
import path from "path";

async function main() {
  console.log("=== Test Render API ===\n");

  // 1. Create a job for the IDML template
  console.log("1. Creating job...");

  // First, check if idml-spec-sheet template exists
  const templateJsonPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.json");
  const templateJson = JSON.parse(await fs.readFile(templateJsonPath, "utf-8"));
  console.log(`   Template: ${templateJson.name} (format: ${templateJson.format})`);
  console.log(`   Fields: ${templateJson.fields.map((f: any) => f.name).join(", ")}`);

  // Create job directory
  const jobId = `test-api-${Date.now()}`;
  const jobDir = path.join(process.cwd(), "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  // Create job.json
  const jobData = {
    id: jobId,
    name: "API Test Job",
    templateId: "idml-spec-sheet",
    fields: {
      PRODUCT_NAME: "Quantum LED Panel 3000",
      DESCRIPTION: "Advanced LED technology with 98% efficiency & ultra-low power consumption.",
    },
    assets: {},
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(path.join(jobDir, "job.json"), JSON.stringify(jobData, null, 2));
  console.log(`   Job created: ${jobId}`);

  // 2. Call the render API
  console.log("\n2. Calling render API...");

  try {
    const response = await fetch(`http://localhost:3000/api/jobs/${jobId}/render`, {
      method: "POST",
    });

    if (!response.ok) {
      const error = await response.text();
      console.log(`   Error ${response.status}: ${error}`);
      return;
    }

    const result = await response.json();
    console.log(`   Response:`, result);

    // Check if PDF was created
    const pdfPath = path.join(jobDir, "output.pdf");
    try {
      const pdfStats = await fs.stat(pdfPath);
      console.log(`\n✓ PDF created!`);
      console.log(`  Size: ${pdfStats.size} bytes`);
      console.log(`  Path: ${pdfPath}`);
    } catch {
      console.log(`\n✗ PDF not found at ${pdfPath}`);
    }

  } catch (e: any) {
    console.log(`   Fetch error: ${e.message}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
