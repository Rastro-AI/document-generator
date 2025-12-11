/**
 * Test using InDesign's place() method to replace image content
 * Instead of relinking, we place a new image into the existing frame
 */

import dotenv from "dotenv";
dotenv.config();

import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import axios from "axios";
import AdmZip from "adm-zip";
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
  console.log("=== Test Image Place Method ===\n");

  // 1. Download a test image
  console.log("1. Downloading test image...");
  const testImagePath = "/tmp/test-product.jpg";
  execSync(`curl -sL "https://picsum.photos/300/200" -o "${testImagePath}"`);
  const imageBuffer = await fs.readFile(testImagePath);
  console.log(`   Image size: ${imageBuffer.length} bytes`);

  // 2. Load IDML and update text only
  console.log("\n2. Loading IDML and updating text...");
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const zip = new AdmZip(idmlPath);

  // Update text placeholders only
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("Stories/Story_") && entry.entryName.endsWith(".xml")) {
      let content = entry.getData().toString("utf-8");
      content = content.replace(/\{\{PRODUCT_NAME\}\}/g, "Image Place Test Product");
      content = content.replace(/\{\{DESCRIPTION\}\}/g, "Testing place() method for images.");
      zip.updateFile(entry.entryName, Buffer.from(content, "utf-8"));
    }
  }

  const modifiedIdmlPath = "/tmp/place-test.idml";
  zip.writeZip(modifiedIdmlPath);
  const idmlBuffer = await fs.readFile(modifiedIdmlPath);
  console.log(`   IDML size: ${idmlBuffer.length} bytes`);

  // 3. Upload IDML and IMAGE separately to S3
  console.log("\n3. Uploading files to S3...");
  const jobId = `place_${Date.now()}`;

  // Upload IDML
  const idmlKey = `runscript/${jobId}/input.idml`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: idmlKey,
    Body: idmlBuffer,
  }));
  const idmlUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: BUCKET,
    Key: idmlKey,
  }), { expiresIn: 3600 });

  // Upload IMAGE
  const imageKey = `runscript/${jobId}/product.jpg`;
  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: imageKey,
    Body: imageBuffer,
    ContentType: "image/jpeg",
  }));
  const imageUrl = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: BUCKET,
    Key: imageKey,
  }), { expiresIn: 3600 });

  // Output URL
  const outputKey = `runscript/${jobId}/output.pdf`;
  const outputUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "application/pdf",
  }), { expiresIn: 3600 });

  console.log("   Files uploaded");

  // 4. Call RunScript - use place() to insert image into rectangle
  console.log("\n4. Calling RunScript with place() script...");

  // Script that finds the rectangle and places a new image into it
  const script = `
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) jobFolder.create();

var inputFile = new File("jobFolder/input.idml");
var imageFile = new File("jobFolder/product.jpg");

if (!inputFile.exists) throw new Error("IDML not found");

var doc = app.open(inputFile);

// Find the first rectangle (image frame) and place new image
var page = doc.pages[0];
var rectangles = page.rectangles;

if (rectangles.length > 0 && imageFile.exists) {
  var rect = rectangles[0];
  // Place image into the rectangle
  rect.place(imageFile);
  // Fit content to frame
  try {
    rect.fit(FitOptions.FILL_PROPORTIONALLY);
    rect.fit(FitOptions.CENTER_CONTENT);
  } catch(e) {}
}

var outputFile = new File("jobFolder/output.pdf");
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
doc.close(SaveOptions.NO);
"done";
`;

  try {
    const res = await axios.post(RUNSCRIPT_API_URL, {
      inputs: [
        { href: idmlUrl, path: "jobFolder/input.idml" },
        { href: imageUrl, path: "jobFolder/product.jpg" }
      ],
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

    console.log(`\n5. Result: ${finalData.result}`);
    if (finalData.log) console.log(`   Log: ${finalData.log}`);

    await new Promise(r => setTimeout(r, 5000));

    // Download PDF
    try {
      const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
      const chunks: Uint8Array[] = [];
      for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      const pdfBuffer = Buffer.concat(chunks);

      const pdfPath = path.join(process.cwd(), ".test-output", "place-test.pdf");
      await fs.writeFile(pdfPath, pdfBuffer);
      console.log(`\n✓ PDF created! Size: ${pdfBuffer.length} bytes`);

      const imgPath = pdfPath.replace(".pdf", "");
      execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${pdfPath}" "${imgPath}"`);
      console.log(`  Image: ${imgPath}-1.png`);

    } catch (e: any) {
      console.log(`\n✗ PDF download failed: ${e.Code || e.message}`);
      console.log("   (This is expected - multiple inputs break output uploads)");
    }

  } catch (e: any) {
    console.log(`   Error: ${e.response?.data || e.message}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
