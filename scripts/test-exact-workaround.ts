/**
 * Run the exact script that worked earlier
 */

import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
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
  console.log("=== Run Exact Working Script ===\n");

  // The EXACT script that worked (test3 - "Create folder first")
  const script = `
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) {
  jobFolder.create();
}
var outputFile = new File("jobFolder/output.txt");
outputFile.open("w");
outputFile.write("test3");
outputFile.close();
"done";
`;

  const jobId = `exact_${Date.now()}`;
  const outputKey = `runscript/${jobId}/output.txt`;

  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
  }), { expiresIn: 3600 });

  console.log("Output key:", outputKey);
  console.log("Calling RunScript (NO inputs)...");

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],  // NO INPUTS - like the working test
    outputs: [{ href: putUrl, path: "jobFolder/output.txt" }],
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

  // Check S3
  console.log("\nChecking S3...");

  // List objects in our prefix
  const list = await s3Client.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: `runscript/${jobId}/`,
  }));
  console.log("Objects in prefix:", list.Contents?.length || 0);
  if (list.Contents) {
    for (const obj of list.Contents) {
      console.log("  -", obj.Key, `(${obj.Size} bytes)`);
    }
  }

  // Try to get the file
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\n✓ Content:", Buffer.concat(chunks).toString());
  } catch (e: any) {
    console.log("\n✗ No file:", e.Code);
  }

  // Now run the SAME script but WITH an input
  console.log("\n\n=== Now with an input ===");

  const inputText = "hello";
  const inputBase64 = Buffer.from(inputText).toString("base64");
  const inputDataUrl = `data:text/plain;base64,${inputBase64}`;

  const jobId2 = `exact_input_${Date.now()}`;
  const outputKey2 = `runscript/${jobId2}/output.txt`;

  const putUrl2 = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey2,
  }), { expiresIn: 3600 });

  console.log("Output key:", outputKey2);
  console.log("Calling RunScript (WITH input)...");

  const res2 = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.txt" }],  // WITH INPUT
    outputs: [{ href: putUrl2, path: "jobFolder/output.txt" }],
    script: script,  // Same script
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job ID:", res2.data._id);

  // Poll
  let status2 = "queued";
  let finalData2: any;
  while (status2 !== "complete" && status2 !== "failed") {
    await new Promise(r => setTimeout(r, 2000));
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res2.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status2 = s.data.status;
    finalData2 = s.data;
    console.log("Status:", status2);
  }

  console.log("\nResult:", finalData2.result);
  if (finalData2.log) console.log("Log:", finalData2.log);

  await new Promise(r => setTimeout(r, 5000));

  // Check S3
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey2 }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\n✓ Content:", Buffer.concat(chunks).toString());
  } catch (e: any) {
    console.log("\n✗ No file:", e.Code);
  }
}

main().catch(console.error);
