"use client";

import { useState, useRef } from "react";
import { useAssets, useUploadAssets, Asset } from "@/hooks/useAssetBank";

interface AssetBankModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAssets: Asset[];
  onToggleAsset: (asset: Asset) => void;
}

type TabType = "assets" | "integrations";

// Asset metadata - could be extended from a config file
const assetMetadata: Record<string, { category: string; description: string; tags: string[] }> = {
  "ul-logo.png": {
    category: "Certifications",
    description: "UL Listed certification mark",
    tags: ["certification", "safety", "UL"],
  },
  "etl-listed-us-mark.png": {
    category: "Certifications",
    description: "ETL Listed US certification mark",
    tags: ["certification", "safety", "ETL"],
  },
  "energy-star-logo.png": {
    category: "Certifications",
    description: "Energy Star certification logo",
    tags: ["certification", "energy", "efficiency"],
  },
  "fcc-logo.png": {
    category: "Certifications",
    description: "FCC compliance mark",
    tags: ["certification", "compliance", "FCC"],
  },
};

// Directory structure for organization
const directories = [
  { id: "all", name: "All Assets", icon: "folder" },
  { id: "certifications", name: "Certifications", icon: "shield" },
  { id: "logos", name: "Company Logos", icon: "star" },
  { id: "product", name: "Product Images", icon: "photo" },
];

