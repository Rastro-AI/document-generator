"use client";

import { useState } from "react";
import { CreateJobForm } from "@/components/CreateJobForm";
import { JobEditor } from "@/components/JobEditor";
import { Sidebar } from "@/components/Sidebar";

interface InitialJobData {
  jobId: string;
  prompt?: string;
  files?: { name: string; type: string }[];
}

export default function Home() {
  const [currentJob, setCurrentJob] = useState<InitialJobData | null>(null);
  const [showNewDocument, setShowNewDocument] = useState(true);

  if (currentJob) {
    return (
      <>
        <Sidebar onNewDocument={() => { setCurrentJob(null); setShowNewDocument(true); }} />
        <div className="lg:pl-64 h-screen flex flex-col transition-all duration-300">
          <JobEditor
            jobId={currentJob.jobId}
            onBack={() => setCurrentJob(null)}
            initialPrompt={currentJob.prompt}
            initialFiles={currentJob.files}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <Sidebar onNewDocument={() => setShowNewDocument(true)} />
      <div className="lg:pl-64 min-h-screen bg-[#f5f5f7] flex items-center justify-center p-6 transition-all duration-300">
        <div className="w-full max-w-2xl">
          {/* Brand */}
          <div className="text-center mb-10">
            <h1 className="text-[28px] font-semibold text-[#1d1d1f] tracking-tight">
              Document Workspace
            </h1>
            <p className="mt-2 text-[15px] text-[#86868b]">
              Generate spec sheets and manuals from raw data
            </p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-sm p-8 overflow-visible">
            <CreateJobForm onJobCreated={(jobId, prompt, files) => setCurrentJob({ jobId, prompt, files })} />
          </div>


        </div>
      </div>
    </>
  );
}
