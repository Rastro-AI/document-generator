/**
 * Test embedding image directly into IDML before RunScript
 *
 * Strategy:
 * 1. Extract IDML
 * 2. Add image to Resources folder
 * 3. Update Link element to point to embedded image
 * 4. Repack IDML
 * 5. Upload single IDML to RunScript (no separate inputs)
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
  console.log("=== Test Embedded Image in IDML ===\n");

  // 1. Download a test image
  console.log("1. Downloading test image...");
  const testImagePath = "/tmp/test-product.jpg";
  execSync(`curl -sL "https://picsum.photos/300/200" -o "${testImagePath}"`);
  const imageBuffer = await fs.readFile(testImagePath);
  console.log(`   Image size: ${imageBuffer.length} bytes`);

  // 2. Load and extract IDML
  console.log("\n2. Loading IDML template...");
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const zip = new AdmZip(idmlPath);

  // 3. Add image to Resources folder in IDML
  console.log("\n3. Embedding image into IDML...");
  // Create Resources folder entry if needed and add image
  zip.addFile("Resources/Images/product_image.jpg", imageBuffer);
  console.log("   Added: Resources/Images/product_image.jpg");

  // 4. Update the Spread XML to point to embedded image
  console.log("\n4. Updating link references...");
  const spreadEntry = zip.getEntry("Spreads/Spread_ud6.xml");
  if (spreadEntry) {
    let spreadXml = spreadEntry.getData().toString("utf-8");

    // Replace the placeholder with relative path to embedded image
    // Change LinkResourceURI from {{IMAGE:PRODUCT_IMAGE}} to Resources/Images/product_image.jpg
    spreadXml = spreadXml.replace(
      /LinkResourceURI="[^"]*\{\{IMAGE:PRODUCT_IMAGE\}\}[^"]*"/g,
      'LinkResourceURI="Resources/Images/product_image.jpg"'
    );

    // Also update any file:// paths
    spreadXml = spreadXml.replace(
      /LinkResourceURI="file:[^"]*"/g,
      'LinkResourceURI="Resources/Images/product_image.jpg"'
    );

    zip.updateFile("Spreads/Spread_ud6.xml", Buffer.from(spreadXml, "utf-8"));
    console.log("   Updated Spread_ud6.xml");
  }

  // 5. Update text placeholders
  console.log("\n5. Updating text placeholders...");
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith("Stories/Story_") && entry.entryName.endsWith(".xml")) {
      let content = entry.getData().toString("utf-8");
      let modified = false;

      if (content.includes("{{PRODUCT_NAME}}")) {
        content = content.replace(/\{\{PRODUCT_NAME\}\}/g, "Embedded Image Test Product");
        modified = true;
      }
      if (content.includes("{{DESCRIPTION}}")) {
        content = content.replace(/\{\{DESCRIPTION\}\}/g, "Testing embedded image approach for IDML templates.");
        modified = true;
      }

      if (modified) {
        zip.updateFile(entry.entryName, Buffer.from(content, "utf-8"));
        console.log(`   Updated ${entry.entryName}`);
      }
    }
  }

  // 6. Save modified IDML
  const modifiedIdmlPath = "/tmp/embedded-image-test.idml";
  zip.writeZip(modifiedIdmlPath);
  const modifiedBuffer = await fs.readFile(modifiedIdmlPath);
  console.log(`\n6. Modified IDML saved: ${modifiedBuffer.length} bytes`);

  // 7. Upload to S3
  console.log("\n7. Uploading to S3...");
  const jobId = `embedded_${Date.now()}`;
  const inputKey = `runscript/${jobId}/input.idml`;
  const outputKey = `runscript/${jobId}/output.pdf`;

  await s3Client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: inputKey,
    Body: modifiedBuffer,
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

  // 8. Call RunScript with SINGLE input (no separate image input)
  console.log("\n8. Calling RunScript (single input)...");

  const script = `
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) jobFolder.create();

var inputFile = new File("jobFolder/input.idml");
if (!inputFile.exists) throw new Error("Input not found");

var doc = app.open(inputFile);

// Update links to use embedded images
for (var i = 0; i < doc.links.length; i++) {
  var link = doc.links[i];
  try {
    link.update();
  } catch(e) {}
}

var outputFile = new File("jobFolder/output.pdf");
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
doc.close(SaveOptions.NO);
"done";
`;

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputUrl, path: "jobFolder/input.idml" }],  // SINGLE INPUT
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

  console.log(`\n9. Result: ${finalData.result}`);
  if (finalData.log) console.log(`   Log: ${finalData.log}`);

  await new Promise(r => setTimeout(r, 5000));

  // 10. Download and check PDF
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const pdfBuffer = Buffer.concat(chunks);

    const pdfPath = path.join(process.cwd(), ".test-output", "embedded-image-test.pdf");
    await fs.mkdir(path.dirname(pdfPath), { recursive: true });
    await fs.writeFile(pdfPath, pdfBuffer);

    console.log(`\n✓ PDF created! Size: ${pdfBuffer.length} bytes`);
    console.log(`  Saved to: ${pdfPath}`);

    // Convert to image
    const imgPath = pdfPath.replace(".pdf", "");
    execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${pdfPath}" "${imgPath}"`);
    console.log(`  Image: ${imgPath}-1.png`);

  } catch (e: any) {
    console.log(`\n✗ PDF download failed: ${e.Code || e.message}`);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
