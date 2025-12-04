/**
 * Test script for template generator
 * Run with: npx tsx scripts/test-template-generator.ts
 */

import fs from "fs/promises";
import path from "path";
import { pdf } from "pdf-to-img";

async function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  try {
    const envContent = await fs.readFile(envPath, "utf8");
    for (const line of envContent.split("\n")) {
      const [key, ...valueParts] = line.split("=");
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    }
  } catch {
    console.log("No .env found, using environment variables");
  }
}

async function pdfToImage(pdfPath: string): Promise<string> {
  const pdfBuffer = await fs.readFile(pdfPath);
  const document = await pdf(pdfBuffer, { scale: 2 });

  // Get first page as PNG
  for await (const image of document) {
    const base64 = image.toString("base64");
    return `data:image/png;base64,${base64}`;
  }

  throw new Error("PDF has no pages");
}

async function main() {
  await loadEnv();

  const { runTemplateGenerator } = await import("../src/lib/agents/template-generator");

  // Use an existing PDF from jobs
  const pdfPath = path.join(
    process.cwd(),
    "jobs/732d5585-0d79-4cfe-b75f-ceea8a4e5257/PAR38-13W_Spec_Sheet.pdf"
  );

  console.log("Loading PDF from:", pdfPath);

  // Check if file exists
  try {
    await fs.access(pdfPath);
  } catch {
    console.error("PDF file not found at:", pdfPath);
    process.exit(1);
  }

  // Convert PDF to image
  console.log("Converting PDF to image...");
  const imageBase64 = await pdfToImage(pdfPath);
  console.log("Image converted, size:", (imageBase64.length / 1024).toFixed(1), "KB");
  console.log("Starting template generation...\n");

  // Run the generator with event logging
  const result = await runTemplateGenerator(
    imageBase64,
    "PAR38-13W_Spec_Sheet.pdf",
    (event) => {
      if (event.type === "status") {
        console.log("[STATUS]", event.content);
      } else if (event.type === "tool_call") {
        console.log("[TOOL]", event.toolName);
      } else if (event.type === "reasoning") {
        console.log("[THINKING]", event.content.substring(0, 100) + "...");
      }
    }
  );

  console.log("\n=== RESULT ===");
  console.log("Success:", result.success);
  console.log("Message:", result.message);

  if (result.templateJson) {
    console.log("\n=== TEMPLATE JSON ===");
    console.log(JSON.stringify(result.templateJson, null, 2));
  }

  if (result.templateCode) {
    console.log("\n=== TEMPLATE CODE (first 1000 chars) ===");
    console.log(result.templateCode.substring(0, 1000) + "...");
  }

  if (result.timingLogPath) {
    console.log("\nTiming log saved to:", result.timingLogPath);
  }
}

main().catch(console.error);
