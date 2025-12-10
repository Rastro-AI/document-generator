/**
 * IDML Template Renderer
 * Uses the RunScript API (Typefi) to render IDML templates to PDF via InDesign Server
 */

import fs from "fs/promises";
import path from "path";
import axios from "axios";
import archiver from "archiver";
import { createWriteStream } from "fs";
import unzipper from "unzipper";
import os from "os";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// RunScript API configuration
const RUNSCRIPT_API_URL = "https://runscript.typefi.com/api/v2/job";
const RUNSCRIPT_API_KEY = process.env.RUNSCRIPT_API_KEY || "693969677b72cd9f48d7d456";
const RUNSCRIPT_API_SECRET = process.env.RUNSCRIPT_API_SECRET || "2b10nWW02otslLjM.ibVgkK/V.fOq8I4K6uNXwC3f1PU8yHqExJCRfhMi";

// AWS S3 configuration - use functions to get current env values
function getS3Config() {
  return {
    region: process.env.AWS_REGION || "us-east-1",
    bucket: process.env.S3_BUCKET_NAME || "modalvolumebucket",
  };
}

// Create fresh S3 client each time to pick up env changes
function getS3Client(): S3Client {
  const config = getS3Config();
  return new S3Client({
    region: config.region,
    credentials: process.env.AWS_ACCESS_KEY_ID ? {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    } : undefined,
  });
}

const log = {
  info: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [idml-renderer] ${msg}`, data !== undefined ? data : "");
  },
  error: (msg: string, data?: unknown) => {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [idml-renderer] ERROR: ${msg}`, data !== undefined ? data : "");
  },
};

export interface IdmlRenderResult {
  success: boolean;
  pdfBuffer?: Buffer;
  pngBase64?: string;
  error?: string;
}

export interface IdmlRenderOptions {
  fields: Record<string, unknown>;
  assets?: Record<string, string>;
}

/**
 * Escape XML special characters in a string
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Replace placeholders in IDML content
 * Placeholders use {{FIELD_NAME}} syntax
 */
function replacePlaceholders(content: string, fields: Record<string, unknown>): string {
  let result = content;

  for (const [key, value] of Object.entries(fields)) {
    const placeholder = `{{${key}}}`;
    const rawValue = value !== null && value !== undefined ? String(value) : "";
    // Escape XML special characters in the replacement value
    const replacement = escapeXml(rawValue);
    result = result.split(placeholder).join(replacement);
  }

  return result;
}

/**
 * Replace image placeholders in IDML content
 * Image placeholders use {{IMAGE:SLOT_NAME}} syntax in LinkResourceURI attributes
 */
function replaceImagePlaceholders(content: string, assets: Record<string, string>): string {
  let result = content;

  for (const [slotName, assetUrl] of Object.entries(assets)) {
    // Match {{IMAGE:SLOT_NAME}} pattern in LinkResourceURI
    const placeholder = `{{IMAGE:${slotName}}}`;
    if (result.includes(placeholder)) {
      // Replace with the asset URL (could be file:// path or https:// URL)
      result = result.split(placeholder).join(assetUrl);
      log.info(`Replaced image placeholder ${placeholder}`);
    }
  }

  return result;
}

/**
 * Process IDML file: extract, replace placeholders, repack
 */
