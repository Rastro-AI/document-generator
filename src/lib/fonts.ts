/**
 * Font loading utilities for Satori
 * Satori requires font buffers to render text
 */

import fs from "fs/promises";
import path from "path";
import { TemplateFont } from "./types";

// Weight type that matches Satori's expected font weights
export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export interface SatoriFont {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: "normal" | "italic";
}

// Cache loaded fonts by family+weight to avoid repeated fetches
const fontCache = new Map<string, SatoriFont>();

// Google Fonts URL patterns for common fonts
// Format: family -> { weight -> woff2 URL }
const GOOGLE_FONTS_URLS: Record<string, Record<string, string>> = {
  Inter: {
    "400": "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hjp-Ek-_EeA.woff",
    "500": "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuI2fAZ9hjp-Ek-_EeA.woff",
    "600": "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYAZ9hjp-Ek-_EeA.woff",
    "700": "https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYAZ9hjp-Ek-_EeA.woff",
  },
  Roboto: {
    "400": "https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Me5Q.ttf",
    "500": "https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmEU9vAw.ttf",
    "700": "https://fonts.gstatic.com/s/roboto/v30/KFOlCnqEu92Fr1MmWUlvAw.ttf",
  },
  "Open Sans": {
    "400": "https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0C4n.ttf",
    "600": "https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsg-1y4n.ttf",
    "700": "https://fonts.gstatic.com/s/opensans/v40/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsgH1y4n.ttf",
  },
  Lato: {
    "400": "https://fonts.gstatic.com/s/lato/v24/S6uyw4BMUTPHvxk.ttf",
    "700": "https://fonts.gstatic.com/s/lato/v24/S6u9w4BMUTPHh6UVSwiPHA.ttf",
  },
  Montserrat: {
    "400": "https://fonts.gstatic.com/s/montserrat/v26/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Ew-.ttf",
    "500": "https://fonts.gstatic.com/s/montserrat/v26/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtZ6Ew-.ttf",
    "600": "https://fonts.gstatic.com/s/montserrat/v26/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCu170w-.ttf",
    "700": "https://fonts.gstatic.com/s/montserrat/v26/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf",
  },
  Poppins: {
    "400": "https://fonts.gstatic.com/s/poppins/v21/pxiEyp8kv8JHgFVrFJA.ttf",
    "500": "https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLGT9V1s.ttf",
    "600": "https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLEj6V1s.ttf",
    "700": "https://fonts.gstatic.com/s/poppins/v21/pxiByp8kv8JHgFVrLCz7V1s.ttf",
  },
  "Source Sans Pro": {
    "400": "https://fonts.gstatic.com/s/sourcesanspro/v22/6xK3dSBYKcSV-LCoeQqfX1RYOo3aPA.ttf",
    "600": "https://fonts.gstatic.com/s/sourcesanspro/v22/6xKydSBYKcSV-LCoeQqfX1RYOo3i54rAkA.ttf",
    "700": "https://fonts.gstatic.com/s/sourcesanspro/v22/6xKydSBYKcSV-LCoeQqfX1RYOo3ig4vAkA.ttf",
  },
  Raleway: {
    "400": "https://fonts.gstatic.com/s/raleway/v29/1Ptxg8zYS_SKggPN4iEgvnHyvveLxVvaorCIPrE.ttf",
    "500": "https://fonts.gstatic.com/s/raleway/v29/1Ptxg8zYS_SKggPN4iEgvnHyvveLxVsEorCIPrE.ttf",
    "600": "https://fonts.gstatic.com/s/raleway/v29/1Ptxg8zYS_SKggPN4iEgvnHyvveLxVvopbCIPrE.ttf",
    "700": "https://fonts.gstatic.com/s/raleway/v29/1Ptxg8zYS_SKggPN4iEgvnHyvveLxVvRpbCIPrE.ttf",
  },
};

/**
 * Get cache key for a font
 */
function getCacheKey(family: string, weight: string): string {
  return `${family}:${weight}`;
}

/**
 * Load a single font from URL
 */
