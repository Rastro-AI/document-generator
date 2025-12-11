/**
 * Test IDML to PDF with folder creation workaround
 */

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import fs from "fs/promises";
import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
  console.log("=== Test IDML to PDF (with folder workaround) ===\n");

  // Load IDML
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  console.log("IDML size:", idmlBuffer.length, "bytes");

  const jobId = `idml_test_${Date.now()}`;
  const outputKey = `runscript/${jobId}/output.pdf`;

  // Generate presigned PUT URL
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "application/pdf",
  }), { expiresIn: 3600 });

  // Script with folder creation workaround
  const script = `
// Create jobFolder if it doesn't exist (workaround for RunScript issue)
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) {
  jobFolder.create();
}

var idmlPath = "jobFolder/input.idml";
var pdfPath = "jobFolder/output.pdf";

var inputFile = new File(idmlPath);
if (!inputFile.exists) {
  throw new Error("Input file not found: " + idmlPath);
}

var doc = app.open(inputFile);
var outputFile = new File(pdfPath);

try {
  var pdfPreset = app.pdfExportPresets.item("[High Quality Print]");
  doc.exportFile(ExportFormat.PDF_TYPE, outputFile, false, pdfPreset);
} catch (e) {
  doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
}

doc.close(SaveOptions.NO);
"PDF exported - size: " + outputFile.length + " bytes";
`;

  console.log("\nCalling RunScript...");

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
    outputs: [{ href: putUrl, path: "jobFolder/output.pdf" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job ID:", res.data._id);

  // Poll
  let status = "queued";
  let finalData: any;
  let attempts = 0;
  while (status !== "complete" && status !== "failed" && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status = s.data.status;
    finalData = s.data;
    console.log(`Status (${attempts}):`, status);
  }

  console.log("\nResult:", finalData.result);
  if (finalData.log) console.log("Log:", finalData.log);
  if (finalData.error) console.log("Error:", finalData.error);
  console.log("Cost:", finalData.usdCost);

  // Wait for S3 upload
  console.log("\nWaiting 5s for S3 upload...");
  await new Promise(r => setTimeout(r, 5000));

  // Download PDF
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const pdfBuffer = Buffer.concat(chunks);

    console.log("\n✓ PDF downloaded!");
    console.log("  Size:", pdfBuffer.length, "bytes");
    console.log("  Header:", pdfBuffer.slice(0, 10).toString());

    // Save locally
    const localPath = path.join(process.cwd(), ".test-output", "idml-to-pdf-fixed.pdf");
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, pdfBuffer);
    console.log("  Saved to:", localPath);

  } catch (e: any) {
    console.log("\n✗ PDF download failed:", e.Code || e.message);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
