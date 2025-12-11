/**
 * Test if the InDesign script itself works - create a doc from scratch
 */

import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import fs from "fs/promises";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.S3_BUCKET_NAME || "modalvolumebucket";

async function main() {
  console.log("=== Testing InDesign Script - Create PDF from Scratch ===\n");

  const jobId = `create_pdf_${Date.now()}`;
  const outputKey = `runscript/${jobId}/output.pdf`;

  // Generate presigned PUT URL
  console.log("1. Generating presigned PUT URL...");
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "application/pdf",
  }), { expiresIn: 3600 });

  // Script that creates a document from scratch and exports PDF
  const script = `
// Create a new document
var doc = app.documents.add();

// Add text to the page
var page = doc.pages[0];
var textFrame = page.textFrames.add();
textFrame.geometricBounds = [72, 72, 200, 400]; // top, left, bottom, right in points
textFrame.contents = "Hello from InDesign Server!\\n\\nThis PDF was generated programmatically.";

// Export to PDF
var outputFile = new File("jobFolder/output.pdf");
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);

// Close without saving
doc.close(SaveOptions.NO);

"PDF created from scratch";
`;

  console.log("\n2. Calling RunScript API...");
  const response = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: putUrl, path: "jobFolder/output.pdf" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("   Job created:", response.data._id);

  // Poll
  let status = "queued";
  let attempts = 0;
  let jobData: any = null;

  while (status !== "complete" && status !== "failed" && attempts < 60) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;

    const statusRes = await axios.get(`${RUNSCRIPT_API_URL}/${response.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    status = statusRes.data.status;
    jobData = statusRes.data;
    console.log(`   Status (${attempts}): ${status}`);
  }

  console.log("\n3. Job completed:");
  console.log("   Result:", jobData.result);
  if (jobData.error) console.log("   Error:", jobData.error);
  if (jobData.log) console.log("   Log:", jobData.log);

  // Wait and check S3
  console.log("\n4. Waiting 3s then checking S3...");
  await new Promise(r => setTimeout(r, 3000));

  try {
    const head = await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: outputKey,
    }));
    console.log("   ✓ PDF exists! Size:", head.ContentLength, "bytes");

    // Download
    const get = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: outputKey,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);
    console.log("   Header:", pdfBuffer.slice(0, 20).toString());

    // Save locally
    const localPath = path.join(process.cwd(), ".test-output", "indesign-scratch.pdf");
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, pdfBuffer);
    console.log("   Saved to:", localPath);

  } catch (error: any) {
    console.log("   ✗ File not found:", error.Code || error.message);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
