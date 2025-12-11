/**
 * Create an IDML template with image placeholder
 * Modifies the sample IDML to use our placeholder syntax for the image link
 */

import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import archiver from "archiver";

const SAMPLE_URL = "https://raw.githubusercontent.com/Starou/SimpleIDML/master/tests/regressiontests/IDML/article-1photo.idml";

async function main() {
  console.log("=== Create IDML Template with Image ===\n");

  const workDir = "/tmp/idml_image_work";
  const extractDir = path.join(workDir, "extracted");
  const samplePath = path.join(workDir, "sample.idml");

  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(extractDir, { recursive: true });

  // Download sample IDML
  console.log("1. Downloading sample IDML...");
  execSync(`curl -sL "${SAMPLE_URL}" -o "${samplePath}"`);

  // Extract
  console.log("2. Extracting...");
  execSync(`unzip -q "${samplePath}" -d "${extractDir}"`);

  // Modify stories with text placeholders
  console.log("3. Modifying stories...");
  const story188Path = path.join(extractDir, "Stories", "Story_u188.xml");
  let story188 = await fs.readFile(story188Path, "utf-8");
  story188 = story188.replace("THE HEADLINE HERE", "{{PRODUCT_NAME}}");
  await fs.writeFile(story188Path, story188);
  console.log("   - Story_u188: headline -> {{PRODUCT_NAME}}");

  const story19fPath = path.join(extractDir, "Stories", "Story_u19f.xml");
  let story19f = await fs.readFile(story19fPath, "utf-8");
  story19f = story19f.replace(/<Content>([^<]*)<\/Content>/, "<Content>{{DESCRIPTION}}</Content>");
  await fs.writeFile(story19fPath, story19f);
  console.log("   - Story_u19f: first content -> {{DESCRIPTION}}");

  // Modify spread to use image placeholder in LinkResourceURI
  console.log("4. Modifying spread for image placeholder...");
  const spreadPath = path.join(extractDir, "Spreads", "Spread_ud6.xml");
  let spread = await fs.readFile(spreadPath, "utf-8");

  // Find the Link element and replace its URI with our placeholder
  // Original: LinkResourceURI="file:/Users/stan/.../default.jpg"
  // New: LinkResourceURI="{{IMAGE:PRODUCT_IMAGE}}"
  spread = spread.replace(
    /LinkResourceURI="[^"]*default\.jpg"/,
    'LinkResourceURI="{{IMAGE:PRODUCT_IMAGE}}"'
  );
  await fs.writeFile(spreadPath, spread);
  console.log("   - Spread: LinkResourceURI -> {{IMAGE:PRODUCT_IMAGE}}");

  // Verify the change
  const spreadCheck = await fs.readFile(spreadPath, "utf-8");
  console.log(`   - Verified: ${spreadCheck.includes("{{IMAGE:PRODUCT_IMAGE}}")}`);

  // Create new IDML
  console.log("\n5. Creating new IDML...");
  const outputPath = path.join(process.cwd(), "templates", "idml-spec-sheet", "template.idml");

  const output = (await import("fs")).createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 0 } });
  archive.pipe(output);

  // Add mimetype first (uncompressed)
  const mimetypeContent = await fs.readFile(path.join(extractDir, "mimetype"));
  archive.append(mimetypeContent, { name: "mimetype", store: true });

  // Add all other files
  const addDir = async (dir: string, prefix: string = "") => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.name === "mimetype") continue;
      if (entry.isDirectory()) {
        await addDir(fullPath, archivePath);
      } else {
        archive.file(fullPath, { name: archivePath });
      }
    }
  };

  await addDir(extractDir);
  await archive.finalize();

  await new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    output.on("error", reject);
  });

  const stats = await fs.stat(outputPath);
  console.log(`\n✓ Created: ${outputPath}`);
  console.log(`  Size: ${stats.size} bytes`);

  // Update template.json with asset slot
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
      { name: "PRODUCT_NAME", type: "text", default: "Product Name", description: "Product name/title" },
      { name: "DESCRIPTION", type: "text", default: "Product description goes here", description: "Product description" },
    ],
    assetSlots: [
      { name: "PRODUCT_IMAGE", description: "Main product image" }
    ],
    fonts: [],
  };
  await fs.writeFile(templateJsonPath, JSON.stringify(templateJson, null, 2));
  console.log(`✓ Updated: ${templateJsonPath}`);

  console.log("\n=== Done ===");
  console.log("Template now supports:");
  console.log("  - {{PRODUCT_NAME}} - text placeholder");
  console.log("  - {{DESCRIPTION}} - text placeholder");
  console.log("  - {{IMAGE:PRODUCT_IMAGE}} - image placeholder");
}

main().catch(console.error);
