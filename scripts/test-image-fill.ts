/**
 * Test IDML image filling
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs/promises";
import path from "path";

const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("=== Test IDML Image Filling ===\n");

  // 1. Create a test image (use a simple public image URL converted to base64)
  console.log("1. Preparing test image...");

  // Use a small test image - let's create a simple PNG
  // For simplicity, we'll use a base64 encoded 1x1 red pixel PNG
  // In real usage, this would come from job assets
  const testImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8DwHwMRgHFUIX0JABG4A/WVrE2IAAAAAElFTkSuQmCC";
  const testImageDataUrl = `data:image/png;base64,${testImageBase64}`;

  // Create a test image using sharp
  console.log("   Creating test image with sharp...");
  const { execSync } = await import("child_process");
  const sharp = (await import("sharp")).default;

  // Create a 300x200 colored image
  const testImagePath = path.join(process.cwd(), ".test-output", "test-product.png");
  await fs.mkdir(path.dirname(testImagePath), { recursive: true });

  // Create a gradient-like test image
  const width = 300;
  const height = 200;
  const channels = 3;
  const rawData = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels;
      // Create a gradient - orange to blue
      rawData[idx] = Math.floor(255 * (1 - x / width));     // R
      rawData[idx + 1] = Math.floor(100 + 100 * (y / height)); // G
      rawData[idx + 2] = Math.floor(255 * (x / width));     // B
    }
  }

  await sharp(rawData, { raw: { width, height, channels } })
    .png()
    .toFile(testImagePath);

  console.log(`   Created: ${testImagePath}`);

  // Read image and convert to data URL
  const imageBuffer = await fs.readFile(testImagePath);
  const imageDataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;
  console.log(`   Image size: ${imageBuffer.length} bytes`);

  // 2. Create job with image asset
  console.log("\n2. Creating job...");
  const jobId = `image-test-${Date.now()}`;
  const jobDir = path.join(process.cwd(), "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const jobData = {
    id: jobId,
    name: "Image Test Job",
    templateId: "test-upload-template",  // Uses template with named rectangle PRODUCT_IMAGE
    fields: {
      PRODUCT_NAME: "LED Panel with Custom Image",
      DESCRIPTION: "Testing image placeholder replacement in IDML templates.",
    },
    assets: {
      PRODUCT_IMAGE: imageDataUrl,
    },
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(jobDir, "job.json"), JSON.stringify(jobData, null, 2));
  console.log(`   Job created: ${jobId}`);

  // 3. Render
  console.log("\n3. Rendering...");
  const renderRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/render`, { method: "POST" });
  const renderResult = await renderRes.json();
  console.log(`   Result: ${renderResult.ok ? "success" : renderResult.error}`);

  // 4. Check output
  const pdfPath = path.join(jobDir, "output.pdf");
  try {
    const pdfStats = await fs.stat(pdfPath);
    console.log(`   PDF size: ${pdfStats.size} bytes`);

    // Convert to image
    const imgPath = path.join(process.cwd(), ".test-output", `image-test-${Date.now()}`);
    execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${pdfPath}" "${imgPath}"`);
    console.log(`\n✓ Output image: ${imgPath}-1.png`);
    console.log(`  Check if the image placeholder was replaced!`);

  } catch (e: any) {
    console.log(`   Error: ${e.message}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
