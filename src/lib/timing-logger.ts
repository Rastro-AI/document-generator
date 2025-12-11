/**
 * Timing Logger
 * Logs timing information for debugging performance issues
 */

import fs from "fs/promises";
import path from "path";

const LOGS_DIR = path.join(process.cwd(), "logs");

interface TimingEntry {
  label: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface TimingLog {
  requestId: string;
  startTime: string;
  entries: TimingEntry[];
  totalDuration?: number;
}

export class TimingLogger {
  private requestId: string;
  private startTime: number;
  private entries: TimingEntry[] = [];
  private currentEntry: TimingEntry | null = null;

  constructor(requestId?: string) {
    this.requestId = requestId || `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.startTime = performance.now();
  }

  /**
   * Start timing a labeled section
   */
  start(label: string): void {
    if (this.currentEntry) {
      this.end();
    }
    this.currentEntry = {
      label,
      startTime: performance.now(),
    };
  }

  /**
   * End the current timing section
   */
  end(): void {
    if (this.currentEntry) {
      this.currentEntry.endTime = performance.now();
      this.currentEntry.duration = this.currentEntry.endTime - this.currentEntry.startTime;
      this.entries.push(this.currentEntry);
      this.currentEntry = null;
    }
  }

  /**
   * Log a point-in-time marker
   */
  mark(label: string): void {
    const now = performance.now();
    this.entries.push({
      label,
      startTime: now,
      endTime: now,
      duration: 0,
    });
  }

  /**
   * Time an async function
   */
  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    this.start(label);
    try {
      const result = await fn();
      this.end();
      return result;
    } catch (error) {
      this.end();
      throw error;
    }
  }

  /**
   * Get the timing log data
   */
  getLog(): TimingLog {
    if (this.currentEntry) {
      this.end();
    }
    const totalDuration = performance.now() - this.startTime;
    return {
      requestId: this.requestId,
      startTime: new Date(Date.now() - totalDuration).toISOString(),
      entries: this.entries,
      totalDuration,
    };
  }

  /**
   * Save the timing log to a file (skips file write on serverless)
   */
  async save(): Promise<string | null> {
    const log = this.getLog();

    // Log summary to console
    console.log(`\n[TIMING] Request ${this.requestId} - Total: ${log.totalDuration?.toFixed(2)}ms`);
    for (const entry of log.entries) {
      const pct = ((entry.duration || 0) / (log.totalDuration || 1) * 100).toFixed(1);
      console.log(`  ${entry.label}: ${entry.duration?.toFixed(2)}ms (${pct}%)`);
    }

    // Skip file writing on serverless environments (read-only filesystem)
    const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME;
    if (isServerless) {
      console.log(`  (skipping file save on serverless)\n`);
      return null;
    }

    try {
      // Ensure logs directory exists
      await fs.mkdir(LOGS_DIR, { recursive: true });

      // Create filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `timing_${timestamp}_${this.requestId}.json`;
      const filepath = path.join(LOGS_DIR, filename);

      // Format log for readability
      const formattedLog = {
        ...log,
        summary: {
          totalDuration: `${log.totalDuration?.toFixed(2)}ms`,
          breakdown: log.entries.map((e) => ({
            label: e.label,
            duration: `${e.duration?.toFixed(2)}ms`,
            percentage: `${((e.duration || 0) / (log.totalDuration || 1) * 100).toFixed(1)}%`,
          })),
        },
      };

      await fs.writeFile(filepath, JSON.stringify(formattedLog, null, 2));
      console.log(`  Log saved to: ${filepath}\n`);

      return filepath;
    } catch (err) {
      console.log(`  (failed to save log file: ${err})\n`);
      return null;
    }
  }
}

/**
 * Create a new timing logger
 */
export function createTimingLogger(requestId?: string): TimingLogger {
  return new TimingLogger(requestId);
}
