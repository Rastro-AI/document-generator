/**
 * Test different path combinations
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

async function testPaths(inputPath: string, outputPath: string, desc: string) {
  console.log(`\n=== Test: ${desc} ===`);
  console.log(`Input path: ${inputPath}, Output path: ${outputPath}`);

  const inputText = "test content";
  const inputBase64 = Buffer.from(inputText).toString("base64");
  const inputDataUrl = `data:text/plain;base64,${inputBase64}`;

  const outputKey = `runscript/pathtest_${Date.now()}/out.txt`;
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "text/plain",
  }), { expiresIn: 3600 });

  const script = `
var out = new File("${outputPath}");
out.open("w");
out.writeln("success");
out.close();
"ok";
`;

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: inputPath }],
    outputs: [{ href: putUrl, path: outputPath }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  let status = "queued";
  while (status !== "complete" && status !== "failed") {
    await new Promise(r => setTimeout(r, 1000));
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status = s.data.status;
  }

  await new Promise(r => setTimeout(r, 2000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("Result: ✓ Success -", Buffer.concat(chunks).toString().trim());
  } catch (e: any) {
    console.log("Result: ✗ Failed -", e.Code);
  }
}

async function main() {
  // Test 1: Same folder
  await testPaths("jobFolder/input.txt", "jobFolder/output.txt", "same folder");

  // Test 2: Different folders
  await testPaths("input/file.txt", "output/file.txt", "different folders");

  // Test 3: Root level
  await testPaths("input.txt", "output.txt", "root level");

  // Test 4: Only output, no input
  console.log(`\n=== Test: output only ===`);
  const outputKey = `runscript/noInput_${Date.now()}/out.txt`;
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "text/plain",
  }), { expiresIn: 3600 });

  const res = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [],
    outputs: [{ href: putUrl, path: "jobFolder/output.txt" }],
    script: `var out = new File("jobFolder/output.txt"); out.open("w"); out.writeln("no input test"); out.close(); "ok";`,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  let status = "queued";
  while (status !== "complete" && status !== "failed") {
    await new Promise(r => setTimeout(r, 1000));
    const s = await axios.get(`${RUNSCRIPT_API_URL}/${res.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status = s.data.status;
  }

  await new Promise(r => setTimeout(r, 2000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("Result: ✓ Success -", Buffer.concat(chunks).toString().trim());
  } catch (e: any) {
    console.log("Result: ✗ Failed -", e.Code);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
