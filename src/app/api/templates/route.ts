import { NextResponse } from "next/server";
import { listTemplates } from "@/lib/fs-utils";

export async function GET() {
  try {
    const templates = await listTemplates();
    return NextResponse.json(templates);
  } catch (error) {
    console.error("Error listing templates:", error);
    return NextResponse.json(
      { error: "Failed to list templates" },
      { status: 500 }
    );
  }
}
