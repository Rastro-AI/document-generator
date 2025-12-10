# PDF Coordinate Systems and Libraries

## Overview

This document explains the coordinate systems used by different PDF libraries and why we chose PyMuPDF for PDF manipulation in this project.

## Coordinate System Differences

### PyMuPDF (fitz) - TOP-LEFT Origin
- **Origin**: Top-left corner of the page
- **Y-axis**: Increases downward (y=0 at top, y=792 at bottom for letter size)
- **Used by**: Template schema coordinates, PDF analysis, redaction

```
(0,0) -----> X
  |
  |
  v
  Y
```

### pdf-lib - BOTTOM-LEFT Origin (Native PDF)
- **Origin**: Bottom-left corner of the page
- **Y-axis**: Increases upward (y=0 at bottom, y=792 at top for letter size)
- **Used by**: Some rendering operations

```
  Y
  ^
  |
  |
(0,0) -----> X
```

### Conversion Formula
When converting from TOP-LEFT (PyMuPDF/schema) to BOTTOM-LEFT (pdf-lib):
```
pdf_lib_y = page_height - pymupdf_y - element_height
```

## Why PyMuPDF?

### 1. True Redaction Support
PyMuPDF's `add_redact_annot()` with `fill=False` **actually removes** content from the PDF without filling with any color. This is critical for:
- Removing text on colored backgrounds (gray rows in spec sheets)
- Removing images without leaving white rectangles
- Creating clean templates where new content can be placed

**pdf-lib limitation**: Can only draw shapes over content. Drawing white rectangles leaves visible artifacts on non-white backgrounds.

### 2. Consistent Coordinate System
PyMuPDF uses the same TOP-LEFT origin for:
- Reading text positions (`page.get_text("dict")`)
- Reading image positions (`page.get_image_rects()`)
- Drawing/inserting content (`page.insert_text()`, `page.insert_image()`)
- Redaction (`page.add_redact_annot()`)

This consistency eliminates coordinate conversion errors.

### 3. Rich PDF Analysis
PyMuPDF provides detailed information about PDF content:
```python
# Get all text with exact positions, fonts, sizes
text_dict = page.get_text("dict")
for block in text_dict["blocks"]:
    if block["type"] == 0:  # text
        for line in block["lines"]:
            for span in line["spans"]:
                # span["text"], span["bbox"], span["font"], span["size"]

# Get all images with positions
for img in page.get_images(full=True):
    xref = img[0]
    rects = page.get_image_rects(xref)
```

### 4. Direct PDF Editing
PyMuPDF can modify PDFs in place:
- Remove specific content (redaction)
- Add text at exact positions
- Insert images in rectangles
- Draw shapes and lines

## Architecture Decision

### Template Generation (AI Agent)
The AI agent uses PyMuPDF via code_interpreter to:
1. Analyze the PDF structure
2. Identify dynamic vs static content
3. Output coordinates in TOP-LEFT format (native to PyMuPDF)

### Schema Format
All coordinates in `schema.json` use TOP-LEFT origin:
```json
{
  "bbox": {
    "x": 28.35,      // from left edge
    "y": 113.09,     // from TOP edge
    "width": 294.74,
    "height": 17.33
  }
}
```

### Rendering Pipeline
1. **Blanking** (`pdf-analyzer.ts`): Uses PyMuPDF redaction with `fill=False`
2. **Filling** (`pdf-filler-pymupdf.ts`): Uses PyMuPDF for redaction + content insertion
3. **Preview** (`pdf-filler.ts`): Uses pdf-lib (requires coordinate conversion)

## Common Pitfalls

### Wrong Coordinate Origin
If placeholders appear in wrong positions, check:
1. Is the schema using TOP-LEFT coordinates?
2. Is the rendering code expecting TOP-LEFT or BOTTOM-LEFT?
3. Is coordinate conversion being applied correctly (or incorrectly)?

### White Rectangles on Colored Backgrounds
If you see white rectangles where content was removed:
- **Cause**: Using pdf-lib's `drawRectangle()` instead of PyMuPDF redaction
- **Fix**: Use `page.add_redact_annot(rect, fill=False)` with PyMuPDF

### Redaction Not Working
PyMuPDF redaction requires two steps:
```python
# Step 1: Add redaction annotations
page.add_redact_annot(rect, fill=False)

# Step 2: Apply all redactions (actually removes content)
page.apply_redactions()
```

Forgetting `apply_redactions()` leaves content intact.

## File Reference

| File | Library | Coordinate System | Purpose |
|------|---------|-------------------|---------|
| `pdf-analyzer.ts` | PyMuPDF | TOP-LEFT | Blank regions for preview |
| `pdf-filler-pymupdf.ts` | PyMuPDF | TOP-LEFT | Fill templates with content |
| `pdf-filler.ts` | pdf-lib | BOTTOM-LEFT (converts) | Legacy preview generation |
| `template-generator.ts` | PyMuPDF (via agent) | TOP-LEFT | AI analyzes/edits PDFs |
