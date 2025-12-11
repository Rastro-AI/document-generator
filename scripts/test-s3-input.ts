/**
 * Try using S3 presigned GET URL for input instead of data URL
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
  console.log("=== Test S3 Input URL ===\n");

  const jobId = `s3input_${Date.now()}`;

  // 1. Upload IDML to S3 first
  console.log("1. Uploading IDML to S3...");
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);

  const inputKey = `runscript/${jobId}/input.idml`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: inputKey,
    Body: idmlBuffer,
    ContentType: "application/vnd.adobe.indesign-idml-package",
  }));
  console.log("   Uploaded to:", inputKey);

  // 2. Generate presigned GET URL for input
  const inputUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: BUCKET,
    Key: inputKey,
  }), { expiresIn: 3600 });
  console.log("   Input URL generated");

  // 3. Generate presigned PUT URL for output
  const outputKey = `runscript/${jobId}/output.pdf`;
  const outputUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "application/pdf",
  }), { expiresIn: 3600 });
  console.log("   Output URL generated");

  // Script
  const script = `
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) {
  jobFolder.create();
}

var inputFile = new File("jobFolder/input.idml");
if (!inputFile.exists) {
  throw new Error("Input not found");
}

var doc = app.open(inputFile);
var outputFile = new File("jobFolder/output.pdf");
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
doc.close(SaveOptions.NO);

"PDF size: " + outputFile.length;
`;

  console.log("\n2. Calling RunScript with S3 input URL...");

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputUrl, path: "jobFolder/input.idml" }],
    outputs: [{ href: outputUrl, path: "jobFolder/output.pdf" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("   Job ID:", res.data._id);

  // Poll
  let status = "queued";
  let finalData: any;
  while (status !== "complete" && status !== "failed") {
    await new Promise(r => setTimeout(r, 2000));
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status = s.data.status;
    finalData = s.data;
    console.log("   Status:", status);
  }

  console.log("\n3. Result:", finalData.result);
  if (finalData.log) console.log("   Log:", finalData.log);

  await new Promise(r => setTimeout(r, 5000));

  // Check output
  console.log("\n4. Checking S3 for output...");
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const pdfBuffer = Buffer.concat(chunks);

    console.log("   ✓ PDF found! Size:", pdfBuffer.length, "bytes");
    console.log("   Header:", pdfBuffer.slice(0, 10).toString());

    // Save locally
    const localPath = path.join(process.cwd(), ".test-output", "s3-input-test.pdf");
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, pdfBuffer);
    console.log("   Saved to:", localPath);

  } catch (e: any) {
    console.log("   ✗ No PDF:", e.Code);
  }
}

main().catch(console.error);
