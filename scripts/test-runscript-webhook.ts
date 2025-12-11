/**
 * Test RunScript API with webhook - see if we can get notified when done
 * Also test if output can be returned via webhook or result
 */

import axios from "axios";
import path from "path";
import fs from "fs/promises";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

async function main() {
  console.log("=== Testing RunScript API Options ===\n");

  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  // Let's test with a result string
  // InDesign ExtendScript returns the result of the last expression
  const script = `
var idmlPath = "jobFolder/input.idml";
var pdfPath = "jobFolder/output.pdf";

var inputFile = new File(idmlPath);
var doc = app.open(inputFile);
var outputFile = new File(pdfPath);
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
doc.close(SaveOptions.NO);

// Try setting app.scriptArgs for result
app.scriptArgs.setValue("pdfPath", pdfPath);

// The last expression is returned as result
"PDF_GENERATED:size=" + outputFile.length;
`;

  console.log("1. Testing with script return value...\n");

  const response = await axios.post(RUNSCRIPT_API_URL, {
    inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
    outputs: [],
    script: script,
    ids: "2024",
    // Try webhook
    // webhook: "https://webhook.site/your-id-here"
  }, {
    auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
  });

  console.log("Job created:", response.data._id);
  const jobId = response.data._id;

  // Poll for completion
  let status = "queued";
  let attempts = 0;
  let finalData: any = null;

  while (status !== "complete" && status !== "failed" && attempts < 60) {
    await new Promise(r => setTimeout(r, 2000));
    attempts++;

    const statusRes = await axios.get(`${RUNSCRIPT_API_URL}/${jobId}`, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    status = statusRes.data.status;
    finalData = statusRes.data;
    console.log(`Status (${attempts}): ${status}`);
  }

  console.log("\n=== Response Analysis ===");
  console.log("Result:", finalData.result);
  console.log("Error:", finalData.error || "none");

  // Check all keys to see what's available
  console.log("\nAll keys in response:", Object.keys(finalData));

  // Check if there's scriptReturn or similar
  for (const key of Object.keys(finalData)) {
    if (!["_id", "status", "script", "inputs", "outputs", "args", "client", "created", "__v", "blJobId", "completed", "result", "runTime", "usdCost"].includes(key)) {
      console.log(`Extra key "${key}":`, finalData[key]);
    }
  }

  console.log("\n2. Now testing with outputs array but data URL...\n");

  const script2 = `
var inputFile = new File("jobFolder/input.idml");
var doc = app.open(inputFile);
var outputFile = new File("jobFolder/output.pdf");
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
doc.close(SaveOptions.NO);
"done";
`;

  // Try with a data URL as output (likely will fail but worth testing)
  try {
    const response2 = await axios.post(RUNSCRIPT_API_URL, {
      inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
      outputs: [{ href: "data:application/pdf;base64,", path: "jobFolder/output.pdf" }],
      script: script2,
      ids: "2024",
    }, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    console.log("Job 2 created:", response2.data._id);

    // Poll
    let status2 = "queued";
    let attempts2 = 0;
    let finalData2: any = null;

    while (status2 !== "complete" && status2 !== "failed" && attempts2 < 30) {
      await new Promise(r => setTimeout(r, 2000));
      attempts2++;

      const statusRes = await axios.get(`${RUNSCRIPT_API_URL}/${response2.data._id}`, {
        auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
      });

      status2 = statusRes.data.status;
      finalData2 = statusRes.data;
      console.log(`Status 2 (${attempts2}): ${status2}`);
    }

    console.log("\nJob 2 result:", finalData2.result);
    console.log("Job 2 outputs:", JSON.stringify(finalData2.outputs, null, 2));
  } catch (error: any) {
    console.log("Job 2 error:", error.response?.status, error.response?.data || error.message);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
