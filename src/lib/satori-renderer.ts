/**
 * Satori Document Renderer
 * Converts HTML/JSX strings to SVG using Satori, then combines into multi-page PDF
 */

import satori from "satori";
import { loadFonts } from "./fonts";
import { Resvg } from "@resvg/resvg-js";
import { PDFDocument } from "pdf-lib";
import React from "react";
import { TemplateFont } from "./types";
import parse, { Element, HTMLReactParserOptions, DOMNode, domToReact } from "html-react-parser";
import styleToJS from "style-to-js";
import sharp from "sharp";

// Page size definitions at 96 DPI
export const PAGE_SIZES = {
  A4: { width: 794, height: 1123 },
  LETTER: { width: 816, height: 1056 },
  LEGAL: { width: 816, height: 1344 },
} as const;

export type PageSizeKey = keyof typeof PAGE_SIZES;

export interface PageSize {
  width: number;
  height: number;
}

export interface HeaderFooterConfig {
  height: number;
  content: string; // JSX string
}

export interface PageContent {
  body: string; // JSX string
  headerOverride?: string | null;
  footerOverride?: string | null;
}

export interface SatoriDocument {
  pageSize: PageSizeKey | PageSize;
  header?: HeaderFooterConfig;
  footer?: HeaderFooterConfig;
  pages: PageContent[];
}

export interface RenderResult {
  svgs: string[];
  pdfBuffer: Buffer;
  pngBuffers: Buffer[];
}

/**
 * Get page dimensions from size config
 */
function getPageDimensions(pageSize: PageSizeKey | PageSize): PageSize {
  if (typeof pageSize === "string") {
    return PAGE_SIZES[pageSize];
  }
  return pageSize;
}

/**
 * Escape XML special characters
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
 * Substitute placeholders in JSX string
 * Handles {{FIELD}}, {{FIELD:default}}, and special vars like {{pageNumber}}
 */
function substitutePlaceholders(
  jsxString: string,
  fields: Record<string, unknown>,
  assets: Record<string, string | null>,
  pageNumber?: number,
  totalPages?: number
): string {
  let result = jsxString;

  // Replace special page variables
  if (pageNumber !== undefined) {
    result = result.replace(/\{\{pageNumber\}\}/g, String(pageNumber));
  }
  if (totalPages !== undefined) {
    result = result.replace(/\{\{totalPages\}\}/g, String(totalPages));
  }
  result = result.replace(/\{\{date\}\}/g, new Date().toISOString().split("T")[0]);
  result = result.replace(
    /\{\{dateFormatted\}\}/g,
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
  );

  // Replace field placeholders: {{FIELD}} or {{FIELD:default}}
  result = result.replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (match, fieldName, defaultValue) => {
    // Check if it's an asset
    if (fieldName in assets) {
      const assetValue = assets[fieldName];
      return assetValue || defaultValue || match; // Keep placeholder if no value
    }
    // Check if it's a field
    if (fieldName in fields) {
      const value = fields[fieldName];
      if (value === null || value === undefined) {
        return defaultValue !== undefined ? defaultValue : match; // Keep placeholder if null
      }
      if (typeof value === "string") return escapeXml(value);
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (Array.isArray(value)) return value.map(v => String(v)).join(", ");
      return JSON.stringify(value);
    }
    // Return default if specified, otherwise keep the original placeholder visible
    // This prevents empty text which causes Satori height=0 issues
    return defaultValue !== undefined ? defaultValue : match;
  });

  // NOTE: We do NOT replace image placeholders here.
  // Image placeholders ({{IMAGE_NAME}}) are handled in parseHtmlToReact
  // where they're converted to colored placeholder boxes with labels.
  // This keeps the SVG clean and small.

  return result;
}

/**
 * Parse a simple JSX-like string into React elements
 * This is a lightweight parser for the constrained Satori JSX syntax
 * Supports: div, span, p, img, svg (and svg children)
 */
function parseJsxToReact(jsxString: string): React.ReactElement {
  // Clean up the string
  const cleaned = jsxString.trim();

  // Handle empty or whitespace-only
  if (!cleaned) {
    return React.createElement("div", null);
  }

  // Use a recursive descent parser
  return parseElement(cleaned, 0).element;
}

interface ParseResult {
  element: React.ReactElement;
  endIndex: number;
}

