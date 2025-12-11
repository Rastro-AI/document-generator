/**
 * Test the editor flow:
 * 1. Create job with IDML template
 * 2. Send chat message to update fields
 * 3. Trigger render
 * 4. Verify PDF output
 */

import fs from "fs/promises";
import path from "path";

const BASE_URL = "http://localhost:3000";

async function main() {
  console.log("=== Test Editor Flow (IDML) ===\n");

  // 1. Create job
  console.log("1. Creating job...");
  const jobId = `editor-test-${Date.now()}`;
  const jobDir = path.join(process.cwd(), "jobs", jobId);
  await fs.mkdir(jobDir, { recursive: true });

  const jobData = {
    id: jobId,
    name: "Editor Test Job",
    templateId: "idml-spec-sheet",
    fields: {
      PRODUCT_NAME: "Original Product Name",
      DESCRIPTION: "Original description text.",
    },
    assets: {},
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(jobDir, "job.json"), JSON.stringify(jobData, null, 2));
  console.log(`   Job created: ${jobId}`);

  // 2. Initial render
  console.log("\n2. Initial render...");
  const renderRes1 = await fetch(`${BASE_URL}/api/jobs/${jobId}/render`, { method: "POST" });
  const render1 = await renderRes1.json();
  console.log(`   Render result: ${render1.ok ? "success" : render1.error}`);

  // Check PDF exists
  const pdf1Path = path.join(jobDir, "output.pdf");
  const pdf1Stats = await fs.stat(pdf1Path);
  console.log(`   Initial PDF size: ${pdf1Stats.size} bytes`);

  // 3. Send chat message to edit
  console.log("\n3. Sending chat message to edit...");
  const chatRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Change the product name to 'Super LED Panel X9000' and update the description to 'Revolutionary lighting technology with 120lm/W efficiency'",
      mode: "auto",
    }),
  });

  // Read SSE stream
  const reader = chatRes.body?.getReader();
  const decoder = new TextDecoder();
  let chatResult: any = null;

  if (reader) {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: result")) {
          // Next line is data
          continue;
        }
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.success !== undefined) {
              chatResult = data;
            }
            if (data.type === "trace") {
              console.log(`   Trace: ${data.content.type} - ${data.content.content?.substring(0, 50)}...`);
            }
          } catch {}
        }
      }
    }
  }

  console.log(`   Chat result: ${chatResult?.success ? "success" : "failed"}`);
  if (chatResult?.fields) {
    console.log(`   Updated fields:`, chatResult.fields);
  }

  // 4. Apply field updates to job
  if (chatResult?.fields) {
    console.log("\n4. Applying field updates...");
    const updateRes = await fetch(`${BASE_URL}/api/jobs/${jobId}/fields`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: chatResult.fields }),
    });
    const updateText = await updateRes.text();
    console.log(`   Update result: ${updateRes.ok ? "success" : updateText}`);
  }

  // 5. Re-render with updated fields
  console.log("\n5. Re-rendering with updated fields...");
  const renderRes2 = await fetch(`${BASE_URL}/api/jobs/${jobId}/render`, { method: "POST" });
  const render2 = await renderRes2.json();
  console.log(`   Render result: ${render2.ok ? "success" : render2.error}`);

  const pdf2Stats = await fs.stat(pdf1Path);
  console.log(`   Updated PDF size: ${pdf2Stats.size} bytes`);

  // 6. Convert to image and check
  console.log("\n6. Converting to image...");
  const { execSync } = await import("child_process");
  const imgPath = path.join(process.cwd(), ".test-output", `editor-test-${Date.now()}.png`);
  await fs.mkdir(path.dirname(imgPath), { recursive: true });
  execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${pdf1Path}" "${imgPath.replace('.png', '')}"`);

  const finalImg = imgPath.replace('.png', '-1.png');
  try {
    const imgStats = await fs.stat(finalImg);
    console.log(`   Image created: ${imgStats.size} bytes`);
    console.log(`   Path: ${finalImg}`);
  } catch {
    console.log(`   Image path: ${imgPath}`);
  }

  console.log("\n=== Editor Flow Test Complete ===");
  console.log(`Job ID: ${jobId}`);
  console.log(`Check PDF at: ${pdf1Path}`);
}

main().catch(console.error);
