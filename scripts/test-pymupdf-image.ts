import path from "path";
import fs from "fs/promises";
import { fillPdfWithPyMuPDF, FormSchema } from "../src/lib/pdf-filler-pymupdf";

async function main() {
  // We'll create a simple test by using the sunco-spec original PDF
  // First, let me create a minimal test with a sample PDF

  // Check if we have an original PDF somewhere
  const testPdfPath = "/Users/baptistecumin/github/document-generator/templates/sunco-spec-v1/thumbnail.png";

  // Let's use a job's uploaded PDF if available
  const jobsDir = "/Users/baptistecumin/github/document-generator/jobs";
  const jobs = await fs.readdir(jobsDir);

  // Find a job with a PDF
  let pdfPath: string | null = null;
  for (const jobId of jobs) {
    const jobDir = path.join(jobsDir, jobId);
    try {
      const files = await fs.readdir(jobDir);
      const pdf = files.find(f => f.endsWith('.pdf') && f !== 'output.pdf');
      if (pdf) {
        pdfPath = path.join(jobDir, pdf);
        break;
      }
    } catch {}
  }

  if (!pdfPath) {
    console.log("No test PDF found");
    return;
  }

  console.log(`Using PDF: ${pdfPath}`);

  // Create a minimal schema with just an image field
  const schema: FormSchema = {
    pages: [{
      pageNumber: 1,
      fields: [
        {
          name: "TEST_IMAGE",
          type: "image",
          bbox: { x: 100, y: 100, width: 200, height: 200 }
        }
      ]
    }]
  };

  // Load the energy-star logo as test image
  const imagePath = "/Users/baptistecumin/github/document-generator/jobs/8db92587-e9f3-4bab-ba13-13134453b92c/assets/energy-star-logo.png";

  try {
    await fs.access(imagePath);
  } catch {
    console.log("Test image not found:", imagePath);
    return;
  }

  const imageBuffer = await fs.readFile(imagePath);
  const imageBase64 = "data:image/png;base64," + imageBuffer.toString("base64");

  console.log("Testing PyMuPDF image insertion...");

  const result = await fillPdfWithPyMuPDF(pdfPath, schema, {
    fields: {},
    assets: {
      TEST_IMAGE: imageBase64,
    },
  });

  if (result.success) {
    console.log("\nSUCCESS!");
    const outputDir = "/Users/baptistecumin/github/document-generator/.test-output";
    await fs.mkdir(outputDir, { recursive: true });

    if (result.pdfBuffer) {
      await fs.writeFile(path.join(outputDir, "pymupdf-image-test.pdf"), result.pdfBuffer);
    }
    if (result.pngBase64) {
      const pngData = result.pngBase64.split(",")[1];
      await fs.writeFile(path.join(outputDir, "pymupdf-image-test.png"), Buffer.from(pngData, "base64"));
      console.log("Saved: .test-output/pymupdf-image-test.png");
    }
  } else {
    console.error("FAILED:", result.error);
  }
}

main().catch(console.error);