async function processIdmlTemplate(
  idmlPath: string,
  fields: Record<string, unknown>,
  outputPath: string,
  assets?: Record<string, string>
): Promise<void> {
  const tempDir = path.join(os.tmpdir(), `idml_${Date.now()}`);

  try {
    // Extract IDML (it's a ZIP file)
    await fs.mkdir(tempDir, { recursive: true });

    const idmlBuffer = await fs.readFile(idmlPath);
    const directory = await unzipper.Open.buffer(idmlBuffer);

    // Extract all files
    for (const entry of directory.files) {
      const filePath = path.join(tempDir, entry.path);
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });

      if (entry.type === "File") {
        const content = await entry.buffer();

        // Only process XML files for placeholder replacement
        if (entry.path.endsWith(".xml")) {
          let textContent = content.toString("utf-8");
          // Replace text placeholders
          textContent = replacePlaceholders(textContent, fields);
          // Replace image placeholders if assets provided
          if (assets && Object.keys(assets).length > 0) {
            textContent = replaceImagePlaceholders(textContent, assets);
          }
          await fs.writeFile(filePath, textContent, "utf-8");
        } else {
          await fs.writeFile(filePath, content);
        }
      }
    }

    // Repack as IDML
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);

    // Add mimetype first (uncompressed per IDML spec)
    const mimetypePath = path.join(tempDir, "mimetype");
    if (await fs.stat(mimetypePath).catch(() => null)) {
      const mimetypeContent = await fs.readFile(mimetypePath, "utf-8");
      archive.append(mimetypeContent, { name: "mimetype", store: true });
    }

    // Add all other files
    const files = await getAllFiles(tempDir);
    for (const file of files) {
      if (path.basename(file) !== "mimetype") {
        const relativePath = path.relative(tempDir, file);
        archive.file(file, { name: relativePath });
      }
    }

    await archive.finalize();

    // Wait for write to complete
    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
    });

  } finally {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getAllFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await getAllFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * InDesign script to export PDF from IDML
 */
const INDESIGN_EXPORT_SCRIPT = `
// Get input IDML path from script args
var idmlPath = "jobFolder/input.idml";
var pdfPath = "jobFolder/output.pdf";

// Open the IDML file
var inputFile = new File(idmlPath);
if (!inputFile.exists) {
  app.consoleout("ERROR: Input file not found: " + idmlPath);
} else {
  var doc = app.open(inputFile);

  // Set PDF export options
  var pdfPreset = app.pdfExportPresets.item("[High Quality Print]");

  // Export to PDF
  var outputFile = new File(pdfPath);
  doc.exportFile(ExportFormat.PDF_TYPE, outputFile, false, pdfPreset);

  // Close document without saving
  doc.close(SaveOptions.NO);

  app.consoleout("SUCCESS: PDF exported to " + pdfPath);
}
`;

/**
 * Upload asset to S3 and return presigned GET URL
 * Supports data URLs and file paths
 */
async function uploadAssetToS3(
  assetData: string,
  s3Key: string
): Promise<string> {
  const { bucket } = getS3Config();
  const s3 = getS3Client();

  let buffer: Buffer;
  let contentType = "image/png";

  if (assetData.startsWith("data:")) {
    // Parse data URL
    const matches = assetData.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("Invalid data URL format");
    }
    contentType = matches[1];
    buffer = Buffer.from(matches[2], "base64");
  } else if (assetData.startsWith("/") || assetData.startsWith("file://")) {
    // File path
    const filePath = assetData.replace("file://", "");
    buffer = await fs.readFile(filePath);
    // Infer content type from extension
    if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) {
      contentType = "image/jpeg";
    } else if (filePath.endsWith(".png")) {
      contentType = "image/png";
    } else if (filePath.endsWith(".gif")) {
      contentType = "image/gif";
    }
  } else {
    throw new Error("Asset must be a data URL or file path");
  }

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    Body: buffer,
    ContentType: contentType,
  }));

  // Return presigned GET URL
  const url = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  }), { expiresIn: 3600 });

  return url;
}

/**
 * Render IDML template to PDF using RunScript API
 */
