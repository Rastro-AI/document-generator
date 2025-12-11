/**
 * Test IDML to PDF conversion with RunScript - debug version
 */

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import fs from "fs/promises";
import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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
  console.log("=== Testing IDML to PDF with RunScript ===\n");

  const jobId = `idml_pdf_${Date.now()}`;
  const outputKey = `runscript/${jobId}/output.pdf`;

  // Load IDML and convert to base64
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  console.log("IDML size:", idmlBuffer.length, "bytes");
  console.log("Base64 size:", idmlBase64.length, "chars\n");

  // Generate presigned PUT URL for output
  console.log("1. Generating presigned PUT URL for output...");
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "application/pdf",
  }), { expiresIn: 3600 });

  console.log("   Key:", outputKey);

  // Simple script that logs everything
  const script = `
// Log start
$.writeln("Script starting...");

var inputPath = "jobFolder/input.idml";
var outputPath = "jobFolder/output.pdf";

$.writeln("Input path: " + inputPath);
$.writeln("Output path: " + outputPath);

// Check if input exists
var inputFile = new File(inputPath);
$.writeln("Input exists: " + inputFile.exists);

if (!inputFile.exists) {
  $.writeln("ERROR: Input file not found!");
} else {
  // Open document
  $.writeln("Opening IDML...");
  try {
    var doc = app.open(inputFile);
    $.writeln("Document opened: " + doc.name);
    $.writeln("Pages: " + doc.pages.length);

    // Export to PDF
    $.writeln("Exporting to PDF...");
    var outputFile = new File(outputPath);

    // Use basic PDF export
    doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
    $.writeln("PDF exported");

    // Check output
    $.writeln("Output exists: " + outputFile.exists);
    $.writeln("Output size: " + outputFile.length + " bytes");

    // Close
    doc.close(SaveOptions.NO);
    $.writeln("Document closed");

  } catch (e) {
    $.writeln("ERROR: " + e.message);
    throw e;
  }
}

$.writeln("Script complete");
"done";
`;

  console.log("\n2. Calling RunScript API...");
  const response = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
    outputs: [{ href: putUrl, path: "jobFolder/output.pdf" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("   Job created:", response.data._id);

  // Poll for completion
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

    // Download first 10 bytes to verify it's a PDF
    const get = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: outputKey,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);
    console.log("   Downloaded:", pdfBuffer.length, "bytes");
    console.log("   Header:", pdfBuffer.slice(0, 20).toString());

    // Save to local file
    const localPath = path.join(process.cwd(), ".test-output", "idml-runscript.pdf");
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, pdfBuffer);
    console.log("   Saved to:", localPath);

  } catch (error: any) {
    console.log("   ✗ File not found:", error.Code || error.message);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
