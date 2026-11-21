export type LogLevel = 'info' | 'warn' | 'error' | 'telemetry' | 'event';

export interface SessionLogEntry {
  t: number; // ms since session start
  level: LogLevel;
  tag: string;
  msg: string;
  data?: Record<string, unknown>;
}

export interface SessionExport {
  app: string;
  startedAt: string;
  userAgent: string;
  summary: {
    totalEntries: number;
    errorCount: number;
    vrEntered: boolean;
    maxLeftJoints: number;
    maxRightJoints: number;
  };
  entries: SessionLogEntry[];
}

const STORAGE_KEY = 'eden_xr_last_session_log_v1';

/**
 * Lightweight QA/QC session logger for Android XR & Desktop testing.
 * Captures WebXR capabilities, 1Hz hand/nav telemetry, gameplay events, and runtime errors,
 * persisting to localStorage for one-click Copy/Download after exiting VR.
 */
export class SessionLogger {
  private readonly startMs = Date.now();
  private readonly startedAt = new Date(this.startMs).toISOString();
  private readonly entries: SessionLogEntry[] = [];
  private readonly maxEntries: number;

  public errorCount = 0;
  public warnCount = 0;
  public vrEntered = false;
  public maxLeftJoints = 0;
  public maxRightJoints = 0;

  constructor(maxEntries = 450) {
    this.maxEntries = maxEntries;
  }

  log(level: LogLevel, tag: string, msg: string, data?: Record<string, unknown>): void {
    const entry: SessionLogEntry = {
      t: Date.now() - this.startMs,
      level,
      tag,
      msg,
      ...(data ? { data } : {}),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    if (level === 'error') {
      this.errorCount++;
    } else if (level === 'warn') {
      this.warnCount++;
    }
    this.persist();
  }

  info(tag: string, msg: string, data?: Record<string, unknown>): void {
    this.log('info', tag, msg, data);
  }

  warn(tag: string, msg: string, data?: Record<string, unknown>): void {
    this.log('warn', tag, msg, data);
  }

  event(tag: string, msg: string, data?: Record<string, unknown>): void {
    this.log('event', tag, msg, data);
  }

  telemetry(tag: string, data: Record<string, unknown>): void {
    this.log('telemetry', tag, 'snapshot', data);
  }

  error(tag: string, err: unknown): void {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 4).join(' | ') : undefined;
    this.log('error', tag, msg, stack ? { stack } : undefined);
  }

  recordHandCounts(leftJoints: number, rightJoints: number): void {
    if (leftJoints > this.maxLeftJoints) this.maxLeftJoints = leftJoints;
    if (rightJoints > this.maxRightJoints) this.maxRightJoints = rightJoints;
  }

  installGlobalErrorHooks(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (e) => {
      this.error('window.error', e.error ?? e.message);
    });
    window.addEventListener('unhandledrejection', (e) => {
      this.error('unhandledrejection', e.reason);
    });
  }

  getEntries(): readonly SessionLogEntry[] {
    return this.entries;
  }

  exportObject(): SessionExport {
    return {
      app: 'EdenXR',
      startedAt: this.startedAt,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
      summary: {
        totalEntries: this.entries.length,
        errorCount: this.errorCount,
        vrEntered: this.vrEntered,
        maxLeftJoints: this.maxLeftJoints,
        maxRightJoints: this.maxRightJoints,
      },
      entries: [...this.entries],
    };
  }

  toJSON(pretty = true): string {
    return JSON.stringify(this.exportObject(), null, pretty ? 2 : 0);
  }

  clear(): void {
    this.entries.length = 0;
    this.errorCount = 0;
    this.maxLeftJoints = 0;
    this.maxRightJoints = 0;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore storage quota errors
      }
    }
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, this.toJSON(false));
    } catch {
      // ignore storage quota errors
    }
  }
}
