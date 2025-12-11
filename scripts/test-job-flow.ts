/**
 * Test script to verify job creation, asset upload, field update, and rendering
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = "http://localhost:3000";

async function testJobFlow() {
  console.log("=== Testing Job Flow ===\n");

  // Step 1: Create a job with the svg-spec-sheet template
  console.log("Step 1: Creating job...");
  const jobId = `test-${Date.now()}`;

  const formData = new FormData();
  formData.append("jobId", jobId);
  formData.append("templateId", "svg-spec-sheet");

  // Add a test image
  const testImagePath = path.join(__dirname, "../.test-output/base-1.png");
  if (fs.existsSync(testImagePath)) {
    const imageBuffer = fs.readFileSync(testImagePath);
    const imageBlob = new Blob([imageBuffer], { type: "image/png" });
    formData.append("files", imageBlob, "test-product.png");
    console.log("  Added test image: test-product.png");
  }

  formData.append("prompt", "This is a test LED light product");

  const createResponse = await fetch(`${BASE_URL}/api/jobs/stream`, {
    method: "POST",
    body: formData,
  });

  if (!createResponse.ok) {
    console.error("Failed to create job:", await createResponse.text());
    return;
  }

  // Read the SSE stream
  const reader = createResponse.body?.getReader();
  if (!reader) {
    console.error("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let lastStatus = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value);
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "status") {
            lastStatus = data.content;
            console.log(`  Status: ${data.content}`);
          }
        } catch {}
      }
    }
  }

  console.log(`\nJob created: ${jobId}\n`);

  // Step 2: Get the job to verify it exists
  console.log("Step 2: Fetching job...");
  const jobResponse = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
  if (!jobResponse.ok) {
    console.error("Failed to fetch job:", await jobResponse.text());
    return;
  }
  const job = await jobResponse.json();
  console.log("  Fields:", Object.keys(job.fields).filter(k => job.fields[k] !== null).length, "filled");
  console.log("  Assets:", Object.keys(job.assets).filter(k => job.assets[k] !== null));
  console.log("");

  // Step 3: Update a field
  console.log("Step 3: Updating fields...");
  const updateFieldsResponse = await fetch(`${BASE_URL}/api/jobs/${jobId}/fields`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        ...job.fields,
        PRODUCT_NAME: "Test LED Downlight",
        WATTAGE: "15W",
        LUMENS: "1200 lm",
      }
    }),
  });

  if (!updateFieldsResponse.ok) {
    console.error("Failed to update fields:", await updateFieldsResponse.text());
    return;
  }
  const updatedJob1 = await updateFieldsResponse.json();
  console.log("  Updated PRODUCT_NAME to:", updatedJob1.fields.PRODUCT_NAME);
  console.log("  Updated WATTAGE to:", updatedJob1.fields.WATTAGE);
  console.log("");

  // Step 4: Upload a new asset
  console.log("Step 4: Uploading asset to COMPANY_LOGO slot...");
  const assetFormData = new FormData();

  // Use a different test image for the logo
  const logoPath = path.join(__dirname, "../.test-output/api-render-1.png");
  if (fs.existsSync(logoPath)) {
    const logoBuffer = fs.readFileSync(logoPath);
    const logoBlob = new Blob([logoBuffer], { type: "image/png" });
    assetFormData.append("file", logoBlob, "company-logo.png");
    assetFormData.append("slotName", "COMPANY_LOGO");

    const uploadResponse = await fetch(`${BASE_URL}/api/jobs/${jobId}/assets`, {
      method: "POST",
      body: assetFormData,
    });

    if (!uploadResponse.ok) {
      console.error("Failed to upload asset:", await uploadResponse.text());
      return;
    }
    const uploadResult = await uploadResponse.json();
    console.log("  Asset uploaded:", uploadResult.assetPath);
    console.log("  Job assets after upload:", Object.keys(uploadResult.job.assets).filter(k => uploadResult.job.assets[k] !== null));
  } else {
    console.log("  Skipped (no test logo file)");
  }
  console.log("");

  // Step 5: Render the PDF
  console.log("Step 5: Rendering PDF...");
  const renderResponse = await fetch(`${BASE_URL}/api/jobs/${jobId}/render`, {
    method: "POST",
  });

  if (!renderResponse.ok) {
    console.error("Failed to render:", await renderResponse.text());
    return;
  }
  const renderResult = await renderResponse.json();
  console.log("  Render result:", renderResult);
  console.log("");

  // Step 6: Fetch the PDF
  console.log("Step 6: Fetching PDF...");
  const pdfResponse = await fetch(`${BASE_URL}/api/jobs/${jobId}/pdf`);
  if (!pdfResponse.ok) {
    console.error("Failed to fetch PDF:", await pdfResponse.text());
    return;
  }
  const pdfBuffer = await pdfResponse.arrayBuffer();
  console.log("  PDF size:", pdfBuffer.byteLength, "bytes");

  // Save the PDF locally for inspection
  const outputPath = path.join(__dirname, "../.test-output/test-job-output.pdf");
  fs.writeFileSync(outputPath, Buffer.from(pdfBuffer));
  console.log("  Saved to:", outputPath);
  console.log("");

  // Step 7: Verify final job state
  console.log("Step 7: Final job state...");
  const finalJobResponse = await fetch(`${BASE_URL}/api/jobs/${jobId}`);
  const finalJob = await finalJobResponse.json();
  console.log("  PRODUCT_NAME:", finalJob.fields.PRODUCT_NAME);
  console.log("  WATTAGE:", finalJob.fields.WATTAGE);
  console.log("  COMPANY_LOGO:", finalJob.assets.COMPANY_LOGO);
  console.log("  renderedAt:", finalJob.renderedAt);
  console.log("");

  console.log("=== Test Complete ===");
}

testJobFlow().catch(console.error);
