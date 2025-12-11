/**
 * Test IDML rendering with S3 and RunScript API
 */

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import fs from "fs/promises";
import { renderIdmlTemplate } from "../src/lib/idml-renderer";

async function main() {
  console.log("=== Testing IDML Rendering with S3 + RunScript ===\n");

  // Check environment variables
  console.log("Environment check:");
  console.log("  AWS_ACCESS_KEY_ID:", process.env.AWS_ACCESS_KEY_ID ? "✓ Set" : "✗ Not set");
  console.log("  AWS_SECRET_ACCESS_KEY:", process.env.AWS_SECRET_ACCESS_KEY ? "✓ Set" : "✗ Not set");
  console.log("  AWS_REGION:", process.env.AWS_REGION || "us-east-1 (default)");
  console.log("  S3_BUCKET_NAME:", process.env.S3_BUCKET_NAME || "catalog-backend-files (default)");
  console.log("");

  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.error("Error: AWS_ACCESS_KEY_ID not set. Please configure AWS credentials.");
    process.exit(1);
  }

  // Load IDML template
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");

  console.log("IDML template:", idmlPath);

  // Check if file exists
  try {
    await fs.access(idmlPath);
    console.log("Template file exists ✓\n");
  } catch {
    console.error("Error: Template file not found at", idmlPath);
    process.exit(1);
  }

  // Test fields
  const testFields = {
    PRODUCT_NAME: "Test Solar Panel XL-500",
    PRODUCT_DESCRIPTION: "High-efficiency monocrystalline solar panel for residential use",
    VOLTAGE: "48V",
    WATTAGE: "500W",
    LUMENS: "N/A",
    CRI: "N/A",
    BEAM_ANGLE: "N/A",
    IP_RATING: "IP68",
    WARRANTY: "25 years",
    CERTIFICATIONS: "UL, IEC, CE",
    DIMENSIONS: "2000mm x 1000mm x 35mm",
  };

  console.log("Test fields:", JSON.stringify(testFields, null, 2));
  console.log("\nStarting render...\n");

  const startTime = Date.now();

  try {
    const result = await renderIdmlTemplate(idmlPath, { fields: testFields });

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\nRender completed in ${elapsed.toFixed(1)}s`);
    console.log("Success:", result.success);

    if (result.error) {
      console.log("Error:", result.error);
    }

    if (result.pdfBuffer) {
      console.log("PDF size:", result.pdfBuffer.length, "bytes");

      // Verify it's a valid PDF (starts with %PDF-)
      const header = result.pdfBuffer.toString("utf-8", 0, 5);
      console.log("PDF header:", header);

      if (header === "%PDF-") {
        console.log("✓ Valid PDF file!");

        // Save to test output
        const outputPath = path.join(process.cwd(), ".test-output", "idml-s3-render.pdf");
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, result.pdfBuffer);
        console.log("PDF saved to:", outputPath);
      } else {
        console.log("✗ Not a valid PDF (unexpected header)");
      }
    } else {
      console.log("No PDF buffer returned");
    }
  } catch (error) {
    console.error("Render error:", error);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