export async function renderIdmlTemplate(
  idmlPath: string,
  options: IdmlRenderOptions
): Promise<IdmlRenderResult> {
  const tempDir = path.join(os.tmpdir(), `idml_render_${Date.now()}`);
  const jobId = `idml_${Date.now()}`;

  try {
    await fs.mkdir(tempDir, { recursive: true });

    // Upload assets to S3 and get URLs
    let assetUrls: Record<string, string> | undefined;
    if (options.assets && Object.keys(options.assets).length > 0) {
      log.info("Uploading assets to S3...");
      assetUrls = {};
      for (const [slotName, assetData] of Object.entries(options.assets)) {
        if (assetData) {
          const s3Key = `runscript/${jobId}/assets/${slotName}.img`;
          const url = await uploadAssetToS3(assetData, s3Key);
          assetUrls[slotName] = url;
          log.info(`Uploaded asset ${slotName}`);
        }
      }
    }

    // Process IDML with field replacements (NOT asset URLs - those get passed to RunScript directly)
    const processedIdmlPath = path.join(tempDir, "processed.idml");
    log.info("Processing IDML template with field replacements...");
    // Don't replace image placeholders in IDML - leave them for InDesign script to handle
    await processIdmlTemplate(idmlPath, options.fields, processedIdmlPath);

    // Check if we should use RunScript API or local fallback
    // RunScript is enabled if AWS credentials are configured (for S3 file transfer)
    const hasAwsCredentials = !!process.env.AWS_ACCESS_KEY_ID;
    const useRunScript = hasAwsCredentials || process.env.USE_RUNSCRIPT === "true";

    if (!useRunScript) {
      log.info("RunScript disabled - configure AWS_ACCESS_KEY_ID to enable IDML rendering");
      return await renderIdmlLocally(processedIdmlPath);
    }

    // Build asset inputs for RunScript
    const assetInputs: Array<{ slotName: string; s3Url: string }> = [];
    if (assetUrls) {
      for (const [slotName, s3Url] of Object.entries(assetUrls)) {
        assetInputs.push({ slotName, s3Url });
      }
    }

    // Use RunScript API for IDML to PDF conversion
    return await renderIdmlWithRunScript(processedIdmlPath, tempDir, assetInputs);

  } catch (error) {
    log.error("IDML render failed", error);
    return {
      success: false,
      error: `IDML render failed: ${error}`,
    };
  } finally {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Upload file to S3 and get presigned GET URL
 */
async function uploadToS3AndGetUrl(filePath: string, s3Key: string): Promise<string> {
  const fileBuffer = await fs.readFile(filePath);
  const { bucket } = getS3Config();
  const client = getS3Client();

  // Upload to S3
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: s3Key.endsWith(".idml")
      ? "application/vnd.adobe.indesign-idml-package"
      : "application/pdf",
  }));

  // Generate presigned GET URL (valid for 1 hour)
  const getUrl = await getSignedUrl(client, new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  }), { expiresIn: 3600 });

  return getUrl;
}

/**
 * Get presigned PUT URL for S3 upload
 */
async function getS3PutUrl(s3Key: string): Promise<string> {
  const { bucket } = getS3Config();
  const client = getS3Client();

  const putUrl = await getSignedUrl(client, new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: "application/pdf",
  }), { expiresIn: 3600 });

  return putUrl;
}

/**
 * Download file from S3
 */
async function downloadFromS3(s3Key: string): Promise<Buffer> {
  const { bucket } = getS3Config();
  const client = getS3Client();

  const response = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
  }));

  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Render IDML using RunScript API
 * Uses S3 presigned URLs for both input and output
 * NOTE: data URLs for inputs cause outputs to fail - must use S3 for inputs too
 */
