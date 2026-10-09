/** Counts complete Server-Sent Events without retaining their payloads. */
export interface SseFrameActivitySummary {
  frameCount: number;
  firstFrameMs: number | null;
  maxFrameGapMs: number | null;
}

export class SseFrameMonitor {
  private lineHasContent = false;
  private skipLfAfterCr = false;
  private frameCount = 0;
  private firstFrameAt: number | null = null;
  private previousFrameAt: number | null = null;
  private maxFrameGapMs: number | null = null;

  constructor(private readonly startedAtMs: number, private readonly onFrame?: (atMs: number) => void) {}

  /** Returns the number of complete event blocks ended by this chunk. */
  push(chunk: string, atMs = Date.now()): number {
    let completed = 0;
    for (let index = 0; index < chunk.length; index++) {
      const char = chunk[index]!;
      if (this.skipLfAfterCr) {
        this.skipLfAfterCr = false;
        if (char === '\n') continue;
      }
      if (char === '\r' || char === '\n') {
        if (char === '\r') this.skipLfAfterCr = true;
        if (this.lineHasContent) {
          this.lineHasContent = false;
          continue;
        }
        this.frameCount++;
        completed++;
        if (this.firstFrameAt === null) this.firstFrameAt = atMs;
        if (this.previousFrameAt !== null) {
          const gap = Math.max(0, atMs - this.previousFrameAt);
          this.maxFrameGapMs = this.maxFrameGapMs === null ? gap : Math.max(this.maxFrameGapMs, gap);
        }
        this.previousFrameAt = atMs;
        this.onFrame?.(atMs);
      } else {
        this.lineHasContent = true;
      }
    }
    return completed;
  }

  summary(): SseFrameActivitySummary {
    return {
      frameCount: this.frameCount,
      firstFrameMs: this.firstFrameAt === null ? null : Math.max(0, this.firstFrameAt - this.startedAtMs),
      maxFrameGapMs: this.maxFrameGapMs,
    };
  }
}
