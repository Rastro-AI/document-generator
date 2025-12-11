/**
 * Test RunScript API directly
 */

import axios from "axios";
import fs from "fs/promises";
import path from "path";

const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

// Simple script that just outputs to console
const SIMPLE_SCRIPT = `
app.consoleout("Hello from InDesign Server!");
app.consoleout("Script arguments defined: " + (app.scriptArgs.isDefined("test") ? "yes" : "no"));
`;

async function main() {
  console.log("=== Testing RunScript API ===\n");

  try {
    // First, let's test with a simple script (no files)
    console.log("1. Testing simple script execution...");

    const simplePayload = {
      script: SIMPLE_SCRIPT,
      args: [{ name: "test", value: "hello" }],
      ids: "2024",
    };

    console.log("Sending request to RunScript API...");
    const response = await axios.post(RUNSCRIPT_API_URL, simplePayload, {
      auth: {
        username: RUNSCRIPT_API_KEY,
        password: RUNSCRIPT_API_SECRET,
      },
    });

    console.log("Job created:", response.data);
    const jobId = response.data._id;

    // Poll for completion
    let attempts = 0;
    let status = "queued";

    while (status !== "complete" && status !== "failed" && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;

      const statusResponse = await axios.get(`${RUNSCRIPT_API_URL}/${jobId}`, {
        auth: {
          username: RUNSCRIPT_API_KEY,
          password: RUNSCRIPT_API_SECRET,
        },
      });

      status = statusResponse.data.status;
      console.log(`Status (attempt ${attempts}): ${status}`);

      if (statusResponse.data.result) {
        console.log("Result:", statusResponse.data.result);
      }
      if (statusResponse.data.log) {
        console.log("Log:", statusResponse.data.log);
      }
      if (statusResponse.data.error) {
        console.log("Error:", statusResponse.data.error);
      }
    }

    console.log("\nFinal job data:");
    const finalResponse = await axios.get(`${RUNSCRIPT_API_URL}/${jobId}`, {
      auth: {
        username: RUNSCRIPT_API_KEY,
        password: RUNSCRIPT_API_SECRET,
      },
    });
    console.log(JSON.stringify(finalResponse.data, null, 2));

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
