"use client";

import { useState, useRef, useEffect } from "react";
import {
  useAssets,
  useUploadAssets,
  useDeleteAsset,
  useCreateColor,
  useCreateFont,
  Asset,
  isFileAsset,
  isColorAsset,
  isFontAsset,
  ColorAsset,
  FontAsset,
} from "@/hooks/useAssetBank";
import { FontPicker } from "./FontPicker";
import { GoogleFont, GOOGLE_FONTS } from "@/lib/google-fonts";

interface BrandBankDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAssets: Asset[];
  onToggleAsset: (asset: Asset) => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}

type TabType = "colors" | "fonts" | "files";

export function BrandBankDropdown({
  isOpen,
  onClose,
  selectedAssets,
  onToggleAsset,
  anchorRef,
}: BrandBankDropdownProps) {
  const [activeTab, setActiveTab] = useState<TabType>("colors");
  const [showAddColor, setShowAddColor] = useState(false);
  const [showAddFont, setShowAddFont] = useState(false);
  const [newColor, setNewColor] = useState({ name: "", value: "#000000", usage: "" as ColorAsset["usage"] | "" });
  const [newFont, setNewFont] = useState({ name: "", family: "", weights: ["400"] as string[], usage: "" as FontAsset["usage"] | "" });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: assets, isLoading } = useAssets();
  const uploadAssets = useUploadAssets();
  const deleteAsset = useDeleteAsset();
  const createColor = useCreateColor();
  const createFont = useCreateFont();

  // Filter assets by type
  const colors = assets?.filter(isColorAsset) || [];
  const fonts = assets?.filter(isFontAsset) || [];
  const files = assets?.filter(isFileAsset) || [];

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  // Reset forms when closing
  useEffect(() => {
    if (!isOpen) {
      setShowAddColor(false);
      setShowAddFont(false);
      setNewColor({ name: "", value: "#000000", usage: "" });
      setNewFont({ name: "", family: "", weights: ["400"], usage: "" });
    }
  }, [isOpen]);

  const handleCreateColor = async () => {
    if (!newColor.name.trim() || !newColor.value) return;
    await createColor.mutateAsync({
      name: newColor.name.trim(),
      value: newColor.value,
      usage: newColor.usage || undefined,
    });
    setNewColor({ name: "", value: "#000000", usage: "" });
    setShowAddColor(false);
  };

  const handleCreateFont = async () => {
    if (!newFont.name.trim() || !newFont.family.trim()) return;
    await createFont.mutateAsync({
      name: newFont.name.trim(),
      family: newFont.family.trim(),
      weights: newFont.weights.length > 0 ? newFont.weights : ["400"],
      usage: newFont.usage || undefined,
    });
    setNewFont({ name: "", family: "", weights: ["400"], usage: "" });
    setShowAddFont(false);
  };

  const handleFontSelected = (font: GoogleFont) => {
    setNewFont(prev => ({
      ...prev,
      family: font.family,
      name: prev.name || font.family,
      weights: font.weights,
    }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await uploadAssets.mutateAsync(files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteAsset = async (e: React.MouseEvent, assetId: string) => {
    e.stopPropagation();
    await deleteAsset.mutateAsync(assetId);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={dropdownRef}
      className="absolute left-0 top-full mt-2 w-80 bg-white rounded-xl shadow-xl border border-[#e8e8ed] z-50 overflow-hidden"
    >
      {/* Tabs */}
      <div className="flex border-b border-[#e8e8ed]">
        {(["colors", "fonts", "files"] as TabType[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-3 py-2.5 text-[12px] font-medium capitalize transition-colors ${
              activeTab === tab
                ? "text-[#1d1d1f] border-b-2 border-[#1d1d1f] -mb-px"
                : "text-[#86868b] hover:text-[#1d1d1f]"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-80 overflow-y-auto">
        {/* Colors Tab */}
        {activeTab === "colors" && (
          <div className="p-3">
            {/* Existing colors */}
            {colors.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-3">
                {colors.map((color) => {
                  const isSelected = selectedAssets.some(a => a.id === color.id);
                  return (
                    <button
                      key={color.id}
                      type="button"
                      onClick={() => onToggleAsset(color)}
                      className={`group relative aspect-square rounded-lg transition-all ${
                        isSelected ? "ring-2 ring-[#1d1d1f] ring-offset-2" : "hover:ring-2 hover:ring-[#d2d2d7]"
                      }`}
                      style={{ backgroundColor: color.value }}
                      title={`${color.name}: ${color.value}`}
                    >
                      <button
                        type="button"
                        onClick={(e) => handleDeleteAsset(e, color.id)}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Add color form */}
            {showAddColor ? (
              <div className="space-y-2 p-2 bg-[#f5f5f7] rounded-lg">
                <div className="flex gap-2">
                  <input
                    type="color"
                    value={newColor.value}
                    onChange={(e) => setNewColor({ ...newColor, value: e.target.value })}
                    className="w-10 h-10 rounded cursor-pointer border border-[#e8e8ed]"
                  />
                  <div className="flex-1 space-y-1">
                    <input
                      type="text"
                      value={newColor.name}
                      onChange={(e) => setNewColor({ ...newColor, name: e.target.value })}
                      placeholder="Color name"
                      className="w-full px-2 py-1 text-[12px] bg-white rounded border-0 focus:outline-none focus:ring-1 focus:ring-[#1d1d1f]/20"
                    />
                    <select
                      value={newColor.usage}
                      onChange={(e) => setNewColor({ ...newColor, usage: e.target.value as ColorAsset["usage"] | "" })}
                      className="w-full px-2 py-1 text-[11px] bg-white rounded border-0 focus:outline-none"
                    >
                      <option value="">Usage (optional)</option>
                      <option value="primary">Primary</option>
                      <option value="secondary">Secondary</option>
                      <option value="accent">Accent</option>
                      <option value="text">Text</option>
                      <option value="background">Background</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddColor(false)}
                    className="flex-1 px-2 py-1 text-[11px] text-[#86868b] hover:text-[#1d1d1f]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateColor}
                    disabled={!newColor.name.trim() || createColor.isPending}
                    className="flex-1 px-2 py-1 text-[11px] font-medium text-white bg-[#1d1d1f] rounded hover:bg-black disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddColor(true)}
                className="w-full py-2 text-[12px] text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Color
              </button>
            )}
          </div>
        )}

        {/* Fonts Tab */}
        {activeTab === "fonts" && (
          <div className="p-3">
            {/* Existing fonts */}
            {fonts.length > 0 && (
              <div className="space-y-2 mb-3">
                {fonts.map((font) => {
                  const isSelected = selectedAssets.some(a => a.id === font.id);
                  return (
                    <button
                      key={font.id}
                      type="button"
                      onClick={() => onToggleAsset(font)}
                      className={`group w-full p-2 rounded-lg text-left transition-all flex items-center gap-2 ${
                        isSelected
                          ? "bg-[#1d1d1f] text-white"
                          : "bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f]"
                      }`}
                    >
                      <span className="text-lg font-semibold">Aa</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{font.name}</p>
                        <p className={`text-[10px] truncate ${isSelected ? "text-white/70" : "text-[#86868b]"}`}>
                          {font.family}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteAsset(e, font.id)}
                        className={`w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
                          isSelected ? "bg-white/20 hover:bg-white/30" : "bg-red-500"
                        }`}
                      >
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Add font form */}
            {showAddFont ? (
              <div className="space-y-2 p-2 bg-[#f5f5f7] rounded-lg">
                <FontPicker
                  value={newFont.family}
                  onChange={handleFontSelected}
                  placeholder="Search fonts..."
                />
                {newFont.family && (
                  <>
                    <input
                      type="text"
                      value={newFont.name}
                      onChange={(e) => setNewFont({ ...newFont, name: e.target.value })}
                      placeholder="Display name"
                      className="w-full px-2 py-1.5 text-[12px] bg-white rounded border-0 focus:outline-none focus:ring-1 focus:ring-[#1d1d1f]/20"
                    />
                    <div className="flex flex-wrap gap-1">
                      {(GOOGLE_FONTS.find(f => f.family === newFont.family)?.weights || ["400"]).map(weight => (
                        <button
                          key={weight}
                          type="button"
                          onClick={() => {
                            const isSelected = newFont.weights.includes(weight);
                            setNewFont({
                              ...newFont,
                              weights: isSelected
                                ? newFont.weights.filter(w => w !== weight)
                                : [...newFont.weights, weight],
                            });
                          }}
                          className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                            newFont.weights.includes(weight)
                              ? "bg-[#1d1d1f] text-white"
                              : "bg-white text-[#86868b] hover:bg-[#e8e8ed]"
                          }`}
                        >
                          {weight}
                        </button>
                      ))}
                    </div>
                    <select
                      value={newFont.usage}
                      onChange={(e) => setNewFont({ ...newFont, usage: e.target.value as FontAsset["usage"] | "" })}
                      className="w-full px-2 py-1.5 text-[11px] bg-white rounded border-0 focus:outline-none"
                    >
                      <option value="">Usage (optional)</option>
                      <option value="heading">Heading</option>
                      <option value="body">Body</option>
                      <option value="accent">Accent</option>
                    </select>
                  </>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddFont(false)}
                    className="flex-1 px-2 py-1 text-[11px] text-[#86868b] hover:text-[#1d1d1f]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleCreateFont}
                    disabled={!newFont.name.trim() || !newFont.family.trim() || createFont.isPending}
                    className="flex-1 px-2 py-1 text-[11px] font-medium text-white bg-[#1d1d1f] rounded hover:bg-black disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAddFont(true)}
                className="w-full py-2 text-[12px] text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Font
              </button>
            )}
          </div>
        )}

        {/* Files Tab */}
        {activeTab === "files" && (
          <div className="p-3">
            {/* Existing files */}
            {files.length > 0 && (
              <div className="grid grid-cols-4 gap-2 mb-3">
                {files.map((file) => {
                  const isSelected = selectedAssets.some(a => a.id === file.id);
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => onToggleAsset(file)}
                      className={`group relative aspect-square rounded-lg overflow-hidden transition-all ${
                        isSelected ? "ring-2 ring-[#1d1d1f] ring-offset-2" : "hover:ring-2 hover:ring-[#d2d2d7]"
                      }`}
                    >
                      {file.type === "image" ? (
                        <img
                          src={`/api/assets/${file.id}`}
                          alt={file.filename}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-[#f5f5f7] flex items-center justify-center">
                          <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteAsset(e, file.id)}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Upload button */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadAssets.isPending}
              className="w-full py-2 text-[12px] text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] rounded-lg transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {uploadAssets.isPending ? "Uploading..." : "Upload File"}
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="p-6 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-[#1d1d1f] border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