async function renderIdmlWithRunScript(
  processedIdmlPath: string,
  tempDir: string,
  assetInputs?: Array<{ slotName: string; s3Url: string }>
): Promise<IdmlRenderResult> {
  const jobId = `idml_${Date.now()}`;
  const inputS3Key = `runscript/${jobId}/input.idml`;
  const outputS3Key = `runscript/${jobId}/output.pdf`;

  try {
    // Check if S3 is configured (required for both input and output)
    if (!process.env.AWS_ACCESS_KEY_ID) {
      log.info("AWS credentials not configured, using local fallback");
      return await renderIdmlLocally(processedIdmlPath);
    }

    // Upload IDML to S3 and get presigned GET URL
    log.info("Uploading IDML to S3...");
    const idmlBuffer = await fs.readFile(processedIdmlPath);
    const { bucket } = getS3Config();
    const s3 = getS3Client();

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: inputS3Key,
      Body: idmlBuffer,
      ContentType: "application/vnd.adobe.indesign-idml-package",
    }));

    const inputUrl = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: bucket,
      Key: inputS3Key,
    }), { expiresIn: 3600 });
    log.info("IDML uploaded to S3", { size: idmlBuffer.length, key: inputS3Key });

    // Get presigned PUT URL for output PDF
    const outputUrl = await getS3PutUrl(outputS3Key);
    log.info("Got presigned PUT URL for output");

    // Build inputs array - IDML + any asset images
    const inputs: Array<{ href: string; path: string }> = [
      { href: inputUrl, path: "jobFolder/input.idml" }
    ];

    // Add asset images as inputs with proper file extensions
    // These get placed into rectangles by the InDesign script
    if (assetInputs && assetInputs.length > 0) {
      for (const asset of assetInputs) {
        // Determine file extension from the URL or default to jpg
        let ext = "jpg";
        if (asset.s3Url.includes(".png")) ext = "png";
        else if (asset.s3Url.includes(".gif")) ext = "gif";

        inputs.push({
          href: asset.s3Url,
          path: `jobFolder/assets/${asset.slotName}.${ext}`
        });
      }
      log.info(`Added ${assetInputs.length} asset inputs`);
    }

    // Build asset slot names for the script
    const assetSlotNames = assetInputs?.map(a => a.slotName) || [];

    // InDesign script to export PDF
    // Strategy 1: Place images into NAMED rectangle frames (Object > Object Export Options)
    // Strategy 2: Update XMLElement href attributes (for XML-based image placeholders)
    // Strategy 3: Place into all rectangles without existing content (fallback)
    const exportScript = `
// Create jobFolder if it doesn't exist (workaround for RunScript issue)
var jobFolder = new Folder("jobFolder");
if (!jobFolder.exists) {
  jobFolder.create();
}

var idmlPath = "jobFolder/input.idml";
var pdfPath = "jobFolder/output.pdf";

var inputFile = new File(idmlPath);
if (!inputFile.exists) {
  throw new Error("Input file not found: " + idmlPath);
}

var doc = app.open(inputFile);

// Asset slot names passed from Node.js
var assetSlots = ${JSON.stringify(assetSlotNames)};
var placedSlots = {};

// Helper: find asset file with various extensions
function findAssetFile(slotName) {
  var extensions = ["jpg", "png", "gif", "jpeg", "tif", "tiff", "psd", "img"];
  for (var j = 0; j < extensions.length; j++) {
    var testFile = new File("jobFolder/assets/" + slotName + "." + extensions[j]);
    if (testFile.exists) return testFile;
  }
  return null;
}

// Helper: place image into a rectangle
function placeImageInRect(rect, assetFile, slotName) {
  try {
    rect.place(assetFile);
    rect.fit(FitOptions.FILL_PROPORTIONALLY);
    rect.fit(FitOptions.CENTER_CONTENT);
    placedSlots[slotName] = true;
    return true;
  } catch (e) {
    return false;
  }
}

// Strategy 1: Find rectangles by name (most reliable)
var allRects = doc.rectangles;
for (var i = 0; i < assetSlots.length; i++) {
  var slotName = assetSlots[i];
  if (placedSlots[slotName]) continue;

  var assetFile = findAssetFile(slotName);
  if (!assetFile) continue;

  for (var r = 0; r < allRects.length; r++) {
    var rect = allRects[r];
    if (rect.name === slotName) {
      placeImageInRect(rect, assetFile, slotName);
      break;
    }
  }
}

// Strategy 2: Find frames by XML tag name (for XMLElement-based placeholders)
try {
  var xmlElements = doc.xmlElements;
  for (var x = 0; x < xmlElements.length; x++) {
    var xmlEl = xmlElements[x];
    var tagName = xmlEl.markupTag ? xmlEl.markupTag.name : "";

    // Check if tag name matches any asset slot
    for (var i = 0; i < assetSlots.length; i++) {
      var slotName = assetSlots[i];
      if (placedSlots[slotName]) continue;

      // Match tag name to slot name (case-insensitive, with/without underscores)
      var normalizedTag = tagName.toLowerCase().replace(/_/g, "");
      var normalizedSlot = slotName.toLowerCase().replace(/_/g, "");

      if (normalizedTag === normalizedSlot || tagName === slotName ||
          tagName.toLowerCase() === slotName.toLowerCase()) {
        var assetFile = findAssetFile(slotName);
        if (!assetFile) continue;

        // Find the associated page item (rectangle/frame)
        try {
          var xmlContent = xmlEl.xmlContent;
          if (xmlContent && xmlContent.constructor.name === "Rectangle") {
            placeImageInRect(xmlContent, assetFile, slotName);
          }
        } catch (e) {
          // Continue on error
        }
      }
    }
  }
} catch (e) {
  // XML elements not available or error
}

// Strategy 3: For any remaining slots, try to find empty rectangles
// This is a fallback for templates without proper naming
for (var i = 0; i < assetSlots.length; i++) {
  var slotName = assetSlots[i];
  if (placedSlots[slotName]) continue;

  var assetFile = findAssetFile(slotName);
  if (!assetFile) continue;

  // Find first empty rectangle that could hold an image
  for (var r = 0; r < allRects.length; r++) {
    var rect = allRects[r];
    // Check if rectangle is empty (no existing content)
    try {
      if (rect.allGraphics.length === 0 && !rect.name) {
        if (placeImageInRect(rect, assetFile, slotName)) {
          break;
        }
      }
    } catch (e) {
      // Continue on error
    }
  }
}

var outputFile = new File(pdfPath);

// Try to use High Quality preset, fallback to default
try {
  var pdfPreset = app.pdfExportPresets.item("[High Quality Print]");
  doc.exportFile(ExportFormat.PDF_TYPE, outputFile, false, pdfPreset);
} catch (e) {
  doc.exportFile(ExportFormat.PDF_TYPE, outputFile);
}

doc.close(SaveOptions.NO);
"PDF exported successfully";
`;

    // Call RunScript API with S3 presigned URLs
    log.info("Calling RunScript API...");

    const runScriptPayload = {
      inputs: inputs,
      outputs: [{ href: outputUrl, path: "jobFolder/output.pdf" }],
      script: exportScript,
      ids: "2024",
    };

    const response = await axios.post(RUNSCRIPT_API_URL, runScriptPayload, {
      auth: {
        username: RUNSCRIPT_API_KEY,
        password: RUNSCRIPT_API_SECRET,
      },
    });

    const runscriptJobId = response.data._id;
    log.info("RunScript job created", { jobId: runscriptJobId });

    // Poll for completion
    let status = "queued";
    let attempts = 0;
    let jobData: { result?: string; error?: string; status?: string; log?: string } = {};
    const maxAttempts = 60;

    while (status !== "complete" && status !== "failed" && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusResponse = await axios.get(`${RUNSCRIPT_API_URL}/${runscriptJobId}`, {
        auth: {
          username: RUNSCRIPT_API_KEY,
          password: RUNSCRIPT_API_SECRET,
        },
      });

      status = statusResponse.data.status;
      jobData = statusResponse.data;
      attempts++;
      log.info(`RunScript status: ${status} (attempt ${attempts})`);
    }

    if (status === "failed") {
      const errorMsg = jobData.log || jobData.error || "Unknown error";
      log.error("RunScript job failed", { error: errorMsg, jobData });
      return { success: false, error: `RunScript job failed: ${errorMsg}` };
    }

    if (status !== "complete") {
      return { success: false, error: "RunScript job timed out" };
    }

    log.info("RunScript job completed", { result: jobData.result, log: jobData.log });

    // Wait for S3 upload to complete (RunScript uploads async)
    await new Promise(resolve => setTimeout(resolve, 3000));

    log.info("Downloading PDF from S3...");

    // Download PDF from S3 with retry
    let pdfBuffer: Buffer | null = null;
    let downloadAttempts = 0;
    const maxDownloadAttempts = 3;

    while (!pdfBuffer && downloadAttempts < maxDownloadAttempts) {
      try {
        pdfBuffer = await downloadFromS3(outputS3Key);
        log.info("PDF downloaded from S3", { size: pdfBuffer.length });
      } catch (downloadError: unknown) {
        downloadAttempts++;
        const errMsg = downloadError instanceof Error ? downloadError.message : String(downloadError);
        log.info(`S3 download attempt ${downloadAttempts} failed: ${errMsg}`);
        if (downloadAttempts < maxDownloadAttempts) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    if (!pdfBuffer) {
      return {
        success: false,
        error: "RunScript job completed but PDF could not be downloaded from S3. The InDesign Server may have failed to export the PDF.",
      };
    }

    return {
      success: true,
      pdfBuffer,
      pngBase64: undefined,
    };

  } catch (error) {
    log.error("RunScript API error", error);
    return {
      success: false,
      error: `RunScript API error: ${error}`,
    };
  }
}

