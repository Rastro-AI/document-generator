/**
 * Test if RunScript accepts any PUT URL for outputs (not just S3)
 * Testing with httpbin.org PUT endpoint
 */

import axios from "axios";
import path from "path";
import fs from "fs/promises";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

async function main() {
  console.log("=== Testing RunScript with HTTPBin PUT URL ===\n");

  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  const script = `
var inputFile = new File("jobFolder/input.idml");
var doc = app.open(inputFile);
var outputFile = new File("jobFolder/output.pdf");
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
doc.close(SaveOptions.NO);
"exported";
`;

  // Test 1: httpbin.org/put - accepts PUT requests
  console.log("Test 1: httpbin.org/put...\n");

  try {
    const response = await axios.post(RUNSCRIPT_API_URL, {
      inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
      outputs: [{ href: "https://httpbin.org/put", path: "jobFolder/output.pdf" }],
      script: script,
      ids: "2024",
    }, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    console.log("Job created:", response.data._id);
    const jobId = response.data._id;

    // Poll
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
      console.log(`Status (${attempts}): ${status}${finalData.error ? ` - Error: ${finalData.error}` : ""}`);
    }

    console.log("\nResult:", finalData.result);
    if (finalData.error) console.log("Error:", finalData.error);
    console.log("Outputs:", JSON.stringify(finalData.outputs, null, 2));
  } catch (error: any) {
    console.log("Error:", error.response?.status, error.response?.data || error.message);
  }

  // Test 2: Try with POST URL (postb.in or similar)
  console.log("\n\nTest 2: Different PUT service - postman-echo...\n");

  try {
    const response2 = await axios.post(RUNSCRIPT_API_URL, {
      inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
      outputs: [{ href: "https://postman-echo.com/put", path: "jobFolder/output.pdf" }],
      script: script,
      ids: "2024",
    }, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    console.log("Job created:", response2.data._id);
    const jobId2 = response2.data._id;

    // Poll
    let status2 = "queued";
    let attempts2 = 0;
    let finalData2: any = null;

    while (status2 !== "complete" && status2 !== "failed" && attempts2 < 60) {
      await new Promise(r => setTimeout(r, 2000));
      attempts2++;

      const statusRes = await axios.get(`${RUNSCRIPT_API_URL}/${jobId2}`, {
        auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
      });

      status2 = statusRes.data.status;
      finalData2 = statusRes.data;
      console.log(`Status (${attempts2}): ${status2}${finalData2.error ? ` - Error: ${finalData2.error}` : ""}`);
    }

    console.log("\nResult:", finalData2.result);
    if (finalData2.error) console.log("Error:", finalData2.error);
    console.log("Outputs:", JSON.stringify(finalData2.outputs, null, 2));
  } catch (error: any) {
    console.log("Error:", error.response?.status, error.response?.data || error.message);
  }

  console.log("\n=== Tests Complete ===");
}

main().catch(console.error);
