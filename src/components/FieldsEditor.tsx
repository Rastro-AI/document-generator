"use client";

import { useRef } from "react";
import { Template, Job } from "@/lib/types";

interface FieldsEditorProps {
  template: Template;
  job: Job;
  localFields: Record<string, string | number | null>;
  onFieldChange: (name: string, value: string | number | null) => void;
  onAssetChange: (name: string, value: string | null) => void;
  onAssetUpload?: (name: string, file: File) => Promise<void>;
  onSave?: () => void;
  disabled?: boolean;
  activeTab?: "assets" | "data";
}

export function FieldsEditor({
  template,
  job,
  localFields,
  onFieldChange,
  onAssetChange,
  onAssetUpload,
  onSave,
  disabled,
  activeTab = "assets",
}: FieldsEditorProps) {
  // Group fields by category based on naming patterns
  const groupFields = () => {
    const groups: { [key: string]: typeof template.fields } = {
      "Product Info": [],
      "Electrical": [],
      "Performance": [],
      "Physical": [],
      "Other": [],
    };

    template.fields.forEach((field) => {
      const name = field.name.toUpperCase();
      if (name.includes("PRODUCT") || name.includes("MODEL") || name.includes("NAME") || name.includes("DESCRIPTION")) {
        groups["Product Info"].push(field);
      } else if (name.includes("VOLTAGE") || name.includes("WATTAGE") || name.includes("CURRENT") || name.includes("POWER") || name.includes("FREQUENCY")) {
        groups["Electrical"].push(field);
      } else if (name.includes("LUMEN") || name.includes("CRI") || name.includes("BEAM") || name.includes("DIMM") || name.includes("EFFICACY") || name.includes("COLOR") || name.includes("EQUIV")) {
        groups["Performance"].push(field);
      } else if (name.includes("TEMP") || name.includes("MOISTURE") || name.includes("MATERIAL") || name.includes("WEIGHT") || name.includes("HOUSING") || name.includes("LIFETIME") || name.includes("WARRANTY")) {
        groups["Physical"].push(field);
      } else {
        groups["Other"].push(field);
      }
    });

    return Object.entries(groups).filter(([, fields]) => fields.length > 0);
  };

  const fieldGroups = groupFields();
  const hasAssets = template.assetSlots && template.assetSlots.length > 0;

  return (
    <div className="space-y-6">
      {/* Assets Tab */}
      {activeTab === "assets" && (
        <>
          {hasAssets ? (
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] mb-3">
                Images
              </h3>
              <div className="space-y-3">
                {template.assetSlots.map((slot) => (
                  <AssetSlotInput
                    key={slot.name}
                    slot={slot}
                    value={job.assets[slot.name]}
                    jobId={job.id}
                    onChange={(value) => onAssetChange(slot.name, value)}
                    onUpload={onAssetUpload ? (file) => onAssetUpload(slot.name, file) : undefined}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-[13px] text-[#86868b]">No asset slots defined for this template</p>
            </div>
          )}
        </>
      )}

      {/* Data Tab */}
      {activeTab === "data" && (
        <>
          {fieldGroups.length > 0 ? (
            fieldGroups.map(([groupName, fields]) => (
              <div key={groupName}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] mb-3">
                  {groupName}
                </h3>
                <div className="space-y-3">
                  {fields.map((field) => {
                    // Use localFields for display (immediate updates), fall back to job.fields
                    const value = localFields[field.name] ?? job.fields[field.name];
                    const displayName = field.name
                      .replace(/_/g, " ")
                      .toLowerCase()
                      .replace(/\b\w/g, (c) => c.toUpperCase());

                    return (
                      <div key={field.name}>
                        <label
                          htmlFor={field.name}
                          className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5"
                        >
                          {displayName}
                        </label>
                        <input
                          id={field.name}
                          type={field.type === "number" ? "number" : "text"}
                          value={value ?? ""}
                          onChange={(e) => {
                            const newValue =
                              field.type === "number"
                                ? e.target.value === ""
                                  ? null
                                  : parseFloat(e.target.value)
                                : e.target.value || null;
                            onFieldChange(field.name, newValue);
                          }}
                          onBlur={() => {
                            // Auto-save when user leaves the field
                            if (onSave) onSave();
                          }}
                          disabled={disabled}
                          placeholder={field.description}
                          className="w-full px-3 py-2.5 bg-[#f5f5f7] border-0 rounded-lg text-[14px]
                                    text-[#1d1d1f] placeholder:text-[#86868b]
                                    focus:outline-none focus:ring-2 focus:ring-[#1d1d1f] focus:ring-offset-1
                                    disabled:opacity-50 disabled:cursor-not-allowed
                                    transition-shadow duration-200"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8">
              <p className="text-[13px] text-[#86868b]">No data fields defined for this template</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Asset slot input component
interface AssetSlotInputProps {
  slot: { name: string; kind: string; description: string };
  value: string | null;
  jobId: string;
  onChange: (value: string | null) => void;
  onUpload?: (file: File) => Promise<void>;
  disabled?: boolean;
}

function AssetSlotInput({ slot, value, jobId, onChange, onUpload, disabled }: AssetSlotInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const displayName = slot.name
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Extract just the filename from the path for display
  const displayValue = value ? (value.includes("/") ? value.split("/").pop() : value) : null;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUpload) {
      await onUpload(file);
    }
    // Reset the input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div>
      <label className="block text-[13px] font-medium text-[#1d1d1f] mb-1.5">
        {displayName}
        <span className="ml-1.5 text-[11px] font-normal text-[#86868b]">({slot.kind})</span>
      </label>
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={displayValue ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
            placeholder={slot.description || "No image assigned"}
            className="w-full px-3 py-2.5 pr-10 bg-[#f5f5f7] border-0 rounded-lg text-[14px]
                      text-[#1d1d1f] placeholder:text-[#86868b]
                      focus:outline-none focus:ring-2 focus:ring-[#1d1d1f] focus:ring-offset-1
                      disabled:opacity-50 disabled:cursor-not-allowed
                      transition-shadow duration-200"
          />
          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#86868b] hover:text-[#1d1d1f]
                        disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Clear"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {onUpload && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="px-3 py-2.5 bg-[#f5f5f7] rounded-lg text-[13px] font-medium text-[#1d1d1f]
                        hover:bg-[#e8e8ed] disabled:opacity-50 disabled:cursor-not-allowed
                        transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Upload
            </button>
          </>
        )}
      </div>
      {/* Show preview if there's an assigned image */}
      {value && (
        <div className="mt-2 p-2 bg-[#f5f5f7] rounded-lg">
          <img
            src={`/api/jobs/${jobId}/files/${encodeURIComponent(displayValue || "")}?type=asset`}
            alt={displayName}
            className="max-h-24 rounded object-contain mx-auto"
            onError={(e) => {
              // Hide the preview if image fails to load
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
    </div>
  );
}
