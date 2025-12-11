/**
 * Test RunScript API output options
 * Can we get PDF output without S3?
 */

import axios from "axios";
import path from "path";
import fs from "fs/promises";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

async function main() {
  console.log("=== Testing RunScript Output Options ===\n");

  // Load the IDML template as base64
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");

  console.log(`IDML file size: ${idmlBuffer.length} bytes`);
  console.log(`Base64 length: ${idmlBase64.length} chars`);

  // Create data URL for input
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  // Script that opens IDML and exports PDF, then base64 encodes it to console
  const script = `
var idmlPath = "jobFolder/input.idml";
var pdfPath = "jobFolder/output.pdf";

app.consoleout("Starting IDML to PDF conversion...");

var inputFile = new File(idmlPath);
app.consoleout("Input file exists: " + inputFile.exists);

if (!inputFile.exists) {
  throw new Error("Input IDML not found");
}

// Open IDML
app.consoleout("Opening IDML...");
var doc = app.open(inputFile);
app.consoleout("Document opened: " + doc.name);

// Export to PDF
app.consoleout("Exporting to PDF...");
var outputFile = new File(pdfPath);
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
app.consoleout("PDF exported");

// Close document
doc.close(SaveOptions.NO);

// Check PDF was created
app.consoleout("PDF exists: " + outputFile.exists);
app.consoleout("PDF size: " + outputFile.length + " bytes");

app.consoleout("SUCCESS");
`;

  try {
    console.log("\nSending job to RunScript...");

    const response = await axios.post(RUNSCRIPT_API_URL, {
      inputs: [{ href: inputDataUrl, path: "jobFolder/input.idml" }],
      outputs: [], // No output URL - testing if we can retrieve it another way
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

    console.log("\n=== Final Job Data ===");
    console.log(JSON.stringify(finalData, null, 2));

    // Check if there's any way to get the output
    if (finalData.outputs && finalData.outputs.length > 0) {
      console.log("\nOutputs available:", finalData.outputs);
    }

    if (finalData.log) {
      console.log("\nJob log:", finalData.log);
    }

  } catch (error: any) {
    console.error("Error:", error.response?.status, error.response?.data || error.message);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
