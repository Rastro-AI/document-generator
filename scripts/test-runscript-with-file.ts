/**
 * Test RunScript API with file upload via file.io
 */

import axios from "axios";
import FormData from "form-data";
import { createReadStream } from "fs";
import path from "path";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

async function uploadToTempHost(filePath: string): Promise<string> {
  console.log(`Uploading ${filePath} to 0x0.st...`);
  const form = new FormData();
  form.append("file", createReadStream(filePath));

  const response = await axios.post("https://0x0.st", form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  console.log("0x0.st response:", response.data);

  const url = response.data.trim();
  if (!url.startsWith("http")) {
    throw new Error(`File upload failed: ${response.data}`);
  }

  return url;
}

async function main() {
  console.log("=== Testing RunScript API with File Upload ===\n");

  const idmlPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");

  try {
    // 1. Upload IDML to file.io
    console.log("1. Uploading IDML file...");
    const inputUrl = await uploadToTempHost(idmlPath);
    console.log(`Uploaded to: ${inputUrl}\n`);

    // 2. Create RunScript job
    console.log("2. Creating RunScript job...");

    const script = `
var idmlPath = "jobFolder/input.idml";

// Try to open the IDML file
var inputFile = new File(idmlPath);
app.consoleout("Looking for: " + idmlPath);
app.consoleout("File exists: " + inputFile.exists);

if (!inputFile.exists) {
  // List files in jobFolder
  var folder = new Folder("jobFolder");
  if (folder.exists) {
    var files = folder.getFiles();
    app.consoleout("Files in jobFolder:");
    for (var i = 0; i < files.length; i++) {
      app.consoleout("  - " + files[i].name);
    }
  } else {
    app.consoleout("jobFolder does not exist");
  }
  throw new Error("Input file not found");
}

var doc = app.open(inputFile);
app.consoleout("Document opened: " + doc.name);

// Export to PDF
var pdfPath = "jobFolder/output.pdf";
var outputFile = new File(pdfPath);

doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
app.consoleout("PDF exported to: " + pdfPath);

// Close without saving
doc.close(SaveOptions.NO);
app.consoleout("SUCCESS");
`;

    const payload = {
      inputs: [{ href: inputUrl, path: "jobFolder/input.idml" }],
      outputs: [],
      script: script,
      ids: "2024",
    };

    console.log("Sending request...");
    const response = await axios.post(RUNSCRIPT_API_URL, payload, {
      auth: {
        username: RUNSCRIPT_API_KEY,
        password: RUNSCRIPT_API_SECRET,
      },
    });

    console.log("Job created:", response.data._id);

    // 3. Poll for completion
    console.log("\n3. Polling for completion...");
    const jobId = response.data._id;
    let status = "queued";
    let attempts = 0;

    while (status !== "complete" && status !== "failed" && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      attempts++;

      const statusResponse = await axios.get(`${RUNSCRIPT_API_URL}/${jobId}`, {
        auth: {
          username: RUNSCRIPT_API_KEY,
          password: RUNSCRIPT_API_SECRET,
        },
      });

      status = statusResponse.data.status;
      console.log(`Attempt ${attempts}: ${status}`);

      if (status === "complete" || status === "failed") {
        console.log("\nFinal job data:");
        console.log(JSON.stringify(statusResponse.data, null, 2));
      }
    }

  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("API Error:", error.response?.status, error.response?.data);
    } else {
      console.error("Error:", error);
    }
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
