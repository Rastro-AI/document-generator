/**
 * Satori Document Generation Prompt
 * Based on official Satori docs: https://github.com/vercel/satori
 *
 * Uses standard HTML with inline CSS - LLMs are much better at generating HTML than JSX
 */

export const SATORI_DOCUMENT_PROMPT = `
## SATORI HTML RENDERING

Satori renders HTML to SVG using Flexbox layout.
Write standard HTML with inline CSS styles.

**CRITICAL: Any div with 2+ children MUST have display: flex**

### Page Wrapper (A4 = 794×1123px at 96 DPI)
\`\`\`html
<div style="display: flex; flex-direction: column; width: 794px; height: 1123px; padding: 40px; background-color: #fff">
  <div>Your content here</div>
</div>
\`\`\`

### Supported Elements
\`div\`, \`span\`, \`p\`, \`img\` (with width/height attrs), \`svg\`

### Supported CSS Properties
- **Layout**: display (flex/none), flex-direction, flex-wrap, align-items, justify-content, gap
- **Size**: width, height, min-width, max-width, min-height, max-height
- **Spacing**: padding, margin (and directional variants like padding-left, margin-top)
- **Text**: font-size, font-weight, font-family, line-height, letter-spacing, text-align, text-transform, text-decoration, text-overflow, white-space, word-break
- **Colors**: color, background-color (hex/rgb only, no images)
- **Border**: border, border-radius, border-width, border-color, border-style (solid/dashed)
- **Effects**: box-shadow, opacity, filter, transform (translate, rotate, scale, skew)
- **Position**: position (relative/absolute), top, right, bottom, left
- **Other**: object-fit, object-position, overflow, clip-path, mask

### NOT Supported
- \`display: grid\` or \`display: table\` - use flexbox
- \`position: fixed/sticky\` - only relative/absolute
- \`calc()\` or \`var()\` - use fixed values
- \`z-index\` - later elements paint on top
- \`animation\`, \`transition\`
- HTML: \`<table>\`, \`<ul>\`, \`<li>\`, \`<a>\`, \`<input>\`, \`<button>\`
- HSL colors - use hex or rgb/rgba
- **CRITICAL: Never use base64 data URLs in style attributes** - use \`<img src="{{PLACEHOLDER}}">\` instead
- **CRITICAL: Never use background-image with URLs** - use \`<img>\` tags for all images

---

## PLACEHOLDERS

Use {{PLACEHOLDER}} syntax for all dynamic content:

Text placeholders:
\`\`\`html
<div style="font-size: 24px; font-weight: 700">{{PRODUCT_NAME}}</div>
<div style="font-size: 14px">{{DESCRIPTION}}</div>
\`\`\`

Image/Asset placeholders (NEVER use data:image or literal URLs):
\`\`\`html
<img src="{{PRODUCT_IMAGE}}" width="200" height="150" style="object-fit: cover" />
<img src="{{COMPANY_LOGO}}" width="120" height="40" />
\`\`\`

---

## DOCUMENT FORMAT

\`\`\`typescript
{
  pageSize: 'A4' | 'LETTER' | 'LEGAL',
  header?: { height: number, content: "<div>...</div>" },
  footer?: { height: number, content: "<div>...</div>" },
  pages: [{ body: "<div>...</div>" }]
}
\`\`\`

Page sizes: A4 (794×1123), LETTER (816×1056), LEGAL (816×1344)
Header/footer variables: {{pageNumber}}, {{totalPages}}, {{date}}, {{dateFormatted}}

---

## COMMON PATTERNS

### Table
\`\`\`html
<div style="display: flex; flex-direction: column; border: 1px solid #e5e7eb; border-radius: 8px">
  <div style="display: flex; background-color: #f9fafb; border-bottom: 1px solid #e5e7eb">
    <div style="flex: 1; padding: 12px; font-weight: 600">Header</div>
    <div style="flex: 1; padding: 12px; font-weight: 600">Value</div>
  </div>
  <div style="display: flex; border-bottom: 1px solid #e5e7eb">
    <div style="flex: 1; padding: 12px">{{FIELD_1}}</div>
    <div style="flex: 1; padding: 12px">{{VALUE_1}}</div>
  </div>
</div>
\`\`\`

### Two Columns
\`\`\`html
<div style="display: flex; gap: 32px">
  <div style="display: flex; flex: 1; flex-direction: column">Left content</div>
  <div style="display: flex; flex: 1; flex-direction: column">Right content</div>
</div>
\`\`\`

### Bullet List
\`\`\`html
<div style="display: flex; gap: 8px; align-items: flex-start">
  <div style="width: 6px; height: 6px; border-radius: 3px; background-color: #3b82f6; margin-top: 6px"></div>
  <div style="flex: 1">{{FEATURE_1}}</div>
</div>
\`\`\`

### Divider
\`\`\`html
<div style="height: 1px; background-color: #e5e7eb; margin-top: 16px; margin-bottom: 16px"></div>
\`\`\`

---

## IMAGES

Images need width and height ATTRIBUTES (not just style):
\`\`\`html
<img src="{{PRODUCT_IMAGE}}" width="200" height="150" style="object-fit: cover; border-radius: 8px" />
\`\`\`

---

## TIPS
- ALWAYS add \`display: flex\` to any div with 2+ children
- Use \`flex-direction: column\` for vertical stacking (default is row)
- Use \`flex: 1\` to fill available space
- Colors: hex (#ffffff) or rgb/rgba, NOT hsl
- CSS properties use kebab-case (font-size, not fontSize)
- Values can include units (20px) or be unitless
`.trim();

/**
 * Get the full prompt with field definitions for a specific template
 */
export function getSatoriPromptWithFields(
  fields: Array<{ name: string; type: string; description: string }>,
  assetSlots: Array<{ name: string; description: string }>
): string {
  const fieldList = fields.map(f => `- {{${f.name}}} (${f.type}): ${f.description}`).join("\n");
  const assetList = assetSlots.map(a => `- {{${a.name}}}: ${a.description}`).join("\n");

  return `${SATORI_DOCUMENT_PROMPT}

---

## TEMPLATE FIELDS (use these placeholders)

${fieldList}

## ASSET PLACEHOLDERS (for images)

${assetList}
`;
}