function parseElement(str: string, startIndex: number): ParseResult {
  let i = startIndex;

  // Skip whitespace
  while (i < str.length && /\s/.test(str[i])) i++;

  // Check for text content (not starting with <)
  if (str[i] !== "<") {
    // Find the end of text (next < or end)
    let textEnd = str.indexOf("<", i);
    if (textEnd === -1) textEnd = str.length;
    const text = str.slice(i, textEnd).trim();
    return {
      element: React.createElement(React.Fragment, null, text),
      endIndex: textEnd,
    };
  }

  // Parse opening tag
  i++; // skip <

  // Check for closing tag
  if (str[i] === "/") {
    throw new Error(`Unexpected closing tag at ${i}`);
  }

  // Get tag name
  let tagEnd = i;
  while (tagEnd < str.length && /[a-zA-Z0-9]/.test(str[tagEnd])) tagEnd++;
  const tagName = str.slice(i, tagEnd);
  i = tagEnd;

  // Parse attributes
  const props: Record<string, unknown> = {};
  while (i < str.length) {
    // Skip whitespace
    while (i < str.length && /\s/.test(str[i])) i++;

    // Check for end of opening tag
    if (str[i] === ">") {
      i++;
      break;
    }
    if (str[i] === "/" && str[i + 1] === ">") {
      // Self-closing tag
      i += 2;
      return {
        element: React.createElement(tagName, props),
        endIndex: i,
      };
    }

    // Parse attribute name
    let attrNameEnd = i;
    while (attrNameEnd < str.length && /[a-zA-Z0-9_-]/.test(str[attrNameEnd])) attrNameEnd++;
    const attrName = str.slice(i, attrNameEnd);
    i = attrNameEnd;

    // Skip =
    while (i < str.length && /\s/.test(str[i])) i++;
    if (str[i] !== "=") {
      // Boolean attribute
      props[attrName] = true;
      continue;
    }
    i++; // skip =
    while (i < str.length && /\s/.test(str[i])) i++;

    // Parse attribute value
    if (str[i] === '"' || str[i] === "'") {
      const quote = str[i];
      i++;
      let valueEnd = str.indexOf(quote, i);
      if (valueEnd === -1) valueEnd = str.length;
      const value = str.slice(i, valueEnd);
      i = valueEnd + 1;

      // Convert to appropriate type
      if (attrName === "style") {
        props[attrName] = parseStyleString(value);
      } else if (attrName === "width" || attrName === "height") {
        const numVal = parseFloat(value);
        props[attrName] = isNaN(numVal) ? value : numVal;
      } else {
        props[attrName] = value;
      }
    } else if (str[i] === "{") {
      // JSX expression: {value} or {{...}}
      i++; // skip {
      let braceCount = 1;
      let exprStart = i;
      while (i < str.length && braceCount > 0) {
        if (str[i] === "{") braceCount++;
        else if (str[i] === "}") braceCount--;
        i++;
      }
      const expr = str.slice(exprStart, i - 1).trim();

      // Try to parse as JSON or evaluate simple expressions
      if (attrName === "style") {
        props[attrName] = parseStyleObject(expr);
      } else {
        try {
          // Try parsing as number
          const numVal = parseFloat(expr);
          if (!isNaN(numVal) && expr === String(numVal)) {
            props[attrName] = numVal;
          } else {
            props[attrName] = expr;
          }
        } catch {
          props[attrName] = expr;
        }
      }
    }
  }

  // Parse children
  const children: (React.ReactElement | string)[] = [];
  while (i < str.length) {
    // Skip whitespace
    while (i < str.length && /\s/.test(str[i])) i++;

    // Check for closing tag
    if (str[i] === "<" && str[i + 1] === "/") {
      // Find end of closing tag
      const closeEnd = str.indexOf(">", i);
      i = closeEnd + 1;
      break;
    }

    // Check for end of string
    if (i >= str.length) break;

    // Check for child element
    if (str[i] === "<") {
      const childResult = parseElement(str, i);
      children.push(childResult.element);
      i = childResult.endIndex;
    } else {
      // Text content
      let textEnd = str.indexOf("<", i);
      if (textEnd === -1) textEnd = str.length;
      const text = str.slice(i, textEnd);
      if (text.trim()) {
        children.push(text.trim());
      }
      i = textEnd;
    }
  }

  // Safety net: Auto-add display: flex to divs with multiple children
  // The model should do this, but this prevents crashes if it forgets
  if (tagName === "div" && children.length > 1) {
    const style = (props.style as Record<string, unknown>) || {};
    if (!style.display) {
      console.warn(`[parseElement] Auto-adding display: flex to div with ${children.length} children (model should include this)`);
      props.style = { display: "flex", ...style };
    }
  }

  return {
    element: React.createElement(tagName, props, ...children),
    endIndex: i,
  };
}

