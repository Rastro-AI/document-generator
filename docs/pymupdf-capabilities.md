# PyMuPDF: What It Can and Can't Do

A practical guide to understanding PDF manipulation with PyMuPDF (fitz) in the context of document template generation.

---

## Table of Contents

1. [What is a PDF, Really?](#what-is-a-pdf-really)
2. [What is PyMuPDF?](#what-is-pymupdf)
3. [What PyMuPDF CAN Do](#what-pymupdf-can-do)
4. [What PyMuPDF CANNOT Do](#what-pymupdf-cannot-do)
5. [Key Concepts](#key-concepts)
6. [Common Patterns in Our System](#common-patterns-in-our-system)

---

## What is a PDF, Really?

Think of a PDF like a **finished painting** rather than an editable document:

```
┌─────────────────────────────────────────────────────────┐
│  PDF = A Canvas with "painted" elements                 │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  "Hello World"  ← Text is drawn, not typed       │   │
│  │  ────────────   ← Lines are vector paths         │   │
│  │  [  IMAGE  ]    ← Images are embedded blobs      │   │
│  │  ┌─────────┐    ← Shapes are filled paths        │   │
│  │  │  Box   │                                      │   │
│  │  └─────────┘                                     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**Key insight**: Unlike Word or Google Docs, PDFs don't have "paragraphs" or "text boxes" that you can select and edit. They have:

- **Glyphs**: Individual character shapes positioned at exact coordinates
- **Paths**: Vector lines and curves (for shapes, underlines, borders)
- **Images**: Embedded raster data
- **Annotations**: Overlay elements (comments, form fields, highlights)

---

## What is PyMuPDF?

PyMuPDF (imported as `fitz`) is a Python library that can **read and manipulate PDFs**. It works by:

1. **Parsing** the PDF's internal structure
2. **Extracting** content (text, images, vectors)
3. **Modifying** the PDF's drawing commands
4. **Re-rendering** to create a new PDF

```python
import fitz

# Open a PDF
doc = fitz.open("document.pdf")
page = doc[0]  # First page

# Do things...

doc.save("output.pdf")
doc.close()
```

---

## What PyMuPDF CAN Do

### ✅ 1. Add Text to a Page

You can insert new text at any position:

```python
page.insert_text(
    (100, 200),           # Position (x, y) from TOP-LEFT
    "Hello World",
    fontname="helv",      # Built-in font
    fontsize=12,
    color=(0, 0, 0)       # RGB, 0-1 scale
)
```

**Gotcha**: Coordinates start from TOP-LEFT corner, not bottom-left like some PDF libraries.

```
(0,0) ─────────────────→ x
  │
  │   (100, 200) = 100 pixels right, 200 pixels DOWN
  │
  ↓
  y
```

### ✅ 2. Add Images

Insert images at specific locations:

```python
rect = fitz.Rect(50, 100, 250, 300)  # (x0, y0, x1, y1)
page.insert_image(rect, filename="photo.png")
# OR
page.insert_image(rect, stream=image_bytes)
```

### ✅ 3. Draw Shapes

Draw rectangles, circles, lines:

```python
# White rectangle (useful for "erasing")
shape = page.new_shape()
shape.draw_rect(fitz.Rect(100, 100, 300, 200))
shape.finish(color=None, fill=(1, 1, 1))  # White fill
shape.commit()

# Line
shape = page.new_shape()
shape.draw_line((0, 100), (500, 100))
shape.finish(color=(0, 0, 0), width=1)
shape.commit()
```

### ✅ 4. REDACT Content (True Removal)

This is the **proper way to remove content** from a PDF:

```python
# Mark area for redaction
rect = fitz.Rect(100, 100, 300, 150)
page.add_redact_annot(rect, fill=(1, 1, 1))  # White fill after removal

# Apply ALL redactions (this actually removes the content)
page.apply_redactions()
```

**What redaction does:**
1. Finds all content that overlaps the redaction area
2. **Permanently removes** that content from the PDF
3. Optionally fills the area with a color

**Why it matters:** Redaction removes the actual PDF commands, not just covers them up. A white rectangle drawn on top still leaves the original content in the file.

### ✅ 5. Extract Text and Positions

Get text with precise locations:

```python
# Get text blocks with positions
blocks = page.get_text("dict")["blocks"]
for block in blocks:
    if "lines" in block:
        for line in block["lines"]:
            for span in line["spans"]:
                print(f"Text: {span['text']}")
                print(f"Position: {span['bbox']}")
                print(f"Font: {span['font']}, Size: {span['size']}")
```

### ✅ 6. Extract and Analyze Vector Graphics (Lines/Shapes)

Get all drawn paths:

```python
paths = page.get_drawings()
for path in paths:
    print(f"Type: {path['type']}")  # 's' = stroke, 'f' = fill
    print(f"Color: {path['color']}")
    print(f"Rect: {path['rect']}")

    for item in path['items']:
        if item[0] == 'l':  # line
            print(f"Line from {item[1]} to {item[2]}")
        elif item[0] == 're':  # rectangle
            print(f"Rectangle: {item[1]}")
```

### ✅ 7. Work with Form Fields (AcroForms)

If the PDF has form fields:

```python
# List all form fields
for widget in page.widgets():
    print(f"Field: {widget.field_name}")
    print(f"Type: {widget.field_type}")
    print(f"Value: {widget.field_value}")

# Fill a field
widget = page.first_widget
widget.field_value = "New Value"
widget.update()
```

---

## What PyMuPDF CANNOT Do

### ❌ 1. "Edit" Existing Text In-Place

You **cannot** do something like:

```python
# THIS DOES NOT EXIST
page.find_text("Hello").replace_with("Goodbye")
```

**Why?** Text in PDFs is just positioned glyphs. There's no "text object" to edit.

**Workaround**:
1. Redact (remove) the original text
2. Insert new text at the same position

```python
# Find the text
text_instances = page.search_for("Hello")
for rect in text_instances:
    # Remove it
    page.add_redact_annot(rect, fill=(1, 1, 1))
page.apply_redactions()

# Add replacement
page.insert_text((rect.x0, rect.y1), "Goodbye", fontsize=12)
```

### ❌ 2. Selectively Remove One Specific Line

You **cannot** do:

```python
# THIS DOES NOT EXIST
page.remove_line(from_point=(0, 100), to_point=(500, 100))
```

**Why?** Lines are part of path objects that might contain multiple drawing commands.

**Workaround**: Redact the area where the line exists, then redraw any content you want to keep:

```python
# Find lines in an area
paths = page.get_drawings()
for path in paths:
    if path['rect'].y0 >= 95 and path['rect'].y1 <= 105:  # Line near y=100
        page.add_redact_annot(path['rect'])

page.apply_redactions()
```

### ❌ 3. Change Fonts of Existing Text

You **cannot** change the font of text that's already in the PDF.

**Why?** The font is baked into the glyph definitions.

**Workaround**: Redact and re-insert with new font.

### ❌ 4. Reflow Text

If you remove a word from a paragraph, the remaining text won't "reflow" to fill the gap.

**Why?** PDFs don't have paragraphs - they have positioned glyphs.

### ❌ 5. Edit Embedded Images

You cannot apply filters, crop, or edit images within the PDF.

**Workaround**: Extract the image, edit it externally, redact the original, insert the new version.

### ❌ 6. Guarantee Perfect Font Matching

When inserting new text, you may not have the exact font used in the original PDF.

**Common issue**: The original uses "Helvetica Neue" but you only have "Helvetica".

---

## Key Concepts

### Coordinate System

PyMuPDF uses **TOP-LEFT origin**:

```
(0, 0) ────────────────────────► x (width)
   │
   │    (100, 50) means:
   │    • 100 pixels from left edge
   │    • 50 pixels from TOP edge
   │
   ▼
   y (height)
```

**Page dimensions:**
```python
width = page.rect.width   # e.g., 612 for US Letter
height = page.rect.height # e.g., 792 for US Letter
```

### Bounding Boxes (Rects)

A `fitz.Rect` defines a rectangle:

```python
rect = fitz.Rect(x0, y0, x1, y1)
#                │   │   │   │
#                │   │   │   └── bottom y
#                │   │   └────── right x
#                │   └────────── top y
#                └────────────── left x

# Useful properties
rect.width   # x1 - x0
rect.height  # y1 - y0
rect.x0, rect.y0  # Top-left corner
rect.x1, rect.y1  # Bottom-right corner
```

### The Redaction Workflow

Redaction is a two-step process:

```python
# Step 1: MARK areas for redaction (can mark multiple)
page.add_redact_annot(rect1, fill=(1, 1, 1))
page.add_redact_annot(rect2, fill=(1, 1, 1))
page.add_redact_annot(rect3)  # No fill = transparent

# Step 2: APPLY all redactions at once
page.apply_redactions()
# This is when content actually gets removed!
```

**Important**: You must call `apply_redactions()` for anything to actually be removed.

---

## Common Patterns in Our System

### Pattern 1: Creating a "Blank" Base Template

Remove variable content (names, dates, etc.) while keeping structure:

```python
import fitz

doc = fitz.open("filled_form.pdf")
page = doc[0]

# Areas to blank out (where dynamic content goes)
regions_to_blank = [
    fitz.Rect(100, 200, 300, 220),  # Name field
    fitz.Rect(100, 250, 200, 270),  # Date field
]

# Redact each region
for rect in regions_to_blank:
    page.add_redact_annot(rect, fill=(1, 1, 1))

page.apply_redactions()
doc.save("blank_template.pdf")
```

### Pattern 2: Filling a Template

Add text and images to specific positions:

```python
import fitz

doc = fitz.open("blank_template.pdf")
page = doc[0]

# Add text
page.insert_text(
    (100, 215),  # Position (baseline of text)
    "John Smith",
    fontname="helv",
    fontsize=12
)

# Add image
photo_rect = fitz.Rect(400, 100, 500, 200)
page.insert_image(photo_rect, filename="photo.jpg")

doc.save("filled_document.pdf")
```

### Pattern 3: Removing Decorative Lines

When a form has lines you don't want:

```python
import fitz

doc = fitz.open("form.pdf")
page = doc[0]

# Get all vector drawings
paths = page.get_drawings()

# Find horizontal lines in a specific area
for path in paths:
    rect = fitz.Rect(path['rect'])

    # Check if it's a thin horizontal line in our target area
    if (rect.height < 3 and           # Thin
        rect.y0 > 200 and rect.y0 < 210 and  # In target y range
        rect.width > 100):             # Reasonably long

        # Redact with some padding
        padded = fitz.Rect(
            rect.x0 - 2, rect.y0 - 2,
            rect.x1 + 2, rect.y1 + 2
        )
        page.add_redact_annot(padded, fill=(1, 1, 1))

page.apply_redactions()
doc.save("cleaned_form.pdf")
```

### Pattern 4: Multi-line Text

PyMuPDF's `insert_text` is single-line. For multi-line:

```python
def insert_multiline_text(page, pos, text, fontsize=12, max_width=200):
    """Insert text that wraps at max_width."""
    x, y = pos
    line_height = fontsize * 1.2

    words = text.split()
    current_line = ""

    for word in words:
        test_line = f"{current_line} {word}".strip()
        # Approximate width (proper way: use get_text_length)
        if len(test_line) * fontsize * 0.5 > max_width:
            # Write current line
            page.insert_text((x, y), current_line, fontsize=fontsize)
            y += line_height
            current_line = word
        else:
            current_line = test_line

    # Write last line
    if current_line:
        page.insert_text((x, y), current_line, fontsize=fontsize)
```

---

## Summary

| Task | Can Do? | How |
|------|---------|-----|
| Add new text | ✅ | `page.insert_text()` |
| Add images | ✅ | `page.insert_image()` |
| Draw shapes | ✅ | `page.new_shape()` |
| Remove content | ✅ | `page.add_redact_annot()` + `apply_redactions()` |
| Extract text | ✅ | `page.get_text()` |
| Find vector paths | ✅ | `page.get_drawings()` |
| Edit text in-place | ❌ | Must redact + re-insert |
| Change fonts | ❌ | Must redact + re-insert |
| Reflow paragraphs | ❌ | N/A - PDFs don't have paragraphs |
| Edit embedded images | ❌ | Must extract, edit externally, re-insert |

**Golden Rule**: Think of PDF editing as "erase and redraw", not "select and modify".
