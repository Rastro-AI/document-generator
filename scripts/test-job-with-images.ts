/**
 * Test job creation with image assignment
 * Simulates uploading files via the /api/jobs/stream endpoint
 */

import FormData from "form-data";
import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

const BASE_URL = "http://localhost:3000";

async function createJobWithImages() {
  // Find a PDF and some images to upload
  const jobsDir = "/Users/baptistecumin/github/document-generator/jobs";
  const jobs = fs.readdirSync(jobsDir);

  // Find an existing job with assets
  let pdfPath: string | null = null;
  let imagePaths: string[] = [];

  for (const jobId of jobs) {
    const jobDir = path.join(jobsDir, jobId);
    const stat = fs.statSync(jobDir);
    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(jobDir);

    // Find a PDF
    const pdf = files.find(f => f.endsWith('.pdf') && f !== 'output.pdf');
    if (pdf && !pdfPath) {
      pdfPath = path.join(jobDir, pdf);
    }

    // Find images in assets folder
    const assetsDir = path.join(jobDir, "assets");
    if (fs.existsSync(assetsDir)) {
      const assetFiles = fs.readdirSync(assetsDir);
      for (const af of assetFiles) {
        if (/\.(png|jpg|jpeg|webp)$/i.test(af)) {
          imagePaths.push(path.join(assetsDir, af));
          if (imagePaths.length >= 3) break; // Limit to 3 images
        }
      }
    }

    if (pdfPath && imagePaths.length >= 2) break;
  }

  if (!pdfPath) {
    console.error("No PDF found in jobs directory");
    return;
  }

  console.log("Using PDF:", pdfPath);
  console.log("Using images:", imagePaths);

  // Create form data
  const form = new FormData();
  form.append("templateId", "sunco-spec-v1");
  form.append("files", fs.createReadStream(pdfPath));

  for (const imgPath of imagePaths) {
    form.append("files", fs.createReadStream(imgPath));
  }

  console.log("\nCreating job via /api/jobs/stream...");

  // Make the request
  const response = await fetch(`${BASE_URL}/api/jobs/stream`, {
    method: "POST",
    body: form as unknown as BodyInit,
    headers: form.getHeaders(),
  });

  if (!response.ok) {
    console.error("Request failed:", response.status, await response.text());
    return;
  }

  // Read SSE stream
  const reader = response.body?.getReader();
  if (!reader) {
    console.error("No response body");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let jobId: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        const eventType = line.slice(7).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        const data = JSON.parse(line.slice(5).trim());

        if (data.type === "status") {
          console.log("Status:", data.content);
        } else if (data.jobId) {
          jobId = data.jobId;
          console.log("\nJob created:", jobId);
          console.log("Assets:", JSON.stringify(data.job?.assets, null, 2));
        }
      }
    }
  }

  if (jobId) {
    // Read the job file to verify
    const jobPath = path.join(jobsDir, jobId, "job.json");
    if (fs.existsSync(jobPath)) {
      const job = JSON.parse(fs.readFileSync(jobPath, "utf-8"));
      console.log("\n=== JOB ASSETS ===");
      console.log(JSON.stringify(job.assets, null, 2));

      const assignedAssets = Object.entries(job.assets).filter(([, v]) => v !== null);
      if (assignedAssets.length > 0) {
        console.log(`\n✓ ${assignedAssets.length} assets were assigned!`);
      } else {
        console.log("\n✗ No assets were assigned");
      }
    }
  }
}

createJobWithImages().catch(console.error);