/**
 * Local fallback: IDML placeholders are replaced but no PDF generation
 * Returns error since we can't produce a valid PDF without InDesign Server
 */
async function renderIdmlLocally(idmlPath: string): Promise<IdmlRenderResult> {
  log.info("Local fallback: IDML processed but cannot generate PDF without InDesign Server");

  return {
    success: false,
    pdfBuffer: undefined,
    pngBase64: undefined,
    error: "IDML template requires InDesign Server for PDF generation. Please configure AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME) for RunScript API.",
  };
}

/**
 * Extract placeholders from IDML template
 * Returns list of field names found as {{FIELD_NAME}}
 */
export async function extractIdmlPlaceholders(idmlPath: string): Promise<string[]> {
  const placeholders = new Set<string>();

  try {
    const idmlBuffer = await fs.readFile(idmlPath);
    const directory = await unzipper.Open.buffer(idmlBuffer);

    for (const entry of directory.files) {
      if (entry.path.endsWith(".xml") && entry.type === "File") {
        const content = await entry.buffer();
        const text = content.toString("utf-8");

        // Find all {{PLACEHOLDER}} patterns
        const matches = text.matchAll(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g);
        for (const match of matches) {
          placeholders.add(match[1]);
        }
      }
    }
  } catch (error) {
    log.error("Failed to extract placeholders", error);
  }

  return Array.from(placeholders);
}

