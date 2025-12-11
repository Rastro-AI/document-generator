/**
 * Test S3 presigned PUT URL with RunScript
 * Debug: Is RunScript actually uploading to our presigned URL?
 */

import dotenv from "dotenv";
dotenv.config();

import axios from "axios";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
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
  console.log("=== Testing S3 Presigned PUT with RunScript ===\n");

  const testKey = `runscript/test_${Date.now()}/output.txt`;

  // Generate presigned PUT URL
  console.log("1. Generating presigned PUT URL...");
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: testKey,
    ContentType: "text/plain",
  }), { expiresIn: 3600 });

  console.log("   PUT URL:", putUrl.substring(0, 100) + "...\n");

  // Test if we can PUT directly
  console.log("2. Testing direct PUT to presigned URL...");
  try {
    const directPut = await axios.put(putUrl, "Hello from direct PUT", {
      headers: { "Content-Type": "text/plain" },
    });
    console.log("   Direct PUT status:", directPut.status);
  } catch (error: any) {
    console.log("   Direct PUT failed:", error.response?.status, error.message);
  }

  // Check if file exists
  console.log("\n3. Checking if file exists in S3...");
  try {
    const head = await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: testKey,
    }));
    console.log("   File exists! Size:", head.ContentLength);
  } catch (error: any) {
    console.log("   File not found:", error.Code || error.message);
  }

  // Now test with RunScript
  const testKey2 = `runscript/test_${Date.now()}_rs/output.txt`;

  console.log("\n4. Generating new presigned PUT URL for RunScript...");
  const putUrl2 = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: testKey2,
    ContentType: "text/plain",
  }), { expiresIn: 3600 });

  console.log("   PUT URL:", putUrl2.substring(0, 100) + "...\n");

  // Simple script that writes a file
  const script = `
var outputFile = new File("jobFolder/output.txt");
outputFile.open("w");
outputFile.write("Hello from InDesign Server!");
outputFile.close();
"File written";
`;

  console.log("5. Calling RunScript API with output URL...");
  const response = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: putUrl2, path: "jobFolder/output.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("   Job created:", response.data._id);

  // Poll for completion
  let status = "queued";
  let attempts = 0;
  let jobData: any = null;

  while (status !== "complete" && status !== "failed" && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;

    const statusRes = await axios.get(`${RUNSCRIPT_API_URL}/${response.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    status = statusRes.data.status;
    jobData = statusRes.data;
    console.log(`   Status (${attempts}): ${status}`);
  }

  console.log("\n   Job result:", jobData.result);
  if (jobData.error) console.log("   Job error:", jobData.error);

  // Check outputs in response
  console.log("   Job outputs:", JSON.stringify(jobData.outputs, null, 2));

  // Wait and check S3
  console.log("\n6. Waiting 5s then checking S3 for file...");
  await new Promise(r => setTimeout(r, 5000));

  try {
    const head = await s3Client.send(new HeadObjectCommand({
      Bucket: BUCKET,
      Key: testKey2,
    }));
    console.log("   ✓ File exists! Size:", head.ContentLength);

    // Download and print
    const get = await s3Client.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: testKey2,
    }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    console.log("   Content:", Buffer.concat(chunks).toString());
  } catch (error: any) {
    console.log("   ✗ File not found:", error.Code || error.message);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
