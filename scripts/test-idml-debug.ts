/**
 * Debug IDML processing with detailed logging
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
  console.log("=== Debug IDML Processing ===\n");

  // Load IDML
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  console.log("IDML size:", idmlBuffer.length, "bytes");

  const jobId = `debug_${Date.now()}`;
  const logKey = `runscript/${jobId}/log.txt`;

  // Generate presigned PUT URL for log output
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: logKey,
  }), { expiresIn: 3600 });

  // Debug script that logs everything
  const script = `
var log = "";

try {
  log += "Script started\\n";

  // Create folder
  var jobFolder = new Folder("jobFolder");
  log += "jobFolder exists before: " + jobFolder.exists + "\\n";
  if (!jobFolder.exists) {
    var created = jobFolder.create();
    log += "jobFolder.create() returned: " + created + "\\n";
  }
  log += "jobFolder exists after: " + jobFolder.exists + "\\n";
  log += "jobFolder path: " + jobFolder.absoluteURI + "\\n";

  // Check input
  var inputFile = new File("jobFolder/input.idml");
  log += "Input file path: " + inputFile.absoluteURI + "\\n";
  log += "Input exists: " + inputFile.exists + "\\n";

  if (inputFile.exists) {
    log += "Input size: " + inputFile.length + " bytes\\n";

    // Try to open
    log += "Opening IDML...\\n";
    try {
      var doc = app.open(inputFile);
      log += "Document opened: " + doc.name + "\\n";
      log += "Pages: " + doc.pages.length + "\\n";

      // Check page content
      var page = doc.pages[0];
      log += "Page 1 text frames: " + page.textFrames.length + "\\n";

      // Export PDF
      log += "Exporting PDF...\\n";
      var pdfFile = new File("jobFolder/output.pdf");

      try {
        doc.exportFile(ExportFormat.PDF_TYPE, pdfFile);
        log += "PDF export completed\\n";
        log += "PDF exists: " + pdfFile.exists + "\\n";
        log += "PDF size: " + pdfFile.length + " bytes\\n";
      } catch (exportErr) {
        log += "PDF export error: " + exportErr.message + "\\n";
      }

      doc.close(SaveOptions.NO);
      log += "Document closed\\n";

    } catch (openErr) {
      log += "IDML open error: " + openErr.message + "\\n";
      log += "Error name: " + openErr.name + "\\n";
    }
  } else {
    log += "ERROR: Input file not found!\\n";
  }

} catch (e) {
  log += "SCRIPT ERROR: " + e.message + "\\n";
}

log += "Script complete\\n";

// Write log to output
var logFile = new File("jobFolder/log.txt");
logFile.open("w");
logFile.write(log);
logFile.close();

log;
`;

  console.log("Calling RunScript...");

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
    outputs: [{ href: putUrl, path: "jobFolder/log.txt" }],
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
  if (finalData.log) console.log("RunScript log:", finalData.log);

  // Wait and get our debug log
  console.log("\nWaiting 5s...");
  await new Promise(r => setTimeout(r, 5000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: logKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\n=== InDesign Debug Log ===");
    console.log(Buffer.concat(chunks).toString());
  } catch (e: any) {
    console.log("No debug log:", e.Code);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
