"use client";

interface PdfPreviewProps {
  jobId: string;
  renderedAt?: string;
  isRendering?: boolean;
}

export function PdfPreview({ jobId, renderedAt, isRendering }: PdfPreviewProps) {
  if (isRendering) {
    return (
      <div className="flex items-center justify-center h-full bg-white rounded-2xl shadow-sm">
        <div className="text-center px-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#f5f5f7] flex items-center justify-center">
            <svg className="animate-spin h-8 w-8 text-[#1d1d1f]" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
          </div>
          <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">
            Generating PDF...
          </p>
        </div>
      </div>
    );
  }

  if (!renderedAt) {
    return (
      <div className="flex items-center justify-center h-full bg-white rounded-2xl shadow-sm">
        <div className="text-center px-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#f5f5f7] flex items-center justify-center">
            <svg
              className="w-8 h-8 text-[#86868b]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
              />
            </svg>
          </div>
          <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">
            Preparing preview...
          </p>
        </div>
      </div>
    );
  }

  // Use iframe with PDF.js viewer parameters to hide controls
  const pdfUrl = `/api/jobs/${jobId}/pdf?t=${renderedAt}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;

  return (
    <div className="h-full rounded-2xl overflow-hidden bg-white shadow-sm">
      <iframe
        key={renderedAt}
        src={pdfUrl}
        className="w-full h-full"
        style={{ border: 0 }}
        title="PDF Preview"
      />
    </div>
  );
}
