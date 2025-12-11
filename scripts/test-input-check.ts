/**
 * Check if inputs are actually being delivered
 */

import dotenv from "dotenv";
dotenv.config();

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
  console.log("=== Check Input Delivery ===\n");

  // Simple text input
  const inputText = "Hello input!";
  const inputBase64 = Buffer.from(inputText).toString("base64");
  const inputDataUrl = `data:text/plain;base64,${inputBase64}`;

  const jobId = `input_check_${Date.now()}`;
  const outputKey = `runscript/${jobId}/result.txt`;

  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
  }), { expiresIn: 3600 });

  // Script that checks if input exists and reports
  const script = `
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) {
  jobFolder.create();
}

var result = "Checking inputs:\\n";

// Check input.txt
var inputFile = new File("jobFolder/input.txt");
result += "input.txt exists: " + inputFile.exists + "\\n";
if (inputFile.exists) {
  inputFile.open("r");
  var content = inputFile.read();
  inputFile.close();
  result += "input.txt content: " + content + "\\n";
  result += "input.txt size: " + inputFile.length + "\\n";
}

// List files in jobFolder
result += "\\nFolder contents:\\n";
var files = jobFolder.getFiles();
for (var i = 0; i < files.length; i++) {
  result += "  - " + files[i].name + "\\n";
}

// Write result
var outFile = new File("jobFolder/result.txt");
outFile.open("w");
outFile.write(result);
outFile.close();

result;
`;

  console.log("Calling RunScript with input...");

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.txt" }],
    outputs: [{ href: putUrl, path: "jobFolder/result.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job ID:", res.data._id);

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
    console.log("Status:", status);
  }

  console.log("\nResult:", finalData.result);
  if (finalData.log) console.log("Log:", finalData.log);

  await new Promise(r => setTimeout(r, 5000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\n=== Result ===");
    console.log(Buffer.concat(chunks).toString());
  } catch (e: any) {
    console.log("\nNo output file:", e.Code);
  }
}

main().catch(console.error);
