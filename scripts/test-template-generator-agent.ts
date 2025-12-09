/**
 * Test script for the template generator agent
 * Usage: npx tsx scripts/test-template-generator-agent.ts [path-to-pdf]
 */

// Load environment variables from .env file
import fsSync from "fs";
import path from "path";
const envPath = path.join(process.cwd(), ".env");
if (fsSync.existsSync(envPath)) {
  const envContent = fsSync.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        const value = trimmed.slice(eqIdx + 1);
        process.env[key] = value;
      }
    }
  }
}

import { runTemplateGeneratorAgent } from "../src/lib/agents/template-generator";
import fs from "fs/promises";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

async function pdfToImage(pdfBuffer: Buffer): Promise<string> {
  const tempDir = os.tmpdir();
  const tempId = `pdf_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const pdfPath = path.join(tempDir, `${tempId}.pdf`);
  const pngPathBase = path.join(tempDir, tempId);

  try {
    await fs.writeFile(pdfPath, pdfBuffer);
    await execAsync(`pdftoppm -png -f 1 -l 1 -r 200 "${pdfPath}" "${pngPathBase}"`);
    const pngPath = `${pngPathBase}-1.png`;
    const pngBuffer = await fs.readFile(pngPath);
    const base64 = pngBuffer.toString("base64");

    // Clean up
    await fs.unlink(pdfPath).catch(() => {});
    await fs.unlink(pngPath).catch(() => {});

    return `data:image/png;base64,${base64}`;
  } catch (error) {
    await fs.unlink(pdfPath).catch(() => {});
    throw new Error(`PDF conversion failed: ${error}`);
  }
}

async function main() {
  // Get PDF path from args or use default
  const pdfPath = process.argv[2] || path.join(
    process.cwd(),
    "jobs/732d5585-0d79-4cfe-b75f-ceea8a4e5257/PAR38-13W_Spec_Sheet.pdf"
  );

  console.log("\n" + "=".repeat(80));
  console.log("TEMPLATE GENERATOR AGENT TEST (Agents SDK version)");
  console.log("=".repeat(80));
  console.log(`PDF: ${pdfPath}`);
  console.log(`Reasoning: low`);
  console.log("=".repeat(80) + "\n");

  // Read PDF
  const pdfBuffer = await fs.readFile(pdfPath);
  console.log(`PDF size: ${pdfBuffer.length} bytes`);

  // Convert to screenshot
  console.log("Converting PDF to screenshot...");
  const screenshot = await pdfToImage(pdfBuffer);
  console.log(`Screenshot size: ${screenshot.length} chars`);

  // Track events
  let versionCount = 0;

  // Run generator
  console.log("\nStarting generator agent...\n");
  const startTime = Date.now();

  const result = await runTemplateGeneratorAgent(
    screenshot,
    pdfBuffer,
    path.basename(pdfPath),
    undefined, // no user prompt
    (event) => {
      const prefix = `[${event.type.toUpperCase().padEnd(12)}]`;
      if (event.type === "version") {
        versionCount++;
        console.log(`${prefix} Version ${event.version} rendered`);
      } else if (event.type === "template_json") {
        console.log(`${prefix} Template JSON: ${event.templateJson?.fields.length} fields, ${event.templateJson?.assetSlots.length} assets`);
      } else if (event.type === "tool_call") {
        console.log(`${prefix} ${event.toolName}: ${event.content}`);
      } else if (event.type === "tool_result") {
        const content = event.content.length > 80 ? event.content.substring(0, 80) + "..." : event.content;
        console.log(`${prefix} ${event.toolName}: ${content}`);
      } else if (event.type === "reasoning") {
        const content = event.content.length > 100 ? event.content.substring(0, 100) + "..." : event.content;
        console.log(`${prefix} ${content}`);
      } else {
        console.log(`${prefix} ${event.content}`);
      }
    },
    "low" // reasoning level
  );

  const duration = Date.now() - startTime;

  console.log("\n" + "=".repeat(80));
  console.log("RESULT");
  console.log("=".repeat(80));
  console.log(`Success: ${result.success}`);
  console.log(`Message: ${result.message}`);
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`Versions: ${result.versions?.length || 0}`);

  if (result.templateJson) {
    console.log("\nTemplate JSON:");
    console.log(`  ID: ${result.templateJson.id}`);
    console.log(`  Name: ${result.templateJson.name}`);
    console.log(`  Canvas: ${result.templateJson.canvas.width}x${result.templateJson.canvas.height}`);
    console.log(`  Fields (${result.templateJson.fields.length}):`);
    for (const field of result.templateJson.fields.slice(0, 5)) {
      console.log(`    - ${field.name} (${field.type}): ${field.description}`);
    }
    if (result.templateJson.fields.length > 5) {
      console.log(`    ... and ${result.templateJson.fields.length - 5} more`);
    }
    console.log(`  Assets (${result.templateJson.assetSlots.length}):`);
    for (const asset of result.templateJson.assetSlots) {
      console.log(`    - ${asset.name} (${asset.kind}): ${asset.description}`);
    }
  }

  if (result.templateCode) {
    console.log(`\nTemplate Code: ${result.templateCode.length} chars`);
    console.log("First 500 chars:");
    console.log(result.templateCode.substring(0, 500) + "...");

    // Save output files
    const outputDir = path.join(process.cwd(), ".test-output");
    await fs.mkdir(outputDir, { recursive: true });

    await fs.writeFile(
      path.join(outputDir, "template.tsx"),
      result.templateCode
    );
    console.log(`\nSaved template.tsx to ${outputDir}`);

    if (result.templateJson) {
      await fs.writeFile(
        path.join(outputDir, "template.json"),
        JSON.stringify(result.templateJson, null, 2)
      );
      console.log(`Saved template.json to ${outputDir}`);
    }

    // Save last version preview
    if (result.versions && result.versions.length > 0) {
      const lastVersion = result.versions[result.versions.length - 1];
      const pngData = lastVersion.previewBase64.split(",")[1];
      await fs.writeFile(
        path.join(outputDir, `preview_v${lastVersion.version}.png`),
        Buffer.from(pngData, "base64")
      );
      console.log(`Saved preview_v${lastVersion.version}.png to ${outputDir}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("TEST COMPLETE");
  console.log("=".repeat(80) + "\n");
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
