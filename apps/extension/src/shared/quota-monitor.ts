// apps/extension/src/shared/quota-monitor.ts
// Capdio Storage Quota Monitor & Safe Low-Storage Manager (OCS-203)
// Proactively evaluates origin storage quotas, provides pre-flight checks,
// and enforces safe graceful auto-stop when storage limits approach critical levels.

export interface StorageEstimateReport {
  quota: number;
  usage: number;
  availableBytes: number;
  percentageUsed: number;
  level: 'ok' | 'warning' | 'critical';
  canRecord: boolean;
}

export interface QuotaThresholds {
  warningBytes: number;
  criticalBytes: number;
  maxUsagePercent: number;
}

export const DEFAULT_THRESHOLDS: QuotaThresholds = {
  warningBytes: 50 * 1024 * 1024,  // 50 MB
  criticalBytes: 20 * 1024 * 1024, // 20 MB
  maxUsagePercent: 95              // 95%
};

export class StorageQuotaMonitor {
  private _thresholds: QuotaThresholds;
  private _mockEstimate: { quota: number; usage: number } | null = null;

  constructor(thresholds: Partial<QuotaThresholds> = {}) {
    this._thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Sets mock values for unit/integration testing of edge cases.
   */
  public setMockEstimate(estimate: { quota: number; usage: number } | null): void {
    this._mockEstimate = estimate;
  }

  /**
   * Retrieves an authoritative storage estimate report from navigator.storage.
   */
  public async getEstimate(): Promise<StorageEstimateReport> {
    let quota = 10 * 1024 * 1024 * 1024; // Default fallback: 10GB
    let usage = 0;

    if (this._mockEstimate) {
      quota = this._mockEstimate.quota;
      usage = this._mockEstimate.usage;
    } else if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const est = await navigator.storage.estimate();
        if (typeof est.quota === 'number') quota = est.quota;
        if (typeof est.usage === 'number') usage = est.usage;
      } catch (err) {
        console.warn('[QuotaMonitor] navigator.storage.estimate() failed, using fallback:', err);
      }
    }

    const availableBytes = Math.max(0, quota - usage);
    const percentageUsed = quota > 0 ? +((usage / quota) * 100).toFixed(1) : 0;

    let level: 'ok' | 'warning' | 'critical' = 'ok';
    if (availableBytes <= this._thresholds.criticalBytes || percentageUsed >= this._thresholds.maxUsagePercent) {
      level = 'critical';
    } else if (availableBytes <= this._thresholds.warningBytes || percentageUsed >= 85) {
      level = 'warning';
    }

    const canRecord = level !== 'critical';

    return {
      quota,
      usage,
      availableBytes,
      percentageUsed,
      level,
      canRecord
    };
  }

  /**
   * Pre-flight check: determines if safe to initiate a new recording.
   */
  public async canStartRecording(): Promise<{ ok: boolean; reason?: string }> {
    const est = await this.getEstimate();
    if (!est.canRecord) {
      const availMB = (est.availableBytes / (1024 * 1024)).toFixed(1);
      return {
        ok: false,
        reason: `Insufficient storage space: only ${availMB} MB remaining. Please free up local space.`
      };
    }
    return { ok: true };
  }
}

// Default singleton instance
export const quotaMonitor = new StorageQuotaMonitor();

