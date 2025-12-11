/**
 * Create a valid IDML template by modifying a real IDML file
 * Downloads sample IDML, modifies stories to have placeholders, creates new IDML
 */

import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import archiver from "archiver";

const SAMPLE_URL = "https://raw.githubusercontent.com/Starou/SimpleIDML/master/tests/regressiontests/IDML/article-1photo.idml";

async function main() {
  console.log("=== Create Valid IDML Template ===\n");

  const workDir = "/tmp/idml_work";
  const extractDir = path.join(workDir, "extracted");
  const samplePath = path.join(workDir, "sample.idml");

  // Clean and create work directory
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });

  // Download sample IDML
  console.log("1. Downloading sample IDML...");
  execSync(`curl -sL "${SAMPLE_URL}" -o "${samplePath}"`);

  // Extract
  console.log("2. Extracting...");
  execSync(`unzip -q "${samplePath}" -d "${extractDir}"`);

  // Modify stories to add placeholders
  console.log("3. Modifying stories with placeholders...");

  // Story_u188.xml - headline -> {{PRODUCT_NAME}}
  const story188Path = path.join(extractDir, "Stories", "Story_u188.xml");
  let story188 = await fs.readFile(story188Path, "utf-8");
  story188 = story188.replace("THE HEADLINE HERE", "{{PRODUCT_NAME}}");
  await fs.writeFile(story188Path, story188);
  console.log("   - Story_u188: headline -> {{PRODUCT_NAME}}");

  // Story_u19f.xml - main text
  const story19fPath = path.join(extractDir, "Stories", "Story_u19f.xml");
  let story19f = await fs.readFile(story19fPath, "utf-8");
  // This story contains a bunch of "simplidml" text - replace first occurrence with placeholder
  story19f = story19f.replace(/<Content>([^<]*)<\/Content>/, "<Content>{{DESCRIPTION}}</Content>");
  await fs.writeFile(story19fPath, story19f);
  console.log("   - Story_u19f: first content -> {{DESCRIPTION}}");

  // Create new IDML (zip with specific structure)
  console.log("\n4. Creating new IDML...");
  const outputPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Create zip archive
  const output = (await import("fs")).createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 0 } }); // No compression for IDML

  archive.pipe(output);

  // IMPORTANT: mimetype must be first and uncompressed
  const mimetypeContent = await fs.readFile(path.join(extractDir, "mimetype"));
  archive.append(mimetypeContent, { name: "mimetype", store: true });

  // Add all other files
  const addDir = async (dir: string, prefix: string = "") => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.name === "mimetype") continue; // Already added

      if (entry.isDirectory()) {
        await addDir(fullPath, archivePath);
      } else {
        archive.file(fullPath, { name: archivePath });
      }
    }
  };

  await addDir(extractDir);
  await archive.finalize();

  // Wait for file to be written
  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });

  const stats = await fs.stat(outputPath);
  console.log(`\n✓ Created: ${outputPath}`);
  console.log(`  Size: ${stats.size} bytes`);

  // Update template.json
  const templateJsonPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.json");
  const templateJson = {
    id: "idml-spec-sheet",
    name: "IDML Spec Sheet",
    format: "idml",
    canvas: {
      width: 612,
      height: 792,
    },
    fields: [
      { name: "PRODUCT_NAME", type: "text", default: "Product Name" },
      { name: "DESCRIPTION", type: "text", default: "Product description goes here" },
    ],
    assetSlots: [],
    fonts: [],
  };
  await fs.writeFile(templateJsonPath, JSON.stringify(templateJson, null, 2));
  console.log(`✓ Updated: ${templateJsonPath}`);

  // Verify the new IDML
  console.log("\n5. Verifying new IDML...");
  const verifyDir = path.join(workDir, "verify");
  await fs.mkdir(verifyDir, { recursive: true });
  try {
    execSync(`unzip -q "${outputPath}" -d "${verifyDir}"`);
    const files = execSync(`find "${verifyDir}" -type f | wc -l`).toString().trim();
    console.log(`   Files in archive: ${files}`);

    // Check mimetype
    const mimetype = await fs.readFile(path.join(verifyDir, "mimetype"), "utf-8");
    console.log(`   Mimetype: ${mimetype.trim()}`);

    // Check our placeholders are there
    const story188Check = await fs.readFile(path.join(verifyDir, "Stories", "Story_u188.xml"), "utf-8");
    console.log(`   {{PRODUCT_NAME}} in Story_u188: ${story188Check.includes("{{PRODUCT_NAME}}")}`);

    const story19fCheck = await fs.readFile(path.join(verifyDir, "Stories", "Story_u19f.xml"), "utf-8");
    console.log(`   {{DESCRIPTION}} in Story_u19f: ${story19fCheck.includes("{{DESCRIPTION}}")}`);

  } catch (e: any) {
    console.log("   Verification failed:", e.message);
  }

  console.log("\n=== Done ===");
}

main().catch(console.error);
