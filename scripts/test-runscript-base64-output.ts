/**
 * Test RunScript API - can we get PDF back as base64 in console output?
 */

import axios from "axios";
import path from "path";
import fs from "fs/promises";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

async function main() {
  console.log("=== Testing RunScript Base64 Output ===\n");

  // Load the IDML template as base64
  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  const idmlBuffer = await fs.readFile(idmlPath);
  const idmlBase64 = idmlBuffer.toString("base64");

  console.log(`IDML file size: ${idmlBuffer.length} bytes`);

  // Create data URL for input
  const inputDataUrl = `data:application/vnd.adobe.indesign-idml-package;base64,${idmlBase64}`;

  // Script that opens IDML, exports PDF, and reads it back as base64
  // Using ExtendScript's BinaryFile to read the PDF
  const script = `
var idmlPath = "jobFolder/input.idml";
var pdfPath = "jobFolder/output.pdf";

app.consoleout("Starting IDML to PDF conversion...");

var inputFile = new File(idmlPath);
if (!inputFile.exists) {
  throw new Error("Input IDML not found");
}

// Open IDML
var doc = app.open(inputFile);
app.consoleout("Document opened");

// Export to PDF
var outputFile = new File(pdfPath);
doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
app.consoleout("PDF exported");

// Close document
doc.close(SaveOptions.NO);

// Read PDF file as binary and convert to base64
app.consoleout("Reading PDF file...");
outputFile.encoding = "BINARY";
outputFile.open("r");
var pdfBinary = outputFile.read();
outputFile.close();

app.consoleout("PDF size: " + pdfBinary.length + " bytes");

// Convert to base64 - ExtendScript has built-in btoa
// Actually ExtendScript doesn't have btoa, let's try File.encode
// Or we can use a custom base64 encoder

// Let's just output the first 1000 chars to see if we can access the binary
app.consoleout("PDF_START:" + pdfBinary.substring(0, 500) + ":PDF_END");

app.consoleout("SUCCESS");
`;

  try {
    console.log("\nSending job to RunScript...");

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

    console.log("\n=== Final Job Data ===");
    console.log("Result:", finalData.result);
    console.log("Error:", finalData.error || "none");
    console.log("Log:", finalData.log || "none");
    console.log("Run time:", finalData.runTime, "ms");

  } catch (error: any) {
    console.error("Error:", error.response?.status, error.response?.data || error.message);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
