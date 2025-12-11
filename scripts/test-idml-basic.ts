/**
 * Most basic IDML test - just check if input file arrives
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
  console.log("=== Basic IDML Test ===\n");

  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  console.log("IDML size:", idmlBuffer.length, "bytes");

  const outputKey = `runscript/basic_${Date.now()}/output.txt`;
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
    ContentType: "text/plain",
  }), { expiresIn: 3600 });

  // Minimal script - just report file existence
  const script = `
var f = new File("jobFolder/input.idml");
var out = new File("jobFolder/output.txt");
out.open("w");
out.writeln("exists=" + f.exists);
out.writeln("length=" + f.length);
out.close();
"done";
`;

  console.log("\nCalling RunScript...");
  const response = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
    outputs: [{ href: putUrl, path: "jobFolder/output.txt" }],
    script: script,
    ids: "2024",
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job:", response.data._id);

  // Poll
  let status = "queued";
  let jobData: any;
  while (status !== "complete" && status !== "failed") {
    await new Promise(r => setTimeout(r, 2000));
    const res = await axios.get(`${RUNSCRIPT_API_URL}/${response.data._id}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });
    status = res.data.status;
    jobData = res.data;
    console.log("Status:", status);
  }

  console.log("Result:", jobData.result);

  await new Promise(r => setTimeout(r, 2000));

  try {
    const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
    const chunks: Uint8Array[] = [];
    for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    console.log("\nOutput:\n" + Buffer.concat(chunks).toString());
  } catch (e: any) {
    console.log("No output:", e.Code);
  }
}

main().catch(console.error);
