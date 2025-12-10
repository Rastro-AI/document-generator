/**
 * Test script for the template generator agent (Form-Fill version)
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
  console.log("TEMPLATE GENERATOR AGENT TEST (Form-Fill version)");
  console.log("=".repeat(80));
  console.log(`PDF: ${pdfPath}`);
  console.log(`Reasoning: none`);
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
      const prefix = `[${event.type.toUpperCase().padEnd(14)}]`;
      if (event.type === "version") {
        versionCount++;
        console.log(`${prefix} Version ${event.version} rendered`);
      } else if (event.type === "schema_updated") {
        const fieldCount = event.schema?.pages.reduce((sum, p) => sum + p.fields.length, 0) || 0;
        console.log(`${prefix} Schema updated: ${fieldCount} fields`);
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
    "none" // reasoning level - use "low" or "high" for more detailed output
  );

  const duration = Date.now() - startTime;

  console.log("\n" + "=".repeat(80));
  console.log("RESULT");
  console.log("=".repeat(80));
  console.log(`Success: ${result.success}`);
  console.log(`Message: ${result.message}`);
  console.log(`Duration: ${(duration / 1000).toFixed(1)}s`);
  console.log(`Versions: ${result.versions?.length || 0}`);

  if (result.schema) {
    console.log("\nSchema:");
    console.log(`  Version: ${result.schema.version}`);
    console.log(`  Pages: ${result.schema.pages.length}`);
    for (const page of result.schema.pages) {
      console.log(`  Page ${page.pageNumber}: ${page.fields.length} fields`);
      for (const field of page.fields.slice(0, 5)) {
        console.log(`    - ${field.name} (${field.type}) @ (${field.bbox.x}, ${field.bbox.y})`);
      }
      if (page.fields.length > 5) {
        console.log(`    ... and ${page.fields.length - 5} more`);
      }
    }
  }

  // Save output files
  const outputDir = path.join(process.cwd(), ".test-output");
  await fs.mkdir(outputDir, { recursive: true });

  if (result.schema) {
    await fs.writeFile(
      path.join(outputDir, "schema.json"),
      JSON.stringify(result.schema, null, 2)
    );
    console.log(`\nSaved schema.json to ${outputDir}`);
  }

  if (result.basePdfBuffer) {
    await fs.writeFile(
      path.join(outputDir, "base.pdf"),
      result.basePdfBuffer
    );
    console.log(`Saved base.pdf to ${outputDir}`);
  }

  if (result.originalPdfBuffer) {
    await fs.writeFile(
      path.join(outputDir, "original.pdf"),
      result.originalPdfBuffer
    );
    console.log(`Saved original.pdf to ${outputDir}`);
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

  console.log("\n" + "=".repeat(80));
  console.log("TEST COMPLETE");
  console.log("=".repeat(80) + "\n");
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
