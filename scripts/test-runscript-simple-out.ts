/**
 * Simplest possible output test
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
  console.log("=== Simplest Output Test ===\n");

  const outputKey = `runscript/simple_${Date.now()}/out.txt`;

  // Generate presigned URL
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "text/plain",
  }), { expiresIn: 3600 });

  console.log("Output key:", outputKey);
  console.log("PUT URL preview:", putUrl.substring(0, 80) + "...");

  // Simplest possible script
  const script = `
var f = new File("jobFolder/out.txt");
f.open("w");
f.writeln("hello");
f.close();
"ok";
`;

  console.log("\nSending to RunScript...");
  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: putUrl, path: "jobFolder/out.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job:", res.data._id);

  let status = "queued";
  let jobData: any;
  while (status !== "complete" && status !== "failed") {
    await new Promise(r => setTimeout(r, 1000));
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status = s.data.status;
    jobData = s.data;
    console.log("Status:", status);
  }

  console.log("\nResult:", jobData.result);
  console.log("Outputs from API:", JSON.stringify(jobData.outputs));

  // Wait a bit
  await new Promise(r => setTimeout(r, 3000));

  // Check S3
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\nS3 content:", Buffer.concat(chunks).toString());
  } catch (e: any) {
    console.log("\nS3 error:", e.Code || e.message);
  }
}

main().catch(console.error);
