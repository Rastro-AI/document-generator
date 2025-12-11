/**
 * Try different workarounds for RunScript job folder issue
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

interface TestResult {
  name: string;
  success: boolean;
  error?: string;
  content?: string;
}

async function runTest(name: string, payload: object): Promise<TestResult> {
  console.log(`\n--- ${name} ---`);

  const outputKey = `runscript/${name.replace(/\s+/g, "_")}_${Date.now()}/output.txt`;
  const putUrl = await getSignedUrl(s3Client, new PutObjectCommand({
    Bucket: BUCKET,
    Key: outputKey,
  }), { expiresIn: 3600 });

  try {
    const res = await axios.post(RUNSCRIPT_API_URL, {
      ...payload,
      outputs: [{ href: putUrl, path: "jobFolder/output.txt" }],
    }, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    let status = "queued";
    let finalData: any;
    let attempts = 0;
    while (status !== "complete" && status !== "failed" && attempts < 15) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
      const s = await axios.get(`${RUNSCRIPT_API_URL}/${res.data._id}`, {
        auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
      });
      status = s.data.status;
      finalData = s.data;
    }

    console.log(`  Status: ${status}, Result: ${finalData.result}`);
    if (finalData.log) console.log(`  Log: ${finalData.log.substring(0, 200)}`);

    if (status === "failed") {
      return { name, success: false, error: finalData.log || finalData.error };
    }

    await new Promise(r => setTimeout(r, 3000));

    try {
      const get = await s3Client.send(new GetObjectCommand({ Bucket: BUCKET, Key: outputKey }));
      const chunks: Uint8Array[] = [];
      for await (const chunk of get.Body as AsyncIterable<Uint8Array>) chunks.push(chunk);
      const content = Buffer.concat(chunks).toString().trim();
      console.log(`  ✓ Output: ${content}`);
      return { name, success: true, content };
    } catch {
      console.log(`  ✗ No output file`);
      return { name, success: false, error: "No output file uploaded" };
    }
  } catch (e: any) {
    console.log(`  Error: ${e.response?.data || e.message}`);
    return { name, success: false, error: e.message };
  }
}

async function main() {
  console.log("=== RunScript Workaround Tests ===");
  const results: TestResult[] = [];

  // Test 1: Use absolute path with Folder.current
  results.push(await runTest("Folder.current path", {
    inputs: [],
    script: `
var folder = Folder.current;
var outputFile = new File(folder.absoluteURI + "/jobFolder/output.txt");
outputFile.open("w");
outputFile.write("test1");
outputFile.close();
"done";
`,
    ids: "2024",
  }));

  // Test 2: Use temp folder
  results.push(await runTest("Temp folder", {
    inputs: [],
    script: `
var tempFolder = Folder.temp;
var outputFile = new File(tempFolder.absoluteURI + "/output.txt");
outputFile.open("w");
outputFile.write("test2");
outputFile.close();
// Copy to expected location
var destFile = new File("jobFolder/output.txt");
outputFile.copy(destFile);
"done";
`,
    ids: "2024",
  }));

  // Test 3: Create folder first
  results.push(await runTest("Create folder first", {
    inputs: [],
    script: `
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) {
  jobFolder.create();
}
var outputFile = new File("jobFolder/output.txt");
outputFile.open("w");
outputFile.write("test3");
outputFile.close();
"done";
`,
    ids: "2024",
  }));

  // Test 4: Different InDesign version
  results.push(await runTest("IDS 2023", {
    inputs: [],
    script: `var f = new File("jobFolder/output.txt"); f.open("w"); f.write("test4"); f.close(); "done";`,
    ids: "2023",
  }));

  // Test 5: No IDS version specified
  results.push(await runTest("No IDS version", {
    inputs: [],
    script: `var f = new File("jobFolder/output.txt"); f.open("w"); f.write("test5"); f.close(); "done";`,
  }));

  // Test 6: Use document path
  results.push(await runTest("Doc from scratch with path", {
    inputs: [],
    script: `
var doc = app.documents.add();
var page = doc.pages[0];
var tf = page.textFrames.add();
tf.geometricBounds = [72,72,200,400];
tf.contents = "Test";

// Get working folder from script location
var scriptFile = new File($.fileName);
var workFolder = scriptFile.parent;

var pdfFile = new File(workFolder.absoluteURI + "/jobFolder/output.txt");
var txtFile = new File("jobFolder/output.txt");
txtFile.open("w");
txtFile.write("test6 - folder: " + workFolder.absoluteURI);
txtFile.close();

doc.close(SaveOptions.NO);
"done";
`,
    ids: "2024",
  }));

  // Test 7: Use app.scriptArgs to check environment
  results.push(await runTest("Check scriptArgs", {
    inputs: [],
    args: [{ name: "testArg", value: "testValue" }],
    script: `
var argVal = "";
try {
  argVal = app.scriptArgs.getValue("testArg");
} catch(e) {
  argVal = "error: " + e.message;
}
var f = new File("jobFolder/output.txt");
f.open("w");
f.write("arg=" + argVal);
f.close();
"done";
`,
    ids: "2024",
  }));

  // Test 8: Minimal script - just return value
  results.push(await runTest("Just return", {
    inputs: [],
    script: `"hello";`,
    ids: "2024",
  }));

  // Print summary
  console.log("\n\n=== Summary ===");
  for (const r of results) {
    console.log(`${r.success ? "✓" : "✗"} ${r.name}: ${r.success ? r.content : r.error?.substring(0, 80)}`);
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`\nPassed: ${successCount}/${results.length}`);
}

main().catch(console.error);