/**
 * Read IDML content for editing
 * Returns the main story XML content
 */
export async function readIdmlContent(idmlPath: string): Promise<string> {
  const idmlBuffer = await fs.readFile(idmlPath);
  const directory = await unzipper.Open.buffer(idmlBuffer);

  // Find Stories directory and concatenate content
  const storyContents: string[] = [];

  for (const entry of directory.files) {
    if (entry.path.startsWith("Stories/") && entry.path.endsWith(".xml") && entry.type === "File") {
      const content = await entry.buffer();
      storyContents.push(content.toString("utf-8"));
    }
  }

  return storyContents.join("\n\n---\n\n");
}

/**
 * Update IDML content
 * Applies search/replace operations to story XML files
 */
export async function updateIdmlContent(
  idmlPath: string,
  operations: Array<{ search: string; replace: string }>,
  outputPath: string
): Promise<{ success: boolean; results: string[] }> {
  const tempDir = path.join(os.tmpdir(), `idml_update_${Date.now()}`);
  const results: string[] = [];

  try {
    await fs.mkdir(tempDir, { recursive: true });

    const idmlBuffer = await fs.readFile(idmlPath);
    const directory = await unzipper.Open.buffer(idmlBuffer);

    // Extract and process files
    for (const entry of directory.files) {
      const filePath = path.join(tempDir, entry.path);
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });

      if (entry.type === "File") {
        let content = await entry.buffer();

        // Apply operations to Story XML files
        if (entry.path.startsWith("Stories/") && entry.path.endsWith(".xml")) {
          let textContent = content.toString("utf-8");

          for (const op of operations) {
            if (textContent.includes(op.search)) {
              textContent = textContent.split(op.search).join(op.replace);
              results.push(`OK: replaced "${op.search.substring(0, 30)}..."`);
            }
          }

          await fs.writeFile(filePath, textContent, "utf-8");
        } else {
          await fs.writeFile(filePath, content);
        }
      }
    }

    // Repack as IDML
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);

    const mimetypePath = path.join(tempDir, "mimetype");
    if (await fs.stat(mimetypePath).catch(() => null)) {
      const mimetypeContent = await fs.readFile(mimetypePath, "utf-8");
      archive.append(mimetypeContent, { name: "mimetype", store: true });
    }

    const files = await getAllFiles(tempDir);
    for (const file of files) {
      if (path.basename(file) !== "mimetype") {
        const relativePath = path.relative(tempDir, file);
        archive.file(file, { name: relativePath });
      }
    }

    await archive.finalize();
    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
    });

    return { success: true, results };

  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