/**
 * Parse CSS-like style string into object
 * e.g., "display: flex; padding: 20" -> { display: 'flex', padding: 20 }
 */
function parseStyleString(styleStr: string): Record<string, string | number> {
  const style: Record<string, string | number> = {};
  const parts = styleStr.split(";");

  for (const part of parts) {
    const colonIdx = part.indexOf(":");
    if (colonIdx === -1) continue;

    const key = part.slice(0, colonIdx).trim();
    const value = part.slice(colonIdx + 1).trim();

    // Convert camelCase
    const camelKey = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    // Try to parse as number
    const numVal = parseFloat(value);
    if (!isNaN(numVal) && /^\d+(\.\d+)?$/.test(value)) {
      style[camelKey] = numVal;
    } else {
      style[camelKey] = value;
    }
  }

  return style;
}

/**
 * Parse style object expression from JSX
 * e.g., "{ display: 'flex', padding: 20 }" -> { display: 'flex', padding: 20 }
 */
function parseStyleObject(expr: string): Record<string, string | number> {
  const style: Record<string, string | number> = {};

  // Remove outer braces if present (for {{ }})
  let cleaned = expr.trim();
  if (cleaned.startsWith("{")) cleaned = cleaned.slice(1);
  if (cleaned.endsWith("}")) cleaned = cleaned.slice(0, -1);

  // Simple regex-based parsing for key: value pairs
  // Match: key: 'value' or key: "value" or key: number
  const regex = /(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(\d+(?:\.\d+)?)|([a-zA-Z]+))/g;
  let match;

  while ((match = regex.exec(cleaned)) !== null) {
    const key = match[1];
    const stringValue = match[2] || match[3];
    const numValue = match[4];
    const identValue = match[5];

    if (stringValue !== undefined) {
      style[key] = stringValue;
    } else if (numValue !== undefined) {
      style[key] = parseFloat(numValue);
    } else if (identValue !== undefined) {
      style[key] = identValue;
    }
  }

  return style;
}

/**
 * Convert CSS style object values for Satori
 * - Strips 'px' suffix and converts to numbers
 * - Handles camelCase conversion from kebab-case
 */
function convertStyleForSatori(styleObj: Record<string, string>): Record<string, string | number> {
  const result: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(styleObj)) {
    if (value === undefined || value === null) continue;

    const strValue = String(value);

    // Convert pure numeric values to numbers (Satori expects numbers for dimensions)
    if (/^\d+(\.\d+)?$/.test(strValue)) {
      result[key] = parseFloat(strValue);
    }
    // Handle 'px' suffix - Satori prefers raw numbers
    else if (/^\d+(\.\d+)?px$/i.test(strValue)) {
      result[key] = parseFloat(strValue);
    }
    else {
      result[key] = strValue;
    }
  }

  return result;
}

/**
 * Count significant children (elements + non-whitespace text nodes)
 * Satori requires display: flex for divs with 2+ children of ANY kind
 */
function countSignificantChildren(children: DOMNode[] | undefined): number {
  if (!children) return 0;
  return children.filter((child) => {
    // Count elements
    if (child instanceof Element) return true;
    // Skip comments
    if (child.type === "comment") return false;
    // Count non-whitespace text nodes
    if ("data" in child && typeof child.data === "string") {
      return child.data.trim().length > 0;
    }
    return false;
  }).length;
}

/**
 * Filter out whitespace-only text nodes and comments from children
 * Satori counts ALL children including text nodes when checking display: flex requirement
 * HTML comments (<!-- -->) also need to be filtered out
 */
function filterWhitespaceChildren(children: DOMNode[]): DOMNode[] {
  return children.filter((child) => {
    // Keep elements
    if (child instanceof Element) return true;
    // Filter out comments (type === 'comment')
    if (child.type === "comment") return false;
    // Keep non-whitespace text nodes
    if ("data" in child && typeof child.data === "string") {
      return child.data.trim().length > 0;
    }
    return true;
  });
}

