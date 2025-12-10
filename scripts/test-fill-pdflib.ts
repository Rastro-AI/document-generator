/**
 * Test the pdf-lib based PDF filler
 */

import path from "path";
import fs from "fs/promises";
import { fillPdfTemplate, FormTemplateSchema } from "../src/lib/pdf-filler";

async function main() {
  const templatePath = path.join(process.cwd(), "templates/generated-template/base.pdf");
  const schemaPath = path.join(process.cwd(), "templates/generated-template/schema.json");
  const templateRoot = path.join(process.cwd(), "templates/generated-template");

  console.log("Testing pdf-lib PDF filler...");
  console.log(`Template: ${templatePath}`);
  console.log(`Schema: ${schemaPath}`);

  // Load schema
  const schemaContent = await fs.readFile(schemaPath, "utf-8");
  const schema: FormTemplateSchema = JSON.parse(schemaContent);
  console.log(`Schema has ${schema.pages[0].fields.length} fields`);

  // Sample fill data
  const fields: Record<string, string> = {
    PRODUCT_TITLE: "TEST PRODUCT 123",
    PRODUCT_DESCRIPTION: "This is a test description.",
    MODEL_LIST: "MODEL-A, MODEL-B",
    VOLTAGE_VALUE: "120V",
    WATTAGE_VALUE: "15W",
    CURRENT_VALUE: "0.125A",
    POWER_FACTOR_VALUE: "0.9",
    LUMENS_VALUE: "1200 lm",
    EQUIVALENCY_VALUE: "100W",
    COLOR_TEMPERATURE_RANGE: "2700K-5000K",
    CRI_VALUE: "90+",
    BEAM_ANGLE_VALUE: "120deg",
    DIMMABLE_VALUE: "Yes",
    EFFICIENCY_LM_PER_W_VALUE: "80",
    FREQUENCY_VALUE: "60Hz",
    OPERATING_TEMPERATURE_RANGE: "-20F to 120F",
    SUITABLE_FOR_DAMP_LOCATIONS_VALUE: "Yes",
    HOUSING_MATERIAL: "Aluminum",
    WEIGHT_VALUE: "0.5 lbs",
    AVERAGE_LIFE_HOURS: "50000 hrs",
    WARRANTY_YEARS: "5 Years",
    SWITCHING_TIME_VALUE: "50000+",
    UL_FILE_NUMBER: "E123456",
    ENERGY_STAR_FOOTNOTE: "Energy Star Certified",
    DIMENSION_CALLOUTS: "6.5in x 4.2in",
  };

  const assets: Record<string, string | null> = {
    PRODUCT_HERO_IMAGE: null,
    SPECTRUM_DISTRIBUTION_CHART_IMAGE: null,
    CHROMATICITY_DIAGRAM_IMAGE: null,
  };

  console.log(`\nFilling with ${Object.keys(fields).length} fields...`);

  const result = await fillPdfTemplate(templatePath, schema, {
    fields,
    assets,
    templateRoot,
  });

  if (result.success) {
    console.log("\n SUCCESS!");

    // Save outputs
    const outputDir = path.join(process.cwd(), ".test-output");
    await fs.mkdir(outputDir, { recursive: true });

    if (result.pdfBuffer) {
      const pdfPath = path.join(outputDir, "filled-pdflib.pdf");
      await fs.writeFile(pdfPath, result.pdfBuffer);
      console.log(`  Saved: ${pdfPath}`);
    }

    if (result.pngBase64) {
      const pngData = result.pngBase64.split(",")[1];
      const pngPath = path.join(outputDir, "filled-pdflib.png");
      await fs.writeFile(pngPath, Buffer.from(pngData, "base64"));
      console.log(`  Saved: ${pngPath}`);
    }
  } else {
    console.error("\n FAILED:", result.error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
