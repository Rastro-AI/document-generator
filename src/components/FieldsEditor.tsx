"use client";

import { Template, Job } from "@/lib/types";

interface FieldsEditorProps {
  template: Template;
  job: Job;
  onFieldChange: (name: string, value: string | number | null) => void;
  disabled?: boolean;
}

export function FieldsEditor({
  template,
  job,
  onFieldChange,
  disabled,
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

  return (
    <div className="space-y-6">
      {fieldGroups.map(([groupName, fields]) => (
        <div key={groupName}>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#86868b] mb-3">
            {groupName}
          </h3>
          <div className="space-y-3">
            {fields.map((field) => {
              const value = job.fields[field.name];
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
      ))}
    </div>
  );
}