/**
 * Parse HTML string into React elements using html-react-parser
 * This is the new approach - LLMs generate standard HTML which is more reliable
 */
function parseHtmlToReact(htmlString: string): React.ReactElement {
  // Strip HTML comments - they cause issues with Satori's child counting
  const commentCount = (htmlString.match(/<!--[\s\S]*?-->/g) || []).length;
  let cleaned = htmlString.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (commentCount > 0) {
    console.log(`[parseHtmlToReact] Stripped ${commentCount} HTML comments`);
  }

  // Strip data:image URLs from HTML (both in src attributes and text content)
  // Only match the specific data:image/...;base64,... pattern to avoid false positives
  const base64TextPattern = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;
  const base64Matches = cleaned.match(base64TextPattern) || [];
  if (base64Matches.length > 0) {
    console.log(`[parseHtmlToReact] Stripping ${base64Matches.length} data:image URLs`);
    cleaned = cleaned.replace(base64TextPattern, "[IMAGE]");
  }

  if (!cleaned) {
    return React.createElement("div", null);
  }

  const options: HTMLReactParserOptions = {
    trim: true, // Remove whitespace text nodes to avoid Satori counting them as children
    replace: (domNode: DOMNode) => {
      if (domNode instanceof Element) {
        const childCount = countSignificantChildren(domNode.children as DOMNode[]);

        // Convert style attribute from CSS string to JS object
        if (domNode.attribs?.style) {
          try {
            const styleObj = styleToJS(domNode.attribs.style);
            const satoriStyle = convertStyleForSatori(styleObj as Record<string, string>);

            // Build new props with converted style
            const newAttribs: Record<string, unknown> = { ...domNode.attribs, style: satoriStyle };

            // Handle img tags - check for placeholders or base64 FIRST
            if (domNode.name === "img") {
              const src = domNode.attribs?.src || "";
              const width = parseInt(String(domNode.attribs?.width || 100), 10);
              const height = parseInt(String(domNode.attribs?.height || 100), 10);

              // Check if src is a placeholder ({{...}}), empty, base64 data URL, or [IMAGE] (from stripping)
              const placeholderMatch = src.match(/^\{\{([^}]+)\}\}$/);
              const isBase64 = src.startsWith("data:image/");
              const isStrippedPlaceholder = src === "[IMAGE]" || src.includes("[IMAGE]");
              const isPlaceholder = placeholderMatch || !src || src === "" || isBase64 || isStrippedPlaceholder;

              // Debug logging for img handling
              if (isBase64) {
                console.log(`[parseHtmlToReact] Converting base64 img to placeholder (${src.slice(0, 50)}...)`);
              } else if (isStrippedPlaceholder) {
                console.log(`[parseHtmlToReact] Converting [IMAGE] stripped placeholder to box`);
              } else if (placeholderMatch) {
                console.log(`[parseHtmlToReact] Found placeholder img: {{${placeholderMatch[1]}}}`);
              } else if (!src) {
                console.log(`[parseHtmlToReact] Found img with empty src`);
              }

              if (isPlaceholder) {
                // Render as a colored placeholder box with label
                const placeholderName = placeholderMatch ? placeholderMatch[1] : "IMAGE";
                return React.createElement(
                  "div",
                  {
                    style: {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width,
                      height,
                      backgroundColor: "#e5e7eb",
                      border: "2px dashed #9ca3af",
                      borderRadius: 4,
                      overflow: "hidden",
                    },
                  },
                  React.createElement(
                    "span",
                    {
                      style: {
                        fontSize: Math.min(12, Math.floor(width / 10)),
                        color: "#6b7280",
                        textAlign: "center",
                        padding: 4,
                        wordBreak: "break-all",
                      },
                    },
                    placeholderName
                  )
                );
              }

              // Real image - convert width/height to numbers
              if (newAttribs.width) {
                newAttribs.width = width as unknown as string;
              }
              if (newAttribs.height) {
                newAttribs.height = height as unknown as string;
              }
            }

            // Safety net: Satori requires display: flex/contents/none for divs with 2+ children
            if (domNode.name === "div" && childCount > 1) {
              const style = satoriStyle as Record<string, unknown>;
              const validDisplays = ["flex", "contents", "none"];
              if (!style.display || !validDisplays.includes(String(style.display))) {
                console.warn(`[parseHtmlToReact] Auto-adding display: flex to div with ${childCount} children (had: ${style.display || 'none'})`);
                (newAttribs.style as Record<string, unknown>).display = "flex";
              }
            }

            // Return the element with converted props
            // Filter whitespace children to prevent Satori from counting them
            const filteredChildren = filterWhitespaceChildren(domNode.children as DOMNode[]);
            const childResult = domToReact(filteredChildren, options);
            // IMPORTANT: domToReact returns an array that must be spread for React.createElement
            if (Array.isArray(childResult)) {
              return React.createElement(domNode.name, newAttribs, ...childResult);
            }
            return React.createElement(domNode.name, newAttribs, childResult);
          } catch (e) {
            console.warn(`[parseHtmlToReact] Failed to parse style: ${domNode.attribs.style}`, e);
            // Style parsing failed - still need to ensure divs get display: flex
            if (domNode.name === "div" && childCount > 1) {
              const newAttribs = { ...domNode.attribs };
              delete newAttribs.style; // Remove the unparsable style
              (newAttribs as Record<string, unknown>).style = { display: "flex" };
              console.warn(`[parseHtmlToReact] Added display: flex to div after style parse error`);
              const filteredChildren = filterWhitespaceChildren(domNode.children as DOMNode[]);
              const childResult = domToReact(filteredChildren, options);
              if (Array.isArray(childResult)) {
                return React.createElement(domNode.name, newAttribs, ...childResult);
              }
              return React.createElement(domNode.name, newAttribs, childResult);
            }
            // For non-divs or divs with 0-1 children, let it continue without style
          }
        }

        // Handle img tags - convert placeholders/base64 to colored boxes
        if (domNode.name === "img") {
          const src = domNode.attribs?.src || "";
          const width = parseInt(String(domNode.attribs?.width || 100), 10);
          const height = parseInt(String(domNode.attribs?.height || 100), 10);

          // Check if src is a placeholder ({{...}}), empty, base64 data URL, or [IMAGE] (from stripping)
          const placeholderMatch = src.match(/^\{\{([^}]+)\}\}$/);
          const isBase64 = src.startsWith("data:image/");
          const isStrippedPlaceholder = src === "[IMAGE]" || src.includes("[IMAGE]");
          const isPlaceholder = placeholderMatch || !src || src === "" || isBase64 || isStrippedPlaceholder;

          // Debug logging
          if (isBase64) {
            console.log(`[parseHtmlToReact] Converting base64 img (no style) to placeholder`);
          } else if (isStrippedPlaceholder) {
            console.log(`[parseHtmlToReact] Converting [IMAGE] stripped placeholder to box`);
          }

          if (isPlaceholder) {
            // Render as a colored placeholder box with label
            const placeholderName = placeholderMatch ? placeholderMatch[1] : "IMAGE";
            return React.createElement(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width,
                  height,
                  backgroundColor: "#e5e7eb",
                  border: "2px dashed #9ca3af",
                  borderRadius: 4,
                  overflow: "hidden",
                },
              },
              React.createElement(
                "span",
                {
                  style: {
                    fontSize: Math.min(12, Math.floor(width / 10)),
                    color: "#6b7280",
                    textAlign: "center",
                    padding: 4,
                    wordBreak: "break-all",
                  },
                },
                placeholderName
              )
            );
          }

          // Real image with actual src
          const newAttribs = { ...domNode.attribs };
          newAttribs.width = width as unknown as string;
          newAttribs.height = height as unknown as string;
          return React.createElement(domNode.name, newAttribs);
        }

        // Safety net for divs without style attribute
        if (domNode.name === "div" && childCount > 1) {
          const newAttribs = { ...domNode.attribs };
          if (!newAttribs.style) {
            console.warn(`[parseHtmlToReact] Auto-adding display: flex to div with ${childCount} children (no style attr)`);
            (newAttribs as Record<string, unknown>).style = { display: "flex" };
            const filteredChildren = filterWhitespaceChildren(domNode.children as DOMNode[]);
            const childResult = domToReact(filteredChildren, options);
            if (Array.isArray(childResult)) {
              return React.createElement(domNode.name, newAttribs, ...childResult);
            }
            return React.createElement(domNode.name, newAttribs, childResult);
          }
        }

        // For any other element, still filter whitespace children
        if (domNode.children && domNode.children.length > 0) {
          const filteredChildren = filterWhitespaceChildren(domNode.children as DOMNode[]);
          if (filteredChildren.length !== domNode.children.length) {
            // Only create custom element if we actually filtered something
            const newAttribs = { ...domNode.attribs };
            const childResult = domToReact(filteredChildren, options);
            if (Array.isArray(childResult)) {
              return React.createElement(domNode.name, newAttribs, ...childResult);
            }
            return React.createElement(domNode.name, newAttribs, childResult);
          }
        }
      }
      // Return undefined to use default behavior
      return undefined;
    },
  };

  const result = parse(cleaned, options);

  // Ensure we return a single React element
  if (Array.isArray(result)) {
    // Wrap multiple top-level elements in a flex container
    return React.createElement("div", { style: { display: "flex" } }, ...result);
  }

  if (typeof result === "string") {
    // Wrap plain text in a span
    return React.createElement("span", null, result);
  }

  return result as React.ReactElement;
}

