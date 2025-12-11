import { NextRequest, NextResponse } from "next/server";
import { getJob, getUploadedFile } from "@/lib/fs-utils";
import * as XLSX from "xlsx";

// GET - Render XLSX/CSV as HTML table
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string; filename: string }> }
) {
  try {
    const { jobId, filename } = await params;
    const decodedFilename = decodeURIComponent(filename);

    const job = await getJob(jobId);
    if (!job) {
      return new NextResponse("Job not found", { status: 404 });
    }

    // Find the file
    const uploadedFile = job.uploadedFiles?.find((f) => f.filename === decodedFilename);
    if (!uploadedFile) {
      return new NextResponse("File not found", { status: 404 });
    }

    const fileBuffer = await getUploadedFile(jobId, decodedFilename);
    if (!fileBuffer) {
      return new NextResponse("File not found in storage", { status: 404 });
    }

    // Parse the spreadsheet
    const workbook = XLSX.read(fileBuffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON for rendering
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

    // Build HTML table
    let html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      padding: 16px;
      background: white;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
    }
    th, td {
      border: 1px solid #e8e8ed;
      padding: 8px 12px;
      text-align: left;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      background: #f5f5f7;
      font-weight: 600;
      color: #1d1d1f;
      position: sticky;
      top: 0;
    }
    tr:nth-child(even) {
      background: #fafafa;
    }
    tr:hover {
      background: #f0f0f5;
    }
    .sheet-name {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #1d1d1f;
    }
  </style>
</head>
<body>
  <div class="sheet-name">${sheetName}</div>
  <table>
`;

    // First row as header
    if (data.length > 0) {
      html += "<thead><tr>";
      for (const cell of data[0]) {
        html += `<th>${escapeHtml(String(cell ?? ""))}</th>`;
      }
      html += "</tr></thead>";
    }

    // Rest as body (limit to 100 rows for preview)
    html += "<tbody>";
    for (let i = 1; i < Math.min(data.length, 101); i++) {
      html += "<tr>";
      for (const cell of data[i]) {
        html += `<td>${escapeHtml(String(cell ?? ""))}</td>`;
      }
      html += "</tr>";
    }
    if (data.length > 101) {
      html += `<tr><td colspan="${data[0]?.length || 1}" style="text-align:center;color:#86868b;font-style:italic;">... and ${data.length - 101} more rows</td></tr>`;
    }
    html += "</tbody></table></body></html>";

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Error previewing file:", error);
    return new NextResponse(`Error: ${error}`, { status: 500 });
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
