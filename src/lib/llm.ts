import OpenAI from "openai";
import { Template } from "./types";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";

export type ExtractionEventCallback = (event: { type: string; content: string }) => void;

// Lazy-load the OpenAI client to avoid build-time errors
let openaiClient: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

// Convert .xlsm to .xlsx (removes macros which may cause issues)
function convertXlsmToXlsx(xlsmPath: string): string {
  const buffer = fs.readFileSync(xlsmPath);
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const xlsxPath = xlsmPath.replace(/\.xlsm$/i, ".xlsx");
  const xlsxBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  fs.writeFileSync(xlsxPath, xlsxBuffer);
  return xlsxPath;
}

// Extract fields from file using gpt-5.1 with container upload
export async function extractFieldsFromFile(
  template: Template,
  filePath: string,
  userPrompt?: string
): Promise<Record<string, unknown>> {
  const fieldDescriptions = template.fields
    .map((f) => `- ${f.name} (${f.type}): ${f.description}`)
    .join("\n");

  let actualFilePath = filePath;
  const ext = path.extname(filePath).toLowerCase();

  // Convert .xlsm to .xlsx first (removes macros)
  if (ext === ".xlsm") {
    console.log("Converting .xlsm to .xlsx...");
    actualFilePath = convertXlsmToXlsx(filePath);
  }

  const openai = getOpenAI();

  try {
    // 1. Create a container
    console.log("Creating container...");
    const container = await openai.containers.create({
      name: `extract-${Date.now()}`,
    });
    console.log("Container created:", container.id);

    // 2. Upload file to container
    console.log("Uploading file to container...");
    const fileStream = fs.createReadStream(actualFilePath);

    const containerFile = await openai.containers.files.create(container.id, {
      file: fileStream,
    });
    console.log("File uploaded:", containerFile.id);

    // 3. Create response with container and code_interpreter tool
    const fileName = path.basename(actualFilePath);
    const userInstructions = userPrompt
      ? `\n\nUSER INSTRUCTIONS:\n${userPrompt}\n`
      : "";
    const prompt = `You have access to an Excel file called "${fileName}" in your container.

Use code_interpreter to thoroughly read and extract data from this product specification sheet.
${userInstructions}
FIELDS TO EXTRACT:
${fieldDescriptions}

EXTRACTION INSTRUCTIONS:
1. Use pandas to read ALL sheets in the Excel file
2. Print out the contents of each sheet to understand the data structure
3. Look for spec tables with labels like "Voltage", "Wattage", "Lumens", "CRI", etc.
4. The data may be in key-value pairs across rows or columns
5. Search for variations like "Input Voltage", "Operating Voltage" for VOLTAGE
6. Look for "Beam Angle", "Beam Width" for BEAM_ANGLE
7. Color temp may be listed as "CCT" or multiple values like "2700K/3000K/4000K"

OUTPUT:
Return ONLY a valid JSON object with all extracted values. Use null for fields truly not found.
No explanation text, just the JSON.

Example: {"PRODUCT_NAME": "LED Bulb", "WATTAGE": "13W", "LUMENS": "1050", "CRI": "80"}`;

    console.log("Calling gpt-5.1 with container...");
    const response = await openai.responses.create({
      model: "gpt-5.1",
      reasoning: { effort: "none" },
      input: prompt,
      tools: [
        {
          type: "code_interpreter",
          container: container.id,
        },
      ],
    });

    // 4. Clean up container
    try {
      await openai.containers.delete(container.id);
      console.log("Container deleted");
    } catch (e) {
      console.warn("Failed to delete container:", e);
    }

    // Clean up converted file if we created one
    if (actualFilePath !== filePath && fs.existsSync(actualFilePath)) {
      fs.unlinkSync(actualFilePath);
    }

    const responseText = response.output_text;
    console.log("Response:", responseText);
    return parseExtractedFields(template, responseText);
  } catch (e) {
    console.error("Failed to extract fields:", e);

    // Clean up converted file on error
    if (actualFilePath !== filePath && fs.existsSync(actualFilePath)) {
      fs.unlinkSync(actualFilePath);
    }

    return createEmptyFields(template);
  }
}

function createEmptyFields(
  template: Template
): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {};
  for (const field of template.fields) {
    result[field.name] = null;
  }
  return result;
}

