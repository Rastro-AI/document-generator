"use client";

import { useState, useRef } from "react";
import { useAssets, useUploadAssets, Asset } from "@/hooks/useAssetBank";

interface AssetBankModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAssets: Asset[];
  onToggleAsset: (asset: Asset) => void;
}

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
  "dlc-logo.webp": {
    category: "Certifications",
    description: "DesignLights Consortium (DLC) certification",
    tags: ["certification", "lighting", "DLC", "efficiency"],
  },
  "rohs-logo.jpg": {
    category: "Certifications",
    description: "RoHS compliance mark",
    tags: ["certification", "compliance", "RoHS", "environmental"],
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
        className="relative bg-white rounded-2xl shadow-2xl w-[720px] h-[600px] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8e8ed]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1d1d1f] flex items-center justify-center">
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

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
              {/* Sidebar - Directory Structure */}
              <div className="w-48 border-r border-[#e8e8ed] bg-[#fafafa] p-3 flex flex-col gap-1">
                {directories.map((dir) => (
                  <button
                    key={dir.id}
                    type="button"
                    onClick={() => setActiveDirectory(dir.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[13px] transition-colors ${
                      activeDirectory === dir.id
                        ? "bg-[#1d1d1f]/10 text-[#1d1d1f] font-medium"
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
                      className="w-full pl-10 pr-4 py-2 text-[13px] bg-[#f5f5f7] rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]/20"
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
                    className="px-4 py-2 text-[13px] font-medium text-white bg-[#1d1d1f] rounded-lg hover:bg-[#000] transition-colors disabled:opacity-50"
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
                                ? "border-[#1d1d1f] ring-4 ring-[#1d1d1f]/10"
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
                              <div className="absolute top-2 right-2 w-6 h-6 bg-[#1d1d1f] rounded-full flex items-center justify-center shadow-md">
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
        </div>

        {/* Footer */}
        {selectedAssets.length > 0 && (
          <div className="px-6 py-4 border-t border-[#e8e8ed] bg-[#fafafa] flex items-center justify-between">
            <span className="text-[13px] text-[#86868b]">
              {selectedAssets.length} asset{selectedAssets.length !== 1 ? "s" : ""} selected
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 text-[14px] font-medium text-white bg-[#1d1d1f] rounded-lg hover:bg-[#000] transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
