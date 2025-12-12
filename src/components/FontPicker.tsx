"use client";

import { useState, useRef, useEffect } from "react";
import { GOOGLE_FONTS, GoogleFont, searchFonts } from "@/lib/google-fonts";

interface FontPickerProps {
  value: string;
  onChange: (font: GoogleFont) => void;
  placeholder?: string;
}

export function FontPicker({ value, onChange, placeholder = "Search fonts..." }: FontPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredFonts = searchFonts(search);
  const selectedFont = GOOGLE_FONTS.find(f => f.family === value);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex(prev => Math.min(prev + 1, filteredFonts.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex(prev => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (filteredFonts[highlightedIndex]) {
          handleSelect(filteredFonts[highlightedIndex]);
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = (font: GoogleFont) => {
    onChange(font);
    setSearch("");
    setIsOpen(false);
  };

  const categoryLabel = (cat: GoogleFont["category"]) => {
    const labels: Record<GoogleFont["category"], string> = {
      "sans-serif": "Sans",
      "serif": "Serif",
      "display": "Display",
      "handwriting": "Script",
      "monospace": "Mono",
    };
    return labels[cat];
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Input / Selected Display */}
      <div
        className={`flex items-center gap-2 px-3 py-2 bg-[#f5f5f7] rounded-lg cursor-text transition-all ${
          isOpen ? "ring-2 ring-[#1d1d1f]/20" : ""
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(true);
          inputRef.current?.focus();
        }}
      >
        {isOpen ? (
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-[13px] text-[#1d1d1f] placeholder-[#86868b] outline-none"
            autoFocus
          />
        ) : (
          <span className={`flex-1 text-[13px] ${value ? "text-[#1d1d1f]" : "text-[#86868b]"}`}>
            {selectedFont ? selectedFont.family : placeholder}
          </span>
        )}
        <svg
          className={`w-4 h-4 text-[#86868b] transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={listRef}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute left-0 top-full mt-1 min-w-full w-72 bg-white rounded-lg shadow-xl border border-[#e8e8ed] max-h-64 overflow-y-auto z-[100]"
        >
          {filteredFonts.length === 0 ? (
            <div className="px-3 py-3 text-[13px] text-[#86868b]">No fonts found</div>
          ) : (
            filteredFonts.map((font, index) => (
              <button
                key={font.family}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(font);
                }}
                className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-3 transition-colors ${
                  index === highlightedIndex ? "bg-[#f5f5f7]" : "hover:bg-[#f5f5f7]"
                } ${font.family === value ? "bg-[#1d1d1f] text-white hover:bg-[#1d1d1f]" : "text-[#1d1d1f]"}`}
              >
                <span className="text-[13px] font-medium">{font.family}</span>
                <span className={`text-[11px] flex-shrink-0 ${font.family === value ? "text-white/70" : "text-[#86868b]"}`}>
                  {categoryLabel(font.category)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
