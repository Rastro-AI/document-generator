/**
 * Debug RunScript - check ALL response fields
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
  console.log("=== Debug RunScript Response ===\n");

  const prefix = `runscript/debug_${Date.now()}`;
  const outputKey = `${prefix}/output.txt`;

  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
  }), { expiresIn: 3600 });

  console.log("Output S3 key:", outputKey);

  const script = `
var f = new File("jobFolder/output.txt");
f.open("w");
f.writeln("debug test " + new Date().toISOString());
f.close();
"completed at " + new Date().toISOString();
`;

  console.log("\nCalling RunScript...");
  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: putUrl, path: "jobFolder/output.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("\n=== Initial Response ===");
  console.log(JSON.stringify(res.data, null, 2));

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
    console.log("Polling... status:", status);
  }

  console.log("\n=== Final Response ===");
  console.log(JSON.stringify(finalData, null, 2));

  // Check S3 - list objects with prefix
  console.log("\n=== S3 Objects with prefix ===");
  const listRes = await s3Client.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  }));
  console.log("Objects found:", listRes.Contents?.length || 0);
  if (listRes.Contents) {
    for (const obj of listRes.Contents) {
      console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
    }
  }

  // Try to get the file
  console.log("\n=== Trying to GET the file ===");
  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("Content:", Buffer.concat(chunks).toString());
  } catch (e: any) {
    console.log("Error:", e.Code, e.message);
  }

  // Check all runscript folder to see what actually got uploaded
  console.log("\n=== Recent S3 objects in runscript/ folder ===");
  const allRes = await s3Client.send(new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: "runscript/",
    MaxKeys: 20,
  }));
  console.log("Total objects:", allRes.Contents?.length || 0);
  if (allRes.Contents) {
    for (const obj of allRes.Contents.slice(-10)) {
      console.log(`  - ${obj.Key} (${obj.Size} bytes)`);
    }
  }
}

main().catch(console.error);
