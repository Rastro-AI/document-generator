/**
 * Test if InDesign can open our IDML file
 */

import dotenv from "dotenv";
dotenv.config();

import path from "path";
import fs from "fs/promises";
import axios from "axios";
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
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
  console.log("=== Testing IDML Open ===\n");

  // Load IDML
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  const jobId = `test_open_${Date.now()}`;
  const outputKey = `runscript/${jobId}/result.txt`;

  // Generate PUT URL for output
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "text/plain",
  }), { expiresIn: 3600 });

  // Script that tries to open the IDML and reports what happens
  const script = `
var result = "";

try {
  result += "Starting...\\n";

  var inputFile = new File("jobFolder/input.idml");
  result += "Input file path: " + inputFile.absoluteURI + "\\n";
  result += "Input exists: " + inputFile.exists + "\\n";

  if (inputFile.exists) {
    result += "Input length: " + inputFile.length + " bytes\\n";

    result += "Attempting to open IDML...\\n";

    try {
      var doc = app.open(inputFile);
      result += "SUCCESS: Document opened!\\n";
      result += "Document name: " + doc.name + "\\n";
      result += "Pages: " + doc.pages.length + "\\n";

      // Try to access content
      var pageCount = doc.pages.length;
      for (var i = 0; i < pageCount; i++) {
        var page = doc.pages[i];
        result += "Page " + (i+1) + " has " + page.textFrames.length + " text frames\\n";
      }

      // Export PDF
      result += "Exporting to PDF...\\n";
      var outputPdf = new File("jobFolder/output.pdf");
      doc.exportFile(ExportFormat.PDF_TYPE, outputPdf);
      result += "PDF exported: " + outputPdf.exists + "\\n";
      if (outputPdf.exists) {
        result += "PDF size: " + outputPdf.length + " bytes\\n";
      }

      doc.close(SaveOptions.NO);
      result += "Document closed\\n";

    } catch (openError) {
      result += "OPEN ERROR: " + openError.message + "\\n";
      result += "Error name: " + openError.name + "\\n";
      result += "Error number: " + openError.number + "\\n";
    }
  } else {
    result += "ERROR: Input file does not exist!\\n";
  }

} catch (e) {
  result += "SCRIPT ERROR: " + e.message + "\\n";
}

// Write result to file
var outputFile = new File("jobFolder/result.txt");
outputFile.open("w");
outputFile.write(result);
outputFile.close();

result;
`;

  console.log("Calling RunScript API...");
  const response = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
    outputs: [{ href: putUrl, path: "jobFolder/result.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job created:", response.data._id);

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
    console.log(`Status (${attempts}): ${status}`);
  }

  console.log("\nJob result:", jobData.result);
  if (jobData.error) console.log("Job error:", jobData.error);

  // Get result from S3
  console.log("\nRetrieving result from S3...");
  await new Promise(r => setTimeout(r, 2000));

  try {
    const get = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: outputKey,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    console.log("\n=== Script Output ===");
    console.log(Buffer.concat(chunks).toString());
  } catch (error: any) {
    console.log("Could not retrieve result:", error.Code || error.message);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
