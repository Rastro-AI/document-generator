/**
 * IDML Analyzer - Extracts template structure from IDML files
 * Used when setting up new IDML templates
 */

import unzipper from "unzipper";
import archiver from "archiver";
import { createWriteStream } from "fs";
import fs from "fs/promises";
import path from "path";
import os from "os";

export interface IdmlAnalysis {
  // Text placeholders found ({{FIELD_NAME}} syntax)
  textPlaceholders: Array<{
    name: string;
    storyFile: string;
    context: string; // surrounding text for context
  }>;

  // Named rectangles that can be used for images
  namedRectangles: Array<{
    name: string;
    spreadFile: string;
    hasExistingImage: boolean;
  }>;

  // Page count
  pageCount: number;

  // Document dimensions (from first page)
  dimensions?: {
    width: number;
    height: number;
  };
}

/**
 * Analyze an IDML file and extract its structure
 */
export async function analyzeIdml(idmlBuffer: Buffer): Promise<IdmlAnalysis> {
  const directory = await unzipper.Open.buffer(idmlBuffer);
  const result: IdmlAnalysis = {
    textPlaceholders: [],
    namedRectangles: [],
    pageCount: 0,
  };

  // Track found placeholder names to avoid duplicates
  const foundPlaceholders = new Set<string>();
  const foundRectangles = new Set<string>();

  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    const entryName = entry.path;

    // Analyze Stories for text placeholders
    if (entryName.startsWith("Stories/Story_") && entryName.endsWith(".xml")) {
      const content = (await entry.buffer()).toString("utf-8");

      // Find {{PLACEHOLDER}} patterns
      const placeholderRegex = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;
      let match;
      while ((match = placeholderRegex.exec(content)) !== null) {
        const name = match[1];
        if (!foundPlaceholders.has(name)) {
          foundPlaceholders.add(name);

          // Extract some context around the placeholder
          const start = Math.max(0, match.index - 30);
          const end = Math.min(content.length, match.index + match[0].length + 30);
          let context = content.slice(start, end);
          // Clean up XML tags for readability
          context = context.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

          result.textPlaceholders.push({
            name,
            storyFile: entryName,
            context,
          });
        }
      }
    }

    // Analyze Spreads for named rectangles and page count
    if (entryName.startsWith("Spreads/Spread_") && entryName.endsWith(".xml")) {
      const content = (await entry.buffer()).toString("utf-8");

      // Count pages in this spread
      const pageMatches = content.match(/<Page\s/g);
      if (pageMatches) {
        result.pageCount += pageMatches.length;
      }

      // Extract page dimensions from first page
      if (!result.dimensions) {
        const boundsMatch = content.match(/GeometricBounds="([^"]+)"/);
        if (boundsMatch) {
          const bounds = boundsMatch[1].split(" ").map(Number);
          if (bounds.length === 4) {
            // GeometricBounds = "top left bottom right"
            result.dimensions = {
              width: Math.round(bounds[3] - bounds[1]),
              height: Math.round(bounds[2] - bounds[0]),
            };
          }
        }
      }

      // Find named rectangles
      // Rectangle elements with Name attribute that isn't "$ID/"
      const rectRegex = /<Rectangle[^>]+Self="([^"]+)"[^>]*Name="([^"]+)"[^>]*>/g;
      let rectMatch;
      while ((rectMatch = rectRegex.exec(content)) !== null) {
        const rectId = rectMatch[1];
        const rectName = rectMatch[2];

        // Skip default/empty names
        if (rectName && rectName !== "$ID/" && !foundRectangles.has(rectName)) {
          foundRectangles.add(rectName);

          // Check if this rectangle has an existing image
          const hasImage = content.includes(`<Image[^>]*Self="${rectId}`) ||
            content.includes(`XMLContent="${rectId}"`);

          result.namedRectangles.push({
            name: rectName,
            spreadFile: entryName,
            hasExistingImage: hasImage,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Generate a template.json from IDML analysis
 */
export function generateTemplateJson(
  templateId: string,
  templateName: string,
  analysis: IdmlAnalysis
): object {
  // Convert text placeholders to fields
  const fields = analysis.textPlaceholders.map((p) => ({
    name: p.name,
    type: "text",
    default: p.name.replace(/_/g, " ").toLowerCase(),
    description: `Text field: ${p.context}`,
  }));

  // Convert named rectangles to asset slots
  const assetSlots = analysis.namedRectangles.map((r) => ({
    name: r.name,
    description: `Image placeholder${r.hasExistingImage ? " (has default image)" : ""}`,
  }));

  return {
    id: templateId,
    name: templateName,
    format: "idml",
    canvas: {
      width: analysis.dimensions?.width || 612,
      height: analysis.dimensions?.height || 792,
    },
    fields,
    assetSlots,
    fonts: [],
  };
}

/**
 * Set rectangle names in an IDML file
 * Used to prepare an IDML for use as a template
 */
export async function setRectangleNames(
  idmlBuffer: Buffer,
  rectangleNames: Array<{ index: number; name: string }>
): Promise<Buffer> {
  const tempDir = path.join(os.tmpdir(), `idml_rename_${Date.now()}`);
  const outputPath = path.join(tempDir, "output.idml");

  try {
    await fs.mkdir(tempDir, { recursive: true });

    const directory = await unzipper.Open.buffer(idmlBuffer);

    // Extract and process files
    const extractDir = path.join(tempDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });

    for (const entry of directory.files) {
      const filePath = path.join(extractDir, entry.path);
      const fileDir = path.dirname(filePath);
      await fs.mkdir(fileDir, { recursive: true });

      if (entry.type === "File") {
        let content = await entry.buffer();

        if (entry.path.startsWith("Spreads/Spread_") && entry.path.endsWith(".xml")) {
          let textContent = content.toString("utf-8");

          // Find all rectangles and track their order
          let rectIndex = 0;
          textContent = textContent.replace(
            /<Rectangle([^>]+)Self="([^"]+)"([^>]*)>/g,
            (match, before, selfId, after) => {
              // Check if this rectangle should be renamed
              const renameInfo = rectangleNames.find((r) => r.index === rectIndex);
              rectIndex++;

              if (renameInfo) {
                // Update or add Name attribute
                if (match.includes('Name="')) {
                  return match.replace(/Name="[^"]*"/, `Name="${renameInfo.name}"`);
                } else {
                  return `<Rectangle${before}Self="${selfId}"${after} Name="${renameInfo.name}">`;
                }
              }

              return match;
            }
          );

          content = Buffer.from(textContent, "utf-8");
        }

        await fs.writeFile(filePath, content);
      }
    }

    // Repack as IDML
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(output);

    // Add mimetype first (uncompressed per IDML spec)
    const mimetypePath = path.join(extractDir, "mimetype");
    if (await fs.stat(mimetypePath).catch(() => null)) {
      const mimetypeContent = await fs.readFile(mimetypePath, "utf-8");
      archive.append(mimetypeContent, { name: "mimetype", store: true });
    }

    // Get all files
    const getAllFiles = async (dir: string): Promise<string[]> => {
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
    };

    const files = await getAllFiles(extractDir);
    for (const file of files) {
      if (path.basename(file) !== "mimetype") {
        const relativePath = path.relative(extractDir, file);
        archive.file(file, { name: relativePath });
      }
    }

    await archive.finalize();
    await new Promise<void>((resolve, reject) => {
      output.on("close", resolve);
      output.on("error", reject);
    });

    return await fs.readFile(outputPath);

  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
