/**
 * Test without AWS SDK checksum
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
  console.log("=== Test PUT without checksum params ===\n");

  const outputKey = `runscript/nocksum_${Date.now()}/out.txt`;

  // Generate presigned URL without extra checksum options
  const putUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: outputKey,
    }),
    {
      expiresIn: 3600,
      // Don't add checksum headers
    }
  );

  // Remove checksum params from URL manually
  const cleanUrl = putUrl.replace(/&x-amz-checksum[^&]*/gi, "").replace(/&x-amz-sdk[^&]*/gi, "");

  console.log("Original URL params with checksum:");
  console.log(putUrl.split("?")[1].split("&").filter(p => p.includes("checksum") || p.includes("sdk")).join("\n"));

  console.log("\nCleaned URL (removed checksum):");
  console.log(cleanUrl.split("?")[1].split("&").filter(p => p.includes("checksum") || p.includes("sdk")).join("\n") || "(none)");

  console.log("\nUsing CLEANED URL...");

  const script = `var f = new File("jobFolder/out.txt"); f.open("w"); f.writeln("test"); f.close(); "ok";`;

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: cleanUrl, path: "jobFolder/out.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job:", res.data._id);

  let status = "queued";
  while (status !== "complete" && status !== "failed") {
    await new Promise(r => setTimeout(r, 1000));
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status = s.data.status;
    console.log("Status:", status);
  }

  await new Promise(r => setTimeout(r, 3000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\n✓ Success:", Buffer.concat(chunks).toString().trim());
  } catch (e: any) {
    console.log("\n✗ Failed:", e.Code);
  }

  // Now test with original URL
  console.log("\n\n=== Now testing with ORIGINAL URL (with checksum) ===");

  const outputKey2 = `runscript/withcksum_${Date.now()}/out.txt`;
  const putUrl2 = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey2,
  }), { expiresIn: 3600 });

  const res2 = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: putUrl2, path: "jobFolder/out.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job:", res2.data._id);

  let status2 = "queued";
  while (status2 !== "complete" && status2 !== "failed") {
    await new Promise(r => setTimeout(r, 1000));
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res2.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status2 = s.data.status;
    console.log("Status:", status2);
  }

  await new Promise(r => setTimeout(r, 3000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey2 }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\n✓ Success:", Buffer.concat(chunks).toString().trim());
  } catch (e: any) {
    console.log("\n✗ Failed:", e.Code);
  }
}

main().catch(console.error);
