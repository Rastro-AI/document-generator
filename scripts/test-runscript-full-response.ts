/**
 * Test RunScript API - get full response to see all fields
 */

import axios from "axios";
import path from "path";
import fs from "fs/promises";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

async function main() {
  console.log("=== Testing RunScript Full Response ===\n");

  // Create a simple IDML test - just a tiny IDML
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  // Simple script that logs output
  const script = `
var idmlPath = "jobFolder/input.idml";
var pdfPath = "jobFolder/output.pdf";

$.write("Script starting...\\n");
app.consoleout("Script starting via consoleout");

var inputFile = new File(idmlPath);
$.write("Input exists: " + inputFile.exists + "\\n");

if (inputFile.exists) {
  var doc = app.open(inputFile);
  $.write("Document opened: " + doc.name + "\\n");

  var outputFile = new File(pdfPath);
  doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
  $.write("PDF exported\\n");

  doc.close(SaveOptions.NO);

  $.write("PDF file exists: " + outputFile.exists + "\\n");
  $.write("PDF file size: " + outputFile.length + " bytes\\n");
}

$.write("Done\\n");
`;

  try {
    console.log("Sending job to RunScript...\n");

    const response = await axios.post(RUNSCRIPT_API_URL, {
      inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
      outputs: [],
      script: script,
      ids: "2024",
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

    console.log("\n=== FULL JOB RESPONSE ===");
    console.log(JSON.stringify(finalData, null, 2));

  } catch (error: any) {
    console.error("Error:", error.response?.status, error.response?.data || error.message);
  }
}

main().catch(console.error);
