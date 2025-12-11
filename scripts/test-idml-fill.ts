/**
 * Test IDML placeholder filling - replace {{PRODUCT_NAME}} and {{DESCRIPTION}} with values
 */

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import fs from "fs/promises";
import archiver from "archiver";
import { execSync } from "child_process";
import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import AdmZip from "adm-zip";

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

async function fillIdmlPlaceholders(
  idmlPath: string,
  fields: Record<string, string>
): Promise<Buffer> {
  // Read IDML as zip
  const zip = new AdmZip(idmlPath);

  // Find and modify Story files
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("Stories/Story_") && entry.entryName.endsWith(".xml")) {
      let content = entry.getData().toString("utf-8");
      let modified = false;

      // Replace placeholders
      for (const [key, value] of Object.entries(fields)) {
        const placeholder = `{{${key}}}`;
        if (content.includes(placeholder)) {
          // Escape XML special characters in value
          const escapedValue = value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
          content = content.replace(new RegExp(placeholder.replace(/[{}]/g, "\\$&"), "g"), escapedValue);
          modified = true;
          console.log(`   Replaced ${placeholder} in ${entry.entryName}`);
        }
      }

      if (modified) {
        zip.updateFile(entry.entryName, Buffer.from(content, "utf-8"));
      }
    }
  }

  return zip.toBuffer();
}

async function main() {
  console.log("=== Test IDML Placeholder Filling ===\n");

  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");

  // Test values
  const fields = {
    PRODUCT_NAME: "LED Downlight Pro X500",
    DESCRIPTION: "High-efficiency LED lighting fixture with 5000 lumens output.",
  };

  console.log("1. Filling placeholders...");
  const filledBuffer = await fillIdmlPlaceholders(idmlPath, fields);
  console.log(`   Filled IDML size: ${filledBuffer.length} bytes`);

  // Save filled IDML for inspection
  const filledIdmlPath = path.join(process.cwd(), ".test-output", "filled-template.idml");
  await fs.mkdir(path.dirname(filledIdmlPath), { recursive: true });
  await fs.writeFile(filledIdmlPath, filledBuffer);
  console.log(`   Saved to: ${filledIdmlPath}`);

  // Verify placeholders are replaced
  console.log("\n2. Verifying replacement...");
  const verifyDir = "/tmp/verify_filled";
  await fs.rm(verifyDir, { recursive: true, force: true });
  await fs.mkdir(verifyDir, { recursive: true });
  execSync(`unzip -q "${filledIdmlPath}" -d "${verifyDir}"`);

  const story188 = await fs.readFile(path.join(verifyDir, "Stories", "Story_u188.xml"), "utf-8");
  console.log(`   Story_u188 contains "LED Downlight": ${story188.includes("LED Downlight")}`);
  console.log(`   Story_u188 contains "{{PRODUCT_NAME}}": ${story188.includes("{{PRODUCT_NAME}}")}`);

  // Render with RunScript
  console.log("\n3. Uploading to S3 and rendering...");
  const jobId = `fill_test_${Date.now()}`;
  const inputKey = `runscript/${jobId}/input.idml`;
  const outputKey = `runscript/${jobId}/output.pdf`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: inputKey,
    Body: filledBuffer,
    ContentType: "application/vnd.adobe.indesign-idml-package",
  }));

  const inputUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: BUCKET,
    Key: inputKey,
  }), { expiresIn: 3600 });

  const outputUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "application/pdf",
  }), { expiresIn: 3600 });

  const script = `
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) jobFolder.create();
var doc = app.open(new File("jobFolder/input.idml"));
var outputFile = new File("jobFolder/output.pdf");
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
doc.close(SaveOptions.NO);
"done";
`;

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputUrl, path: "jobFolder/input.idml" }],
    outputs: [{ href: outputUrl, path: "jobFolder/output.pdf" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log(`   Job ID: ${res.data._id}`);

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
    console.log(`   Status: ${status}`);
  }

  console.log(`   Result: ${finalData.result}`);
  if (finalData.log) console.log(`   Log: ${finalData.log}`);

  await new Promise(r => setTimeout(r, 5000));

  // Download PDF
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const pdfBuffer = Buffer.concat(chunks);

    const pdfPath = path.join(process.cwd(), ".test-output", "filled-idml-output.pdf");
    await fs.writeFile(pdfPath, pdfBuffer);

    console.log(`\n✓ Filled PDF rendered!`);
    console.log(`  Size: ${pdfBuffer.length} bytes`);
    console.log(`  Saved to: ${pdfPath}`);

  } catch (e: any) {
    console.log(`\n✗ PDF download failed: ${e.Code || e.message}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