function parseExtractedFields(
  template: Template,
  responseText: string
): Record<string, string | number | null> {
  // Clean up the response - remove markdown code blocks if present
  let cleanedContent = responseText.trim();

  // Try to extract JSON from the response
  const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleanedContent = jsonMatch[0];
  }

  if (cleanedContent.startsWith("```json")) {
    cleanedContent = cleanedContent.slice(7);
  } else if (cleanedContent.startsWith("```")) {
    cleanedContent = cleanedContent.slice(3);
  }
  if (cleanedContent.endsWith("```")) {
    cleanedContent = cleanedContent.slice(0, -3);
  }
  cleanedContent = cleanedContent.trim();

  try {
    const extracted = JSON.parse(cleanedContent);

    // Ensure all template fields are present
    const result: Record<string, string | number | null> = {};
    for (const field of template.fields) {
      const value = extracted[field.name];
      if (value === undefined || value === null) {
        result[field.name] = null;
      } else if (field.type === "number") {
        const numValue =
          typeof value === "number" ? value : parseFloat(String(value));
        result[field.name] = isNaN(numValue) ? null : numValue;
      } else {
        result[field.name] = String(value);
      }
    }

    return result;
  } catch (e) {
    console.error("Failed to parse LLM response:", e, responseText);
    return createEmptyFields(template);
  }
}

// Extract fields from multiple files and assign images to asset slots
export async function extractFieldsAndAssetsFromFiles(
  template: Template,
  documentFiles: { path: string; filename: string }[],
  imageFiles: { path: string; filename: string }[],
  userPrompt?: string,
  onEvent?: ExtractionEventCallback,
  reasoning: "none" | "low" = "none"
): Promise<{
  fields: Record<string, string | number | null>;
  assets: Record<string, string | null>;
}> {
  const fieldDescriptions = template.fields
    .map((f) => `- ${f.name} (${f.type}): ${f.description}`)
    .join("\n");

  const assetDescriptions = template.assetSlots
    .map((s) => `- ${s.name} (${s.kind}): ${s.description}`)
    .join("\n");

  const imageList = imageFiles
    .map((f) => `- ${f.filename} (path: ${f.path})`)
    .join("\n");

  const openai = getOpenAI();

  try {
    // If there are document files, use container for extraction
    let containerId: string | null = null;
    const uploadedFiles: string[] = [];

    if (documentFiles.length > 0) {
      onEvent?.({ type: "status", content: "Setting up extraction environment..." });
      console.log("Creating container...");
      const container = await openai.containers.create({
        name: `extract-${Date.now()}`,
      });
      containerId = container.id;
      console.log("Container created:", container.id);

      // Upload all document files to container
      for (const doc of documentFiles) {
        let actualFilePath = doc.path;
        const ext = path.extname(doc.path).toLowerCase();

        // Convert .xlsm to .xlsx first (removes macros)
        if (ext === ".xlsm") {
          onEvent?.({ type: "status", content: `Converting ${doc.filename} to xlsx...` });
          console.log("Converting .xlsm to .xlsx...");
          actualFilePath = convertXlsmToXlsx(doc.path);
        }

        onEvent?.({ type: "status", content: `Uploading ${doc.filename}...` });
        console.log(`Uploading ${doc.filename} to container...`);
        const fileStream = fs.createReadStream(actualFilePath);
        await openai.containers.files.create(container.id, {
          file: fileStream,
        });
        uploadedFiles.push(path.basename(actualFilePath));

        // Clean up converted file if we created one
        if (actualFilePath !== doc.path && fs.existsSync(actualFilePath)) {
          fs.unlinkSync(actualFilePath);
        }
      }
    }

    // Build the prompt
    const userInstructions = userPrompt
      ? `\n\nUSER INSTRUCTIONS:\n${userPrompt}\n`
      : "";

    const documentSection = uploadedFiles.length > 0
      ? `You have access to these document files in your container: ${uploadedFiles.join(", ")}

Use code_interpreter to read and extract data from the documents.`
      : "";

    const imageSection = imageFiles.length > 0
      ? `\n\nAVAILABLE IMAGES (to assign to asset slots):
${imageList}

ASSET SLOTS TO FILL:
${assetDescriptions}

IMPORTANT - ASSET BANK LOGOS:
The available images include certification logos from the asset bank. If you need logos for:
- UL certification: look for "ul-logo.png"
- ETL listing: look for "etl-listed-us-mark.png"
- Energy Star: look for "energy-star-logo.png"
- FCC compliance: look for "fcc-logo.png"
These certification logos should be assigned to any certification-related asset slots.

Based on the image filenames, assign each image to the most appropriate asset slot.
For example, if there's an image named "product.jpg" and an asset slot "PRODUCT_IMAGE", assign it.
If an image filename contains "polar" or "distribution", it likely belongs to POLAR_GRAPH.
If an image shows a table or chart with distances, it belongs to DISTANCE_TABLE.`
      : "";

    const prompt = `${documentSection}
${userInstructions}
FIELDS TO EXTRACT:
${fieldDescriptions}

EXTRACTION INSTRUCTIONS:
1. If documents are available, use pandas to read ALL sheets/pages
2. Look for spec tables with labels like "Voltage", "Wattage", "Lumens", "CRI", etc.
3. The data may be in key-value pairs across rows or columns
4. Search for variations like "Input Voltage", "Operating Voltage" for VOLTAGE
5. Look for "Beam Angle", "Beam Width" for BEAM_ANGLE
6. Color temp may be listed as "CCT" or multiple values like "2700K/3000K/4000K"
${imageSection}

OUTPUT:
Return a JSON object with two keys:
- "fields": object with extracted field values (use null for not found)
- "assets": object mapping asset slot names to image file PATHS (use null if no match)

Example:
{
  "fields": {"PRODUCT_NAME": "LED Bulb", "WATTAGE": "13W"},
  "assets": {"PRODUCT_IMAGE": "/path/to/product.jpg", "POLAR_GRAPH": null}
}`;

    // Determine extraction status message
    if (documentFiles.length > 0 && imageFiles.length > 0) {
      onEvent?.({ type: "status", content: "Extracting data and analyzing images..." });
    } else if (documentFiles.length > 0) {
      onEvent?.({ type: "status", content: "Extracting data from documents..." });
    } else if (imageFiles.length > 0) {
      onEvent?.({ type: "status", content: "Analyzing images..." });
    }

    console.log("Calling gpt-5.1...");

    const tools: OpenAI.Responses.Tool[] = containerId
      ? [{ type: "code_interpreter", container: containerId }]
      : [];

    const response = await openai.responses.create({
      model: "gpt-5.1",
      reasoning: { effort: reasoning },
      input: prompt,
      tools: tools.length > 0 ? tools : undefined,
    });

    onEvent?.({ type: "status", content: "Processing extracted data..." });

    // Clean up container
    if (containerId) {
      try {
        await openai.containers.delete(containerId);
        console.log("Container deleted");
      } catch (e) {
        console.warn("Failed to delete container:", e);
      }
    }

    const responseText = response.output_text;
    console.log("Response:", responseText);

    const result = parseExtractedFieldsAndAssets(template, responseText, imageFiles);

    // Emit what was found
    const fieldCount = Object.values(result.fields).filter(v => v !== null).length;
    const assetCount = Object.values(result.assets).filter(v => v !== null).length;
    if (fieldCount > 0 || assetCount > 0) {
      const parts = [];
      if (fieldCount > 0) parts.push(`${fieldCount} field${fieldCount > 1 ? "s" : ""}`);
      if (assetCount > 0) parts.push(`${assetCount} image${assetCount > 1 ? "s" : ""}`);
      onEvent?.({ type: "status", content: `Found ${parts.join(" and ")}` });
    }

    return result;
  } catch (e) {
    console.error("Failed to extract fields and assets:", e);
    return {
      fields: createEmptyFields(template),
      assets: createEmptyAssets(template),
    };
  }
}

