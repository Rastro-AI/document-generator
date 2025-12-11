"use client";

import { useState } from "react";
import { CreateJobForm } from "@/components/CreateJobForm";
import { JobEditor } from "@/components/JobEditor";
import { Sidebar } from "@/components/Sidebar";

type ReasoningMode = "none" | "low";

interface InitialJobData {
  jobId: string;
  templateId: string;
  prompt?: string;
  files?: File[];
  assetIds?: string[];
  reasoningMode?: ReasoningMode;
}

export default function Home() {
  const [currentJob, setCurrentJob] = useState<InitialJobData | null>(null);
  const [showNewDocument, setShowNewDocument] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

  if (currentJob) {
    return (
      <>
        <Sidebar
          onNewDocument={() => { setCurrentJob(null); setShowNewDocument(true); }}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        <div className={`h-screen flex flex-col transition-all duration-300 ${sidebarCollapsed ? "lg:pl-16" : "lg:pl-64"}`}>
          <JobEditor
            jobId={currentJob.jobId}
            templateId={currentJob.templateId}
            onBack={() => setCurrentJob(null)}
            initialPrompt={currentJob.prompt}
            initialFiles={currentJob.files}
            initialAssetIds={currentJob.assetIds}
            initialReasoningMode={currentJob.reasoningMode}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Sidebar
        onNewDocument={() => setShowNewDocument(true)}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />
      <div className={`min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 transition-all duration-300 ${sidebarCollapsed ? "lg:pl-16" : "lg:pl-64"}`}>
        <div className="w-full max-w-2xl">
          {/* Brand */}
          <div className="text-center mb-10">
            <h1 className="text-[28px] font-semibold text-[#1d1d1f] tracking-tight">
              Document Workspace
            </h1>
            <p className="mt-2 text-[15px] text-[#86868b]">
              Generate and fill PDF documents.
            </p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm p-8 overflow-visible">
            <CreateJobForm onJobCreated={(data) => setCurrentJob(data)} />
          </div>


        </div>
      </div>
    </>
  );
}
