/**
 * Test RunScript API to see what URL types it accepts
 * Testing: public URLs, data URLs, different cloud storage
 */

import axios from "axios";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

async function testUrlType(name: string, inputHref: string) {
  console.log(`\n=== Testing: ${name} ===`);
  console.log(`URL: ${inputHref.substring(0, 100)}...`);

  const script = `
var inputFile = new File("jobFolder/test.txt");
app.consoleout("File exists: " + inputFile.exists);
if (inputFile.exists) {
  inputFile.open("r");
  var content = inputFile.read();
  inputFile.close();
  app.consoleout("Content: " + content.substring(0, 100));
}
`;

  try {
    const response = await axios.post(RUNSCRIPT_API_URL, {
      inputs: [{ href: inputHref, path: "jobFolder/test.txt" }],
      outputs: [],
      script: script,
      ids: "2024",
    }, {
      auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
    });

    console.log("Job created:", response.data._id);

    // Poll for result
    const jobId = response.data._id;
    let status = "queued";
    let attempts = 0;

    while (status !== "complete" && status !== "failed" && attempts < 20) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;

      const statusRes = await axios.get(`${RUNSCRIPT_API_URL}/${jobId}`, {
        auth: { username: RUNSCRIPT_API_KEY, password: RUNSCRIPT_API_SECRET },
      });

      status = statusRes.data.status;
      console.log(`Status: ${status}`);

      if (status === "complete" || status === "failed") {
        console.log("Result:", statusRes.data.result);
        if (statusRes.data.log) {
          console.log("Log:", statusRes.data.log);
        }
        if (statusRes.data.error) {
          console.log("Error:", statusRes.data.error);
        }
      }
    }
  } catch (error: any) {
    console.log("Error:", error.response?.status, error.response?.data || error.message);
  }
}

async function main() {
  console.log("=== RunScript URL Type Testing ===");

  // Test 1: Public GitHub raw URL
  await testUrlType(
    "GitHub Raw URL (public)",
    "https://raw.githubusercontent.com/typefi/run-script-examples/main/README.md"
  );

  // Test 2: Data URL (base64)
  const testContent = "Hello from base64!";
  const base64 = Buffer.from(testContent).toString("base64");
  await testUrlType(
    "Data URL (base64)",
    `data:text/plain;base64,${base64}`
  );

  // Test 3: HTTPS URL from a different service (httpbin)
  await testUrlType(
    "HTTPBin public URL",
    "https://httpbin.org/robots.txt"
  );

  console.log("\n=== Testing Complete ===");
}

main().catch(console.error);
