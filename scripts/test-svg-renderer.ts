/**
 * Test script for SVG template renderer
 *
 * Run with: npx ts-node scripts/test-svg-renderer.ts
 */

import fs from "fs/promises";
import path from "path";
import { renderSVGTemplate, renderSVG, extractPlaceholders, parseSVGDimensions } from "../src/lib/svg-template-renderer";

async function main() {
  console.log("=== SVG Template Renderer Test ===\n");

  // 1. Read the sample SVG template
  const templatePath = path.join(process.cwd(), "templates", "svg-spec-sheet", "template.svg");
  console.log("Loading template from:", templatePath);
  const svgTemplate = await fs.readFile(templatePath, "utf-8");
  console.log("Template loaded, length:", svgTemplate.length, "chars\n");

  // 2. Parse dimensions
  const dimensions = parseSVGDimensions(svgTemplate);
  console.log("Parsed dimensions:", dimensions);

  // 3. Extract placeholders
  const placeholders = extractPlaceholders(svgTemplate);
  console.log("Found placeholders:", placeholders);
  console.log();

  // 4. Test rendering with sample data
  const testFields = {
    PRODUCT_NAME: "LED Downlight Pro",
    PRODUCT_DESCRIPTION: "High-efficiency LED downlight with superior color rendering. Perfect for residential and commercial applications. Features adjustable color temperature and dimming capabilities.",
    MODEL_NUMBER: "DL-PRO-5000K-15W",
    WATTAGE: "15W",
    LUMENS: "1200 lm",
    COLOR_TEMP: "5000K",
    CRI: "95+",
    BEAM_ANGLE: "120°",
    VOLTAGE: "120-277V AC",
    LIFETIME: "50,000 hrs",
    WARRANTY: "7 Years",
    DIMMABLE: "Yes (0-100%)",
  };

  const testAssets = {
    PRODUCT_IMAGE: null, // No image for test
    COMPANY_LOGO: null,
  };

  console.log("Rendering SVG with test data...");
  const renderedSvg = renderSVGTemplate(svgTemplate, testFields, testAssets);
  console.log("Rendered SVG length:", renderedSvg.length, "chars");

  // Save rendered SVG
  const outputDir = path.join(process.cwd(), ".test-output");
  await fs.mkdir(outputDir, { recursive: true });

  const svgOutputPath = path.join(outputDir, "svg-template-test.svg");
  await fs.writeFile(svgOutputPath, renderedSvg);
  console.log("Rendered SVG saved to:", svgOutputPath);

  // 5. Test full render pipeline (SVG -> PDF)
  console.log("\n--- Testing full render pipeline ---");
  try {
    const result = await renderSVG(svgTemplate, {
      fields: testFields,
      assets: testAssets,
      outputFormat: "all",
    });

    if (result.success) {
      console.log("Full render succeeded!");
      console.log("- SVG length:", result.svg?.length, "chars");
      console.log("- PDF buffer:", result.pdfBuffer?.length, "bytes");
      console.log("- PNG base64:", result.pngBase64?.length, "chars");

      if (result.pdfBuffer) {
        const pdfOutputPath = path.join(outputDir, "svg-template-test.pdf");
        await fs.writeFile(pdfOutputPath, result.pdfBuffer);
        console.log("PDF saved to:", pdfOutputPath);
      }

      if (result.pngBase64) {
        // Extract base64 and save as PNG
        const base64Data = result.pngBase64.replace(/^data:image\/png;base64,/, "");
        const pngOutputPath = path.join(outputDir, "svg-template-test.png");
        await fs.writeFile(pngOutputPath, Buffer.from(base64Data, "base64"));
        console.log("PNG saved to:", pngOutputPath);
      }
    } else {
      console.log("Full render failed:", result.error);
    }
  } catch (error) {
    console.log("Full render pipeline error:", error);
    console.log("Note: PDF/PNG conversion requires inkscape, rsvg-convert, or cairosvg to be installed");
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
