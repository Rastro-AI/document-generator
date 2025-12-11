/**
 * Simple test with fixed ExtendScript
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
  console.log("=== Simple Test (Fixed ExtendScript) ===\n");

  const outputKey = `runscript/fixed_${Date.now()}/output.txt`;

  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
  }), { expiresIn: 3600 });

  // Fixed script - no modern JS
  const script = `
var f = new File("jobFolder/output.txt");
f.open("w");
f.writeln("Test at " + Date.now());
f.close();
"done";
`;

  console.log("Output key:", outputKey);
  console.log("Calling RunScript...");

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: putUrl, path: "jobFolder/output.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job ID:", res.data._id);

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
  if (finalData.error) console.log("Error:", finalData.error);

  await new Promise(r => setTimeout(r, 3000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\n✓ File content:", Buffer.concat(chunks).toString().trim());
  } catch (e: any) {
    console.log("\n✗ File error:", e.Code);
  }
}

main().catch(console.error);