/**
 * Detect whether content is JSX or HTML format
 * JSX uses style={{ ... }} while HTML uses style="..."
 */
function detectFormat(content: string): "jsx" | "html" {
  // JSX indicators: style={{ or style={
  if (/style=\{\{?/.test(content)) {
    console.log(`[detectFormat] Detected JSX format`);
    return "jsx";
  }
  // HTML uses style="..."
  console.log(`[detectFormat] Detected HTML format`);
  return "html";
}

/**
 * Parse content to React elements, auto-detecting format
 * Supports both legacy JSX strings and new HTML format
 */
function parseContentToReact(content: string): React.ReactElement {
  const format = detectFormat(content);
  if (format === "jsx") {
    return parseJsxToReact(content);
  }
  return parseHtmlToReact(content);
}

/**
 * Render a single page to SVG using Satori
 */
async function renderPageToSvg(
  bodyJsx: string,
  headerJsx: string | null,
  footerJsx: string | null,
  headerHeight: number,
  footerHeight: number,
  pageSize: PageSize,
  fonts: Awaited<ReturnType<typeof loadFonts>>
): Promise<string> {
  const { width, height } = pageSize;
  const bodyHeight = height - headerHeight - footerHeight;

  // Build the full page structure
  const pageChildren: React.ReactElement[] = [];

  // Header
  if (headerJsx) {
    const headerElement = parseContentToReact(headerJsx);
    pageChildren.push(
      React.createElement(
        "div",
        {
          key: "header",
          style: {
            width,
            height: headerHeight,
            display: "flex",
            flexShrink: 0,
          },
        },
        headerElement
      )
    );
  }

  // Body
  const bodyElement = parseContentToReact(bodyJsx);
  pageChildren.push(
    React.createElement(
      "div",
      {
        key: "body",
        style: {
          width,
          height: bodyHeight,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        },
      },
      bodyElement
    )
  );

  // Footer
  if (footerJsx) {
    const footerElement = parseContentToReact(footerJsx);
    pageChildren.push(
      React.createElement(
        "div",
        {
          key: "footer",
          style: {
            width,
            height: footerHeight,
            display: "flex",
            flexShrink: 0,
          },
        },
        footerElement
      )
    );
  }

  // Full page container
  const pageElement = React.createElement(
    "div",
    {
      style: {
        width,
        height,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "white",
      },
    },
    ...pageChildren
  );

  // Render to SVG using Satori
  const svg = await satori(pageElement, {
    width,
    height,
    fonts,
  });

  return svg;
}

/**
 * Convert SVG to PNG using sharp (more reliable than resvg for complex SVGs)
 */
async function svgToPngBuffer(svg: string, width: number): Promise<Buffer> {
  // Basic validation
  if (!svg || svg.length < 50 || !svg.includes('</svg>')) {
    const error = `Invalid SVG: ${!svg ? 'empty' : svg.length < 50 ? 'too short' : 'missing </svg> tag'}`;
    console.error(`[svgToPngBuffer] ${error}`);
    throw new Error(error);
  }

  const sizeMB = (svg.length / (1024 * 1024)).toFixed(2);
  console.log(`[svgToPngBuffer] Rendering SVG (${sizeMB}MB) at width ${width}`);

  // Extract viewBox dimensions to calculate height
  const viewBoxMatch = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const svgWidth = viewBoxMatch ? parseInt(viewBoxMatch[1], 10) : 794;
  const svgHeight = viewBoxMatch ? parseInt(viewBoxMatch[2], 10) : 1123;
  const scale = width / svgWidth;
  const height = Math.round(svgHeight * scale);

  // Use sharp to convert SVG to PNG
  const pngBuffer = await sharp(Buffer.from(svg))
    .resize(width, height, { fit: 'fill' })
    .png()
    .toBuffer();

  console.log(`[svgToPngBuffer] Rendered ${width}x${height} PNG (${(pngBuffer.length / 1024).toFixed(1)}KB)`);
  return pngBuffer;
}

/**
 * Combine multiple page PNGs into a single PDF
 */
async function combinePngsToPdf(
  pngBuffers: Buffer[],
  pageSize: PageSize
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();

  for (const pngBuffer of pngBuffers) {
    const pngImage = await pdfDoc.embedPng(pngBuffer);

    // Create page with correct dimensions (convert from 96 DPI to 72 DPI for PDF)
    const pdfWidth = (pageSize.width / 96) * 72;
    const pdfHeight = (pageSize.height / 96) * 72;

    const page = pdfDoc.addPage([pdfWidth, pdfHeight]);
    page.drawImage(pngImage, {
      x: 0,
      y: 0,
      width: pdfWidth,
      height: pdfHeight,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Main render function: SatoriDocument -> SVGs + PDF
 */
export async function renderSatoriDocument(
  doc: SatoriDocument,
  fields: Record<string, unknown> = {},
  assets: Record<string, string | null> = {},
  templateFonts?: TemplateFont[]
): Promise<RenderResult> {
  const fonts = await loadFonts(templateFonts);
  const pageSize = getPageDimensions(doc.pageSize);
  const totalPages = doc.pages.length;

  const headerHeight = doc.header?.height || 0;
  const footerHeight = doc.footer?.height || 0;

  const svgs: string[] = [];
  const pngBuffers: Buffer[] = [];

  for (let i = 0; i < doc.pages.length; i++) {
    const page = doc.pages[i];
    const pageNumber = i + 1;

    // Substitute placeholders in body
    const bodyJsx = substitutePlaceholders(
      page.body,
      fields,
      assets,
      pageNumber,
      totalPages
    );

    // Get header/footer (page override or default)
    let headerJsx: string | null = null;
    if (page.headerOverride) {
      headerJsx = substitutePlaceholders(
        page.headerOverride,
        fields,
        assets,
        pageNumber,
        totalPages
      );
    } else if (doc.header) {
      headerJsx = substitutePlaceholders(
        doc.header.content,
        fields,
        assets,
        pageNumber,
        totalPages
      );
    }

    let footerJsx: string | null = null;
    if (page.footerOverride) {
      footerJsx = substitutePlaceholders(
        page.footerOverride,
        fields,
        assets,
        pageNumber,
        totalPages
      );
    } else if (doc.footer) {
      footerJsx = substitutePlaceholders(
        doc.footer.content,
        fields,
        assets,
        pageNumber,
        totalPages
      );
    }

    // Render page to SVG
    const svg = await renderPageToSvg(
      bodyJsx,
      headerJsx,
      footerJsx,
      headerHeight,
      footerHeight,
      pageSize,
      fonts
    );
    svgs.push(svg);

    // Convert to PNG for PDF
    const pngBuffer = await svgToPngBuffer(svg, pageSize.width * 2); // 2x for quality
    pngBuffers.push(pngBuffer);
  }

  // Combine into PDF
  const pdfBuffer = await combinePngsToPdf(pngBuffers, pageSize);

  return { svgs, pdfBuffer, pngBuffers };
}

/**
 * Quick render a single page (for previews)
 */
export async function renderSatoriPage(
  bodyJsx: string,
  pageSize: PageSizeKey | PageSize = "A4",
  fields: Record<string, unknown> = {},
  assets: Record<string, string | null> = {},
  templateFonts?: TemplateFont[]
): Promise<{ svg: string; pngBuffer: Buffer }> {
  const fonts = await loadFonts(templateFonts);
  const size = getPageDimensions(pageSize);

  const substituted = substitutePlaceholders(bodyJsx, fields, assets, 1, 1);
  const svg = await renderPageToSvg(substituted, null, null, 0, 0, size, fonts);
  const pngBuffer = await svgToPngBuffer(svg, size.width * 2);

  return { svg, pngBuffer };
}
