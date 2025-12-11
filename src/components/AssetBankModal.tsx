"use client";

import { useState, useRef } from "react";
import { useAssets, useUploadAssets, useDeleteAsset, Asset } from "@/hooks/useAssetBank";

interface AssetBankModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAssets: Asset[];
  onToggleAsset: (asset: Asset) => void;
}

interface UploadDialogFile {
  file: File;
  customName: string;
}

export function AssetBankModal({ isOpen, onClose, selectedAssets, onToggleAsset }: AssetBankModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadDialogFiles, setUploadDialogFiles] = useState<UploadDialogFile[] | null>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);

  const { data: assets, isLoading: assetsLoading } = useAssets();
  const uploadAssets = useUploadAssets();
  const deleteAsset = useDeleteAsset();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      // Open naming dialog with files
      setUploadDialogFiles(
        selectedFiles.map((file) => ({
          file,
          customName: file.name.replace(/\.[^/.]+$/, ""), // Remove extension for editing
        }))
      );
    }
    if (assetInputRef.current) {
      assetInputRef.current.value = "";
    }
  };

  const handleUploadConfirm = async () => {
    if (!uploadDialogFiles) return;

    // Create files with custom names
    const filesToUpload = uploadDialogFiles.map(({ file, customName }) => {
      const ext = file.name.match(/\.[^/.]+$/)?.[0] || "";
      const newName = customName + ext;
      return new File([file], newName, { type: file.type });
    });

    await uploadAssets.mutateAsync(filesToUpload);
    setUploadDialogFiles(null);
  };

  const handleUploadCancel = () => {
    setUploadDialogFiles(null);
  };

  const handleDeleteAsset = async (e: React.MouseEvent, assetId: string) => {
    e.stopPropagation();
    if (confirm("Delete this asset?")) {
      await deleteAsset.mutateAsync(assetId);
    }
  };

  const filteredAssets = assets?.filter((asset) => {
    return searchQuery === "" ||
      asset.filename.toLowerCase().includes(searchQuery.toLowerCase());
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
        <div className="flex-1 overflow-hidden flex flex-col">
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
              accept=".xlsx,.xlsm,.xls,.csv,.pdf,.png,.jpg,.jpeg,.gif,.webp,.svg"
              onChange={handleFileSelect}
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
              <div className="grid grid-cols-4 gap-3">
                {filteredAssets.map((asset) => {
                  const isSelected = selectedAssets.some(a => a.id === asset.id);
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => onToggleAsset(asset)}
                      className={`group relative bg-white rounded-lg border-2 overflow-hidden transition-all hover:shadow-md ${
                        isSelected
                          ? "border-[#1d1d1f] ring-2 ring-[#1d1d1f]/10"
                          : "border-[#e8e8ed] hover:border-[#d2d2d7]"
                      }`}
                    >
                      {/* Image Preview */}
                      <div className="aspect-square bg-[#f5f5f7] flex items-center justify-center p-3">
                        {asset.type === "image" ? (
                          <img
                            src={`/api/assets/${asset.id}`}
                            alt={asset.filename}
                            className="max-w-full max-h-full object-contain"
                          />
                        ) : (
                          <svg className="w-8 h-8 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                      </div>

                      {/* Filename */}
                      <div className="px-2 py-1.5 border-t border-[#e8e8ed]">
                        <p className="text-[11px] text-[#1d1d1f] truncate">{asset.filename}</p>
                      </div>

                      {/* Delete button - visible on hover */}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteAsset(e, asset.id)}
                        className="absolute top-1 right-1 w-6 h-6 bg-red-500 rounded-full items-center justify-center shadow-md opacity-0 group-hover:opacity-100 transition-opacity hidden group-hover:flex"
                        title="Delete asset"
                      >
                        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>

                      {/* Selection indicator */}
                      {isSelected && (
                        <div className="absolute top-1 left-1 w-5 h-5 bg-[#1d1d1f] rounded-full flex items-center justify-center shadow-md">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
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

      {/* Upload Naming Dialog */}
      {uploadDialogFiles && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={handleUploadCancel}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-[400px] max-h-[500px] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-[#e8e8ed]">
              <h3 className="text-[15px] font-semibold text-[#1d1d1f]">
                Name {uploadDialogFiles.length === 1 ? "Asset" : "Assets"}
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {uploadDialogFiles.map((item, index) => {
                const ext = item.file.name.match(/\.[^/.]+$/)?.[0] || "";
                return (
                  <div key={index} className="flex items-center gap-3">
                    {/* Preview */}
                    <div className="w-12 h-12 bg-[#f5f5f7] rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {item.file.type.startsWith("image/") ? (
                        <img
                          src={URL.createObjectURL(item.file)}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                    </div>
                    {/* Name input */}
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={item.customName}
                          onChange={(e) => {
                            const newFiles = [...uploadDialogFiles];
                            newFiles[index].customName = e.target.value;
                            setUploadDialogFiles(newFiles);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !uploadAssets.isPending && uploadDialogFiles.every(f => f.customName.trim())) {
                              handleUploadConfirm();
                            }
                          }}
                          className="flex-1 px-3 py-2 text-[13px] bg-[#f5f5f7] rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]/20"
                          placeholder="Asset name"
                        />
                        <span className="text-[12px] text-[#86868b]">{ext}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-4 border-t border-[#e8e8ed] flex justify-end gap-2">
              <button
                type="button"
                onClick={handleUploadCancel}
                className="px-4 py-2 text-[13px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadConfirm}
                disabled={uploadAssets.isPending || uploadDialogFiles.some(f => !f.customName.trim())}
                className="px-4 py-2 text-[13px] font-medium text-white bg-[#1d1d1f] rounded-lg hover:bg-[#000] transition-colors disabled:opacity-50"
              >
                {uploadAssets.isPending ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