function createEmptyAssets(template: Template): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const slot of template.assetSlots) {
    result[slot.name] = null;
  }
  return result;
}

function parseExtractedFieldsAndAssets(
  template: Template,
  responseText: string,
  imageFiles: { path: string; filename: string }[]
): {
  fields: Record<string, string | number | null>;
  assets: Record<string, string | null>;
} {
  // Clean up the response - remove markdown code blocks if present
  let cleanedContent = responseText.trim();

  // Try to extract JSON from the response
  const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleanedContent = jsonMatch[0];
  }

  if (cleanedContent.startsWith("```json")) {
    cleanedContent = cleanedContent.slice(7);
  } else if (cleanedContent.startsWith("```")) {
    cleanedContent = cleanedContent.slice(3);
  }
  if (cleanedContent.endsWith("```")) {
    cleanedContent = cleanedContent.slice(0, -3);
  }
  cleanedContent = cleanedContent.trim();

  try {
    const extracted = JSON.parse(cleanedContent);

    // Parse fields
    const fields: Record<string, string | number | null> = {};
    const extractedFields = extracted.fields || extracted;
    for (const field of template.fields) {
      const value = extractedFields[field.name];
      if (value === undefined || value === null) {
        fields[field.name] = null;
      } else if (field.type === "number") {
        const numValue =
          typeof value === "number" ? value : parseFloat(String(value));
        fields[field.name] = isNaN(numValue) ? null : numValue;
      } else {
        fields[field.name] = String(value);
      }
    }

    // Parse assets
    const assets: Record<string, string | null> = {};
    const extractedAssets = extracted.assets || {};
    const imagePathMap = new Map(imageFiles.map(f => [f.filename, f.path]));

    for (const slot of template.assetSlots) {
      const assignedValue = extractedAssets[slot.name];
      if (assignedValue && typeof assignedValue === "string") {
        // Try to find the matching image file path
        // The LLM might return the full path or just the filename
        const filename = path.basename(assignedValue);
        if (imagePathMap.has(filename)) {
          assets[slot.name] = imagePathMap.get(filename)!;
        } else if (imageFiles.some(f => f.path === assignedValue)) {
          assets[slot.name] = assignedValue;
        } else {
          assets[slot.name] = null;
        }
      } else {
        assets[slot.name] = null;
      }
    }

    return { fields, assets };
  } catch (e) {
    console.error("Failed to parse LLM response:", e, responseText);
    return {
      fields: createEmptyFields(template),
      assets: createEmptyAssets(template),
    };
  }
}
