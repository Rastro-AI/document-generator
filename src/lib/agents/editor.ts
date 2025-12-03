/**
 * Template Editor for the Agents SDK
 * Handles file operations for job-specific templates
 */

import fs from "fs/promises";
import path from "path";
import type { Editor, ApplyPatchResult } from "@openai/agents-core";
import { applyDiff } from "@openai/agents-core";
import { getJobDir } from "@/lib/paths";
import { getTemplate } from "@/lib/fs-utils";

/**
 * Editor implementation that operates on a specific job's template files.
 * Restricts operations to the job directory for security.
 */
export class JobTemplateEditor implements Editor {
  private jobId: string;
  private jobDir: string;
  private templateId: string;

  constructor(jobId: string, templateId: string) {
    this.jobId = jobId;
    this.templateId = templateId;
    this.jobDir = getJobDir(jobId);
  }

  /**
   * Resolve a path safely within the job directory
   */
  private resolveSafePath(relPath: string): string {
    // Normalize the path and ensure it stays within job directory
    const normalizedPath = path.normalize(relPath);

    // For template.tsx, resolve to job directory
    if (normalizedPath === "template.tsx" || normalizedPath === "./template.tsx") {
      return path.join(this.jobDir, "template.tsx");
    }

    // For other files, ensure they're in the job directory
    const fullPath = path.resolve(this.jobDir, normalizedPath);
    if (!fullPath.startsWith(this.jobDir)) {
      throw new Error(`Path outside job directory: ${relPath}`);
    }

    return fullPath;
  }

  /**
   * Create a new file from a V4A diff
   */
  async createFile(operation: {
    type: "create_file";
    path: string;
    diff: string;
  }): Promise<ApplyPatchResult> {
    const fullPath = this.resolveSafePath(operation.path);

    try {
      // For create_file, the diff is essentially the full content
      // applyDiff with empty base and "create" mode extracts the new content
      const newContent = applyDiff("", operation.diff, "create");

      // Ensure parent directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, newContent, "utf8");

      return {
        status: "completed",
        output: `Created ${operation.path}`,
      };
    } catch (error) {
      return {
        status: "failed",
        output: `Failed to create ${operation.path}: ${error}`,
      };
    }
  }

  /**
   * Update an existing file based on a V4A diff
   */
  async updateFile(operation: {
    type: "update_file";
    path: string;
    diff: string;
  }): Promise<ApplyPatchResult> {
    const fullPath = this.resolveSafePath(operation.path);

    try {
      let currentContent = "";

      // Try to read existing file
      try {
        currentContent = await fs.readFile(fullPath, "utf8");
      } catch {
        // If file doesn't exist but it's template.tsx, copy from original template
        if (operation.path === "template.tsx" || operation.path === "./template.tsx") {
          const template = await getTemplate(this.templateId);
          if (template) {
            const originalTemplatePath = path.join(
              process.cwd(),
              "templates",
              this.templateId,
              "template.tsx"
            );
            try {
              currentContent = await fs.readFile(originalTemplatePath, "utf8");
            } catch {
              return {
                status: "failed",
                output: `Original template not found: ${operation.path}`,
              };
            }
          } else {
            return {
              status: "failed",
              output: `Template not found: ${this.templateId}`,
            };
          }
        } else {
          return {
            status: "failed",
            output: `File not found: ${operation.path}`,
          };
        }
      }

      // Apply the diff
      const updatedContent = applyDiff(currentContent, operation.diff);
      await fs.writeFile(fullPath, updatedContent, "utf8");

      return {
        status: "completed",
        output: `Updated ${operation.path}`,
      };
    } catch (error) {
      return {
        status: "failed",
        output: `Failed to update ${operation.path}: ${error}`,
      };
    }
  }

  /**
   * Delete an existing file
   */
  async deleteFile(operation: {
    type: "delete_file";
    path: string;
  }): Promise<ApplyPatchResult> {
    const fullPath = this.resolveSafePath(operation.path);

    try {
      await fs.unlink(fullPath);
      return {
        status: "completed",
        output: `Deleted ${operation.path}`,
      };
    } catch {
      return {
        status: "failed",
        output: `Could not delete ${operation.path}`,
      };
    }
  }
}