export function AssetBankModal({ isOpen, onClose, selectedAssets, onToggleAsset }: AssetBankModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("assets");
  const [activeDirectory, setActiveDirectory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const assetInputRef = useRef<HTMLInputElement>(null);

  const { data: assets, isLoading: assetsLoading } = useAssets();
  const uploadAssets = useUploadAssets();

  const handleAssetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      await uploadAssets.mutateAsync(selectedFiles);
    }
    if (assetInputRef.current) {
      assetInputRef.current.value = "";
    }
  };

  const getAssetCategory = (filename: string): string => {
    return assetMetadata[filename]?.category || "Uncategorized";
  };

  const filteredAssets = assets?.filter((asset) => {
    const matchesSearch = searchQuery === "" ||
      asset.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      assetMetadata[asset.filename]?.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesDirectory = activeDirectory === "all" ||
      getAssetCategory(asset.filename).toLowerCase() === activeDirectory;

    return matchesSearch && matchesDirectory;
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-[720px] max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e8ed]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0066CC] to-[#0055AA] flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
            </div>
            <div>
              <h2 className="text-[17px] font-semibold text-[#1d1d1f]">Asset Bank</h2>
              <p className="text-[12px] text-[#86868b]">Reusable assets for your documents</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-[#f5f5f7] transition-colors"
          >
            <svg className="w-5 h-5 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#e8e8ed] px-6">
          <button
            type="button"
            onClick={() => setActiveTab("assets")}
            className={`px-4 py-3 text-[14px] font-medium border-b-2 transition-colors ${
              activeTab === "assets"
                ? "border-[#0066CC] text-[#0066CC]"
                : "border-transparent text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            Assets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("integrations")}
            className={`px-4 py-3 text-[14px] font-medium border-b-2 transition-colors ${
              activeTab === "integrations"
                ? "border-[#0066CC] text-[#0066CC]"
                : "border-transparent text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            Integrations
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {activeTab === "assets" ? (
            <>
              {/* Sidebar - Directory Structure */}
              <div className="w-48 border-r border-[#e8e8ed] bg-[#fafafa] p-3 flex flex-col gap-1">
                {directories.map((dir) => (
                  <button
                    key={dir.id}
                    type="button"
                    onClick={() => setActiveDirectory(dir.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[13px] transition-colors ${
                      activeDirectory === dir.id
                        ? "bg-[#0066CC]/10 text-[#0066CC] font-medium"
                        : "text-[#1d1d1f] hover:bg-[#f0f0f0]"
                    }`}
                  >
                    {dir.icon === "folder" && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                      </svg>
                    )}
                    {dir.icon === "shield" && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                      </svg>
                    )}
                    {dir.icon === "star" && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                      </svg>
                    )}
                    {dir.icon === "photo" && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                      </svg>
                    )}
                    {dir.name}
                  </button>
                ))}
              </div>

              {/* Main Content */}
              <div className="flex-1 flex flex-col">
                {/* Search + Upload */}
                <div className="p-4 border-b border-[#e8e8ed] flex items-center gap-3">
                  <div className="flex-1 relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search assets..."
                      className="w-full pl-10 pr-4 py-2 text-[13px] bg-[#f5f5f7] rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-[#0066CC]/30"
                    />
                  </div>
                  <input
                    ref={assetInputRef}
                    type="file"
                    multiple
                    accept=".xlsx,.xlsm,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={handleAssetUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => assetInputRef.current?.click()}
                    disabled={uploadAssets.isPending}
                    className="px-4 py-2 text-[13px] font-medium text-white bg-[#0066CC] rounded-lg hover:bg-[#0055AA] transition-colors disabled:opacity-50"
                  >
                    {uploadAssets.isPending ? "Uploading..." : "Upload"}
                  </button>
                </div>

                {/* Asset Grid */}
                <div className="flex-1 overflow-y-auto p-4">
                  {assetsLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="text-[13px] text-[#86868b]">Loading assets...</div>
                    </div>
                  ) : !filteredAssets || filteredAssets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <svg className="w-12 h-12 text-[#d2d2d7] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                      </svg>
                      <p className="text-[13px] text-[#86868b]">No assets found</p>
                      <p className="text-[12px] text-[#aeaeb2] mt-1">Upload files to add them to your asset bank</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-4">
                      {filteredAssets.map((asset) => {
                        const isSelected = selectedAssets.some(a => a.id === asset.id);
                        const metadata = assetMetadata[asset.filename];
                        return (
                          <button
                            key={asset.id}
                            type="button"
                            onClick={() => onToggleAsset(asset)}
                            className={`group relative bg-white rounded-xl border-2 overflow-hidden transition-all hover:shadow-lg ${
                              isSelected
                                ? "border-[#0066CC] ring-4 ring-[#0066CC]/10"
                                : "border-[#e8e8ed] hover:border-[#d2d2d7]"
                            }`}
                          >
                            {/* Image Preview */}
                            <div className="aspect-square bg-[#f5f5f7] flex items-center justify-center p-4">
                              {asset.type === "image" ? (
                                <img
                                  src={`/api/assets/${asset.id}`}
                                  alt={asset.filename}
                                  className="max-w-full max-h-full object-contain"
                                />
                              ) : (
                                <svg className="w-10 h-10 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                              )}
                            </div>

                            {/* Metadata */}
                            <div className="p-3 border-t border-[#e8e8ed]">
                              <p className="text-[12px] font-medium text-[#1d1d1f] truncate">{asset.filename}</p>
                              {metadata && (
                                <>
                                  <p className="text-[11px] text-[#86868b] mt-0.5">{metadata.description}</p>
                                  <div className="flex flex-wrap gap-1 mt-2">
                                    {metadata.tags.slice(0, 3).map((tag) => (
                                      <span
                                        key={tag}
                                        className="px-1.5 py-0.5 text-[9px] font-medium bg-[#f5f5f7] text-[#86868b] rounded"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>

                            {/* Selection indicator */}
                            {isSelected && (
                              <div className="absolute top-2 right-2 w-6 h-6 bg-[#0066CC] rounded-full flex items-center justify-center shadow-md">
                                <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Integrations Tab */
            <div className="flex-1 p-6">
              <div className="max-w-lg mx-auto">
                <div className="text-center mb-8">
                  <div className="w-16 h-16 rounded-2xl bg-[#f5f5f7] flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.193-9.193a4.5 4.5 0 00-6.364 6.364l4.5 4.5a4.5 4.5 0 007.244 1.242" />
                    </svg>
                  </div>
                  <h3 className="text-[17px] font-semibold text-[#1d1d1f]">Connect Your Services</h3>
                  <p className="text-[13px] text-[#86868b] mt-1">Sync assets from your favorite platforms</p>
                </div>

                <div className="space-y-3">
                  {/* Google Drive */}
                  <div className="flex items-center justify-between p-4 bg-[#f5f5f7] rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                        <svg className="w-6 h-6" viewBox="0 0 24 24">
                          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-[#1d1d1f]">Google Drive</p>
                        <p className="text-[12px] text-[#86868b]">Sync files from Drive</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-4 py-2 text-[13px] font-medium text-[#0066CC] bg-white rounded-lg border border-[#e8e8ed] hover:bg-[#f5f5f7] transition-colors"
                    >
                      Connect
                    </button>
                  </div>

                  {/* Dropbox */}
                  <div className="flex items-center justify-between p-4 bg-[#f5f5f7] rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="#0061FF">
                          <path d="M6 2l6 3.75L6 9.5 0 5.75 6 2zm12 0l6 3.75-6 3.75-6-3.75L18 2zM0 13.25L6 9.5l6 3.75-6 3.75-6-3.75zm18-3.75l6 3.75-6 3.75-6-3.75 6-3.75zM6 18.25l6-3.75 6 3.75-6 3.75-6-3.75z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-[#1d1d1f]">Dropbox</p>
                        <p className="text-[12px] text-[#86868b]">Import from Dropbox</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-4 py-2 text-[13px] font-medium text-[#0066CC] bg-white rounded-lg border border-[#e8e8ed] hover:bg-[#f5f5f7] transition-colors"
                    >
                      Connect
                    </button>
                  </div>

                  {/* Figma */}
                  <div className="flex items-center justify-between p-4 bg-[#f5f5f7] rounded-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                          <path fill="#F24E1E" d="M8 24c2.2 0 4-1.8 4-4v-4H8c-2.2 0-4 1.8-4 4s1.8 4 4 4z"/>
                          <path fill="#A259FF" d="M4 12c0-2.2 1.8-4 4-4h4v8H8c-2.2 0-4-1.8-4-4z"/>
                          <path fill="#F24E1E" d="M4 4c0-2.2 1.8-4 4-4h4v8H8C5.8 8 4 6.2 4 4z"/>
                          <path fill="#FF7262" d="M12 0h4c2.2 0 4 1.8 4 4s-1.8 4-4 4h-4V0z"/>
                          <path fill="#1ABCFE" d="M20 12c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4z"/>
                        </svg>
                      </div>
                      <div>
                        <p className="text-[14px] font-medium text-[#1d1d1f]">Figma</p>
                        <p className="text-[12px] text-[#86868b]">Export from Figma</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="px-4 py-2 text-[13px] font-medium text-[#0066CC] bg-white rounded-lg border border-[#e8e8ed] hover:bg-[#f5f5f7] transition-colors"
                    >
                      Connect
                    </button>
                  </div>
                </div>

                <p className="text-center text-[12px] text-[#aeaeb2] mt-6">
                  More integrations coming soon
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab === "assets" && selectedAssets.length > 0 && (
          <div className="px-6 py-4 border-t border-[#e8e8ed] bg-[#fafafa] flex items-center justify-between">
            <span className="text-[13px] text-[#86868b]">
              {selectedAssets.length} asset{selectedAssets.length !== 1 ? "s" : ""} selected
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-[14px] font-medium text-white bg-[#0066CC] rounded-lg hover:bg-[#0055AA] transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
