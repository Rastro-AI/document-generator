"use client";

import { useState } from "react";
import { BookOpen, Workflow, Camera, TrendingUp, Database, FileText, Lock, ChevronDown } from "lucide-react";

interface SidebarProps {
  onNewDocument?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

const sidebarItems = [
  {
    path: "/catalog",
    label: "Catalog",
    icon: BookOpen,
    isPremium: false,
  },
  {
    path: "/flows",
    label: "Flows",
    icon: Workflow,
    isPremium: false,
  },
  {
    path: "/photo-studio",
    label: "Photo Studio",
    icon: Camera,
    isPremium: false,
  },
  {
    path: "/pricing",
    label: "Pricing",
    icon: TrendingUp,
    isPremium: false,
  },
  {
    path: "/sources",
    label: "Integrations",
    icon: Database,
    isPremium: true,
  },
  {
    path: "/documents",
    label: "Documents",
    icon: FileText,
    isPremium: false,
    isActive: true, // This is the current app
  },
];

export function Sidebar({ onNewDocument, collapsed: controlledCollapsed, onCollapsedChange }: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(true);

  // Use controlled state if provided, otherwise use internal state
  const collapsed = controlledCollapsed !== undefined ? controlledCollapsed : internalCollapsed;
  const setCollapsed = (value: boolean) => {
    if (onCollapsedChange) {
      onCollapsedChange(value);
    } else {
      setInternalCollapsed(value);
    }
  };

  return (
    <div
      className={`hidden lg:fixed lg:inset-y-0 lg:flex z-30 transition-all duration-300 ${
        collapsed ? "lg:w-16" : "lg:w-64"
      }`}
    >
      <div className="flex flex-col flex-grow bg-white border-r border-slate-200 h-full shadow-sm rounded-r-2xl">
        {/* Sidebar header - Organization Switcher */}
        <div
          className={`flex items-center ${
            collapsed ? "justify-center h-16 px-2" : "justify-between h-16 px-2"
          }`}
        >
          <div className={`${collapsed ? "w-full" : "flex items-center w-full"}`}>
            <div className={`${collapsed ? "w-full flex justify-center" : "flex-1 min-w-0"}`}>
              {/* Org Switcher */}
              {!collapsed ? (
                <button className="flex items-center w-full px-2 py-2 rounded-lg hover:bg-slate-100 transition-colors">
                  <div className="w-8 h-8 bg-[#0817EC] rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg width="18" height="18" viewBox="0 0 656 656" fill="none">
                      <path
                        d="M259.891 249.609C167.663 278.785 119.681 228.948 124.306 134.828C126.734 111.779 143.355 104.998 165.763 104.744C217.019 104.089 277.821 104.681 328.423 104.491C433.195 99.0821 526.274 144 528.323 250.962C529.217 297.629 511.822 341.869 482.741 376.813C465.487 397.77 468.908 417.503 481.559 438.989C494.821 463.179 517.018 493.791 528.274 518.446C540.418 543.206 528.401 549.903 500.904 551.594C473.047 552.988 438.18 552.946 409.859 551.678C387.916 550.896 370.007 543.164 363.101 521.594C353.492 496.199 346.079 464.615 327.684 442.749C313.851 424.348 281.982 408.545 266.121 430.538C241.602 462.946 298.898 527.065 265.657 546.227C242.806 555.481 182.785 555.143 162.257 544.495C137.484 530.467 144.981 488.678 143.566 463.812C144.284 430.622 141.919 396.714 149.311 364.073C180.863 215.933 379.574 374.447 415.329 268.729C418.729 246.715 398.729 229.771 378.581 225.652C337.356 216.462 299.574 238.666 259.976 249.588L259.891 249.609Z"
                        fill="white"
                      />
                    </svg>
                  </div>
                  <div className="ml-3 flex-1 text-left min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">Rastro demo</p>
                    <p className="text-xs text-slate-500 truncate">Organization</p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                </button>
              ) : (
                <div className="w-8 h-8 bg-[#0817EC] rounded-lg flex items-center justify-center mx-auto">
                  <svg width="18" height="18" viewBox="0 0 656 656" fill="none">
                    <path
                      d="M259.891 249.609C167.663 278.785 119.681 228.948 124.306 134.828C126.734 111.779 143.355 104.998 165.763 104.744C217.019 104.089 277.821 104.681 328.423 104.491C433.195 99.0821 526.274 144 528.323 250.962C529.217 297.629 511.822 341.869 482.741 376.813C465.487 397.77 468.908 417.503 481.559 438.989C494.821 463.179 517.018 493.791 528.274 518.446C540.418 543.206 528.401 549.903 500.904 551.594C473.047 552.988 438.18 552.946 409.859 551.678C387.916 550.896 370.007 543.164 363.101 521.594C353.492 496.199 346.079 464.615 327.684 442.749C313.851 424.348 281.982 408.545 266.121 430.538C241.602 462.946 298.898 527.065 265.657 546.227C242.806 555.481 182.785 555.143 162.257 544.495C137.484 530.467 144.981 488.678 143.566 463.812C144.284 430.622 141.919 396.714 149.311 364.073C180.863 215.933 379.574 374.447 415.329 268.729C418.729 246.715 398.729 229.771 378.581 225.652C337.356 216.462 299.574 238.666 259.976 249.588L259.891 249.609Z"
                      fill="white"
                    />
                  </svg>
                </div>
              )}
            </div>

            {!collapsed && (
              <button
                onClick={() => setCollapsed(true)}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"
                title="Collapse"
              >
                <svg
                  className="w-4 h-4 text-slate-400 hover:text-slate-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <polyline points="15 6 9 12 15 18" />
                  <polyline points="11 6 5 12 11 18" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Expand button for collapsed state */}
        {collapsed && (
          <div className="px-2 py-2 border-b border-slate-200">
            <button
              onClick={() => setCollapsed(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors mx-auto"
              title="Expand"
            >
              <svg
                className="w-4 h-4 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <polyline points="9 6 15 12 9 18" />
              </svg>
            </button>
          </div>
        )}

        {/* Navigation */}
        <nav className={`flex-1 ${collapsed ? "px-2 py-4" : "px-3 py-4"} space-y-1`}>
          {sidebarItems.map((item) => (
            <div
              key={item.path}
              className={`group relative flex items-center w-full text-left rounded-lg transition-all duration-200 cursor-pointer ${
                collapsed ? "justify-center p-3" : "px-3 py-2.5"
              } ${
                item.isActive
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-700 hover:bg-slate-50 hover:text-slate-900"
              }`}
              title={collapsed ? item.label : undefined}
            >
              <span
                className={`flex items-center justify-center ${
                  collapsed ? "" : "mr-3 h-5 w-5"
                }`}
              >
                <item.icon
                  className={`h-5 w-5 ${
                    item.isActive
                      ? "text-blue-600"
                      : "text-slate-400 group-hover:text-slate-500"
                  }`}
                />
              </span>
              {!collapsed && (
                <span className="flex items-center flex-1 text-sm font-medium">
                  {item.label}
                  {item.isPremium && (
                    <Lock className="ml-auto h-3.5 w-3.5 text-slate-400" />
                  )}
                </span>
              )}
              {/* Tooltip for collapsed state */}
              {collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-slate-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50 top-1/2 transform -translate-y-1/2">
                  <span className="flex items-center">
                    {item.label}
                    {item.isPremium && <Lock className="ml-1 h-3 w-3" />}
                  </span>
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Bottom user menu */}
        <div className={`border-t border-slate-200 ${collapsed ? "p-2" : "p-3"}`}>
          <div
            className={`flex items-center rounded-lg p-2 hover:bg-slate-50 cursor-pointer ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-medium text-white">B</span>
            </div>
            {!collapsed && (
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">Baptiste</p>
                <p className="text-xs text-slate-500 truncate">baptiste@rastro.ai</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
