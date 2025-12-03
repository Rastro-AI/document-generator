import { NextRequest, NextResponse } from "next/server";
import { getTemplate } from "@/lib/fs-utils";
import { getTemplateRoot } from "@/lib/paths";
import { renderToBuffer } from "@react-pdf/renderer";

// Import the template's render function (hardcoded for now)
import { render } from "../../../../../../templates/sunco-spec-v1/template";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get the template
    const template = await getTemplate(id);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // For now, we only support the sunco-spec-v1 template
    if (id !== "sunco-spec-v1") {
      return NextResponse.json(
        { error: "Preview not available for this template" },
        { status: 400 }
      );
    }

    // Generate placeholder values from template fields
    const fields: Record<string, string | string[]> = {};
    for (const field of template.fields) {
      if (field.type === "string[]") {
        fields[field.name] = [`{{${field.name}[0]}}`, `{{${field.name}[1]}}`];
      } else {
        fields[field.name] = `{{${field.name}}}`;
      }
    }

    // Generate empty/placeholder assets
    const assets: Record<string, string | undefined> = {};
    for (const slot of template.assetSlots) {
      assets[slot.name] = undefined;
    }

    // Get template root for font loading
    const templateRoot = getTemplateRoot(id);

    // Render the PDF using the template's render function
    const document = render(fields as never, assets as never, templateRoot);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(document as any);

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("Error generating preview:", error);
    return NextResponse.json(
      { error: "Failed to generate preview", details: String(error) },
      { status: 500 }
    );
  }
}
