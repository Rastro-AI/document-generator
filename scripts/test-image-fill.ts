import path from "path";
import fs from "fs/promises";
import { fillPdfTemplate, FormTemplateSchema } from "../src/lib/pdf-filler";

async function main() {
  const templatePath = path.join(process.cwd(), "templates/generated-template/base.pdf");
  const schemaPath = path.join(process.cwd(), "templates/generated-template/schema.json");
  const templateRoot = path.join(process.cwd(), "templates/generated-template");

  const schemaContent = await fs.readFile(schemaPath, "utf-8");
  const schema: FormTemplateSchema = JSON.parse(schemaContent);

  // Use a sample image for testing
  const imagePath = "/Users/baptistecumin/github/document-generator/jobs/8db92587-e9f3-4bab-ba13-13134453b92c/assets/energy-star-logo.png";
  const imageBuffer = await fs.readFile(imagePath);
  const imageBase64 = "data:image/png;base64," + imageBuffer.toString("base64");

  const fields: Record<string, string> = {
    PRODUCT_TITLE: "Test Product with Image",
    VOLTAGE_VALUE: "120V",
    WATTAGE_VALUE: "15W",
  };

  const assets: Record<string, string | null> = {
    PRODUCT_HERO_IMAGE: imageBase64,
    SPECTRUM_DISTRIBUTION_CHART_IMAGE: null,
    CHROMATICITY_DIAGRAM_IMAGE: null,
  };

  console.log("Filling PDF with image...");
  const result = await fillPdfTemplate(templatePath, schema, {
    fields,
    assets,
    templateRoot,
  });

  if (result.success && result.pdfBuffer) {
    const outputDir = "/Users/baptistecumin/github/document-generator/.test-output";
    await fs.mkdir(outputDir, { recursive: true });

    await fs.writeFile(path.join(outputDir, "with-image.pdf"), result.pdfBuffer);

    if (result.pngBase64) {
      const pngData = result.pngBase64.split(",")[1];
      await fs.writeFile(path.join(outputDir, "with-image.png"), Buffer.from(pngData, "base64"));
    }
    console.log("Success! Check .test-output/with-image.png");
  } else {
    console.error("Failed:", result.error);
  }
}

main().catch(console.error);