async function loadFontFromUrl(
  family: string,
  weight: FontWeight,
  url: string
): Promise<SatoriFont> {
  const cacheKey = getCacheKey(family, String(weight));

  if (fontCache.has(cacheKey)) {
    return fontCache.get(cacheKey)!;
  }

  console.log(`[fonts] Fetching ${family} ${weight} from ${url.substring(0, 50)}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch font: ${response.status}`);
  }

  const data = await response.arrayBuffer();
  const font: SatoriFont = {
    name: family,
    data,
    weight,
    style: "normal",
  };

  fontCache.set(cacheKey, font);
  return font;
}

/**
 * Load a font from local file
 */
async function loadFontFromFile(
  family: string,
  weight: FontWeight,
  filePath: string
): Promise<SatoriFont> {
  const cacheKey = getCacheKey(family, String(weight));

  if (fontCache.has(cacheKey)) {
    return fontCache.get(cacheKey)!;
  }

  console.log(`[fonts] Loading ${family} ${weight} from ${filePath}`);
  const buffer = await fs.readFile(filePath);
  const font: SatoriFont = {
    name: family,
    data: buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ),
    weight,
    style: "normal",
  };

  fontCache.set(cacheKey, font);
  return font;
}

/**
 * Load fonts based on template configuration
 * Falls back to Inter if no fonts specified or fonts fail to load
 */
export async function loadFonts(templateFonts?: TemplateFont[]): Promise<SatoriFont[]> {
  const fonts: SatoriFont[] = [];
  const loadedFamilies = new Set<string>();

  // If template specifies fonts, try to load them
  if (templateFonts && templateFonts.length > 0) {
    for (const templateFont of templateFonts) {
      const family = templateFont.family;

      for (const [weightStr, customPath] of Object.entries(templateFont.weights)) {
        const weight = parseInt(weightStr, 10) as FontWeight;

        try {
          let font: SatoriFont;

          if (customPath) {
            // Custom font file path specified
            const fullPath = path.isAbsolute(customPath)
              ? customPath
              : path.join(process.cwd(), customPath);
            font = await loadFontFromFile(family, weight, fullPath);
          } else if (GOOGLE_FONTS_URLS[family]?.[weightStr]) {
            // Load from known Google Fonts URL
            font = await loadFontFromUrl(family, weight, GOOGLE_FONTS_URLS[family][weightStr]);
          } else {
            console.warn(`[fonts] No URL mapping for ${family} ${weight}, skipping`);
            continue;
          }

          fonts.push(font);
          loadedFamilies.add(family);
        } catch (err) {
          console.error(`[fonts] Failed to load ${family} ${weight}:`, err);
        }
      }
    }
  }

  // Always ensure we have at least Inter as fallback
  if (!loadedFamilies.has("Inter")) {
    try {
      const interFonts = await loadDefaultInterFonts();
      fonts.push(...interFonts);
    } catch (err) {
      console.error("[fonts] Failed to load fallback Inter fonts:", err);
      if (fonts.length === 0) {
        throw new Error("No fonts available for Satori rendering");
      }
    }
  }

  console.log(`[fonts] Loaded ${fonts.length} font variants: ${[...new Set(fonts.map(f => f.name))].join(", ")}`);
  return fonts;
}

/**
 * Load default Inter fonts (local files or Google Fonts fallback)
 */
async function loadDefaultInterFonts(): Promise<SatoriFont[]> {
  const fonts: SatoriFont[] = [];

  // Try loading local Inter fonts first
  const fontDir = path.join(process.cwd(), "templates", "sunco-spec-v1", "fonts");

  try {
    fonts.push(await loadFontFromFile("Inter", 400, path.join(fontDir, "Inter-Regular.ttf")));
    fonts.push(await loadFontFromFile("Inter", 700, path.join(fontDir, "Inter-Bold.ttf")));
    console.log("[fonts] Loaded Inter from local files");
  } catch {
    // Fallback to Google Fonts
    console.log("[fonts] Local Inter not found, fetching from Google Fonts...");
    fonts.push(await loadFontFromUrl("Inter", 400, GOOGLE_FONTS_URLS.Inter["400"]));
    fonts.push(await loadFontFromUrl("Inter", 700, GOOGLE_FONTS_URLS.Inter["700"]));
    console.log("[fonts] Loaded Inter from Google Fonts");
  }

  return fonts;
}

/**
 * Clear the font cache (useful for testing)
 */
export function clearFontCache(): void {
  fontCache.clear();
}
