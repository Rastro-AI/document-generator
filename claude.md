# Document Generator - Key Insights

## Chat-Based Template Editing ("Vibe Coding")

The chat API always uses the full template agent which can:
1. Update field values via `update_fields` tool
2. Make design changes via `update_satori_pages` tool
3. Render previews to check results via `render_preview` tool
4. Iterate and make tweaks based on what it sees

The agent has full autonomy - no need for separate "fields" vs "template" modes.

## Satori Template Generation (HTML approach)

The system generates PDF templates by having an LLM produce HTML that Satori converts to SVG, then to PNG/PDF.

### Why HTML beats JSX for LLM generation

- LLMs are trained on billions of HTML pages, not JSX
- HTML syntax is simpler: `style="display: flex"` vs `style={{ display: 'flex' }}`
- `{{PLACEHOLDER}}` syntax is unambiguous in HTML (no confusion with JSX braces)
- Use `html-react-parser` + `style-to-js` instead of fragile custom regex parsing

### Critical implementation details

1. **Always strip base64** - LLMs will sneak in `data:image/...;base64,...` URLs. Strip them with regex and replace with `[IMAGE]`

2. **Image placeholder handling** - Detect these in img src and convert to gray boxes:
   - `{{PLACEHOLDER_NAME}}` syntax
   - Empty or missing src
   - `[IMAGE]` (from base64 stripping)
   - Any remaining base64 data URLs

3. **Separate text vs image placeholders** - The asset detection regex must ONLY match image assets:
   ```typescript
   // CORRECT - suffix is required
   /\{\{([A-Z][A-Z0-9_]*(?:_IMAGE|_LOGO|_ICON|_PHOTO|_CHART))\}\}/g

   // WRONG - suffix is optional, matches ALL placeholders!
   /\{\{([A-Z][A-Z0-9_]*(?:_IMAGE|_LOGO|_ICON|_PHOTO|_CHART)?)\}\}/g
   ```

4. **Page size constraints** - Tell the LLM exact pixel dimensions in the prompt (A4 = 794×1123px at 96 DPI). Content beyond bounds gets cut off.

5. **Use Sharp not resvg** - Sharp handles edge cases in SVG→PNG conversion without panicking

### Template save/fill flow (Satori format)

1. **Generate**: `runTemplateGeneratorAgent()` returns `satoriPages` (HTML) and `templateJson` (metadata)
2. **Save**: PUT `/api/templates/{id}` with `satoriPages` saves:
   - `templates/{id}/template.json` - Template metadata with `format: "satori"`
   - `templates/{id}/satori-document.json` - The HTML pages
   - `templates/{id}/thumbnail.png` - Auto-generated preview
3. **Create job**: POST `/api/jobs` calls `copySatoriTemplateToJob()` to copy `satori-document.json` to job storage
4. **Fill & render**: POST `/api/jobs/{id}/render` loads `satori-document.json`, substitutes `{{PLACEHOLDER}}` values, renders to PDF

### Key files

- `src/lib/satori-renderer.ts` - HTML parsing, base64 stripping, placeholder conversion
- `src/lib/agents/template-generator.ts` - LLM agent with system prompts
- `src/lib/prompts/satori-document.ts` - HTML format instructions for LLM
- `src/lib/fs-utils.ts` - Template/job file operations including `copySatoriTemplateToJob()`
- `src/app/api/templates/[id]/route.ts` - Template save endpoint (handles Satori format)
