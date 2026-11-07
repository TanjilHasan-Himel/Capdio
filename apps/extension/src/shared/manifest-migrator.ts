// apps/extension/src/shared/manifest-migrator.ts
// Capdio Session Manifest Schema Migration & Integrity Verification (OCS-201)
// Enforces schema versioning, step-by-step upward migration, title sanitization,
// and structural validation across all storage tiers.

import {
  CURRENT_MANIFEST_SCHEMA_VERSION,
  type SessionManifest,
  type CaptureProfile,
  type SourceInfo,
  type RecordingSegment,
  type RecordStatus,
  type ErrorCode,
  type StorageBackend
} from './types.ts';

const VALID_STATUSES: Set<RecordStatus> = new Set([
  'idle',
  'requesting_permission',
  'preparing',
  'recording',
  'paused',
  'finalizing',
  'ready',
  'interrupted',
  'error'
]);

/**
 * Sanitizes user or system-provided session titles against HTML/script injection,
 * control characters, and filesystem path traversal patterns.
 */
export function sanitizeTitle(rawTitle: string): string {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return 'Untitled Recording';
  }

  // 1. Remove HTML tags and control characters
  let clean = rawTitle
    .replace(/<[^>]*>/g, '') // Strip HTML tags
    .replace(/[\x00-\x1F\x7F]/g, '') // Strip ASCII control characters
    .replace(/javascript:/gi, '')
    .replace(/\.\.[\/\\]/g, '') // Strip ../ or ..\ traversal sequences
    .replace(/[\\/:*?"<>|]/g, '-'); // Replace filesystem / path separator chars

  // 2. Prevent remaining dot traversal attempts
  clean = clean.replace(/\.\.+/g, '.');

  // 3. Clean up multiple dashes and leading/trailing separators
  clean = clean.replace(/-+/g, '-').replace(/^[-.\s]+|[-.\s]+$/g, '');

  // 4. Trim and collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();

  // 5. Bound length to 100 characters
  if (clean.length > 100) {
    clean = clean.substring(0, 100).trim();
  }

  return clean || 'Untitled Recording';
}

/**
 * Generates an informative, formatted default title from capture metadata.
 */
export function formatDefaultTitle(createdAt: string, displayLabel?: string): string {
  try {
    const date = new Date(createdAt);
    if (!isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}`;

      if (displayLabel && displayLabel.trim()) {
        return sanitizeTitle(`${displayLabel.trim()} (${formattedDate})`);
      }
      return `Recording ${formattedDate}`;
    }
  } catch (_) {}

  return displayLabel ? sanitizeTitle(displayLabel) : 'Capdio Recording';
}

/**
 * Validates the structural integrity and field types of a SessionManifest.
 */
export function validateSessionManifest(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object'] };
  }

  const m = data as Partial<SessionManifest>;

  if (typeof m.schemaVersion !== 'number' || m.schemaVersion < 1) {
    errors.push(`Invalid schemaVersion: expected number >= 1, got ${m.schemaVersion}`);
  }

  if (typeof m.sessionId !== 'string' || !m.sessionId.trim()) {
    errors.push('Invalid sessionId: non-empty string required');
  }

  if (typeof m.createdAt !== 'string' || isNaN(Date.parse(m.createdAt))) {
    errors.push(`Invalid createdAt timestamp: ${m.createdAt}`);
  }

  if (!m.status || !VALID_STATUSES.has(m.status)) {
    errors.push(`Invalid status: ${m.status}`);
  }

  if (!m.profile || typeof m.profile !== 'object') {
    errors.push('Missing or invalid profile');
  } else {
    if (typeof m.profile.width !== 'number' || m.profile.width <= 0) {
      errors.push(`Invalid profile.width: ${m.profile.width}`);
    }
    if (typeof m.profile.height !== 'number' || m.profile.height <= 0) {
      errors.push(`Invalid profile.height: ${m.profile.height}`);
    }
    if (m.profile.mimePreference !== 'webm' && m.profile.mimePreference !== 'mp4') {
      errors.push(`Invalid profile.mimePreference: ${m.profile.mimePreference}`);
    }
  }

  if (!Array.isArray(m.sources)) {
    errors.push('sources must be an array');
  }

  if (!Array.isArray(m.segments)) {
    errors.push('segments must be an array');
  } else {
    for (let i = 0; i < m.segments.length; i++) {
      const seg = m.segments[i];
      if (!seg || typeof seg.partId !== 'string' || typeof seg.bytes !== 'number') {
        errors.push(`Invalid segment at index ${i}`);
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Migrates a legacy unversioned (v0) manifest to Schema Version 1.
 */
export function migrateV0ToV1(v0: any): SessionManifest {
  const sessionId = typeof v0.sessionId === 'string' && v0.sessionId.trim()
    ? v0.sessionId
    : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}`);

  const createdAt = typeof v0.createdAt === 'string' && !isNaN(Date.parse(v0.createdAt))
    ? v0.createdAt
    : new Date().toISOString();

  const status: RecordStatus = VALID_STATUSES.has(v0.status) ? v0.status : 'idle';

  const profile: CaptureProfile = {
    width: typeof v0.profile?.width === 'number' ? v0.profile.width : 1920,
    height: typeof v0.profile?.height === 'number' ? v0.profile.height : 1080,
    fps: typeof v0.profile?.fps === 'number' && [24, 30, 60].includes(v0.profile.fps) ? v0.profile.fps : 30,
    mimePreference: v0.profile?.mimePreference === 'mp4' ? 'mp4' : 'webm',
    videoBitrate: typeof v0.profile?.videoBitrate === 'number' ? v0.profile.videoBitrate : undefined,
    tabAudio: typeof v0.profile?.tabAudio === 'boolean' ? v0.profile.tabAudio : true,
    microphone: typeof v0.profile?.microphone === 'boolean' ? v0.profile.microphone : false
  };

  const sources: SourceInfo[] = Array.isArray(v0.sources) ? v0.sources : [];
  const segments: RecordingSegment[] = Array.isArray(v0.segments) ? v0.segments : [];

  return {
    schemaVersion: 1,
    sessionId,
    createdAt,
    status,
    profile,
    sources,
    segments,
    errorCode: typeof v0.errorCode === 'string' ? (v0.errorCode as ErrorCode) : undefined
  };
}

/**
 * Migrates a Schema Version 1 manifest to Schema Version 2.
 * Calculates durationMs, totalBytes, assigns sanitized title, and flags recoverability.
 */
export function migrateV1ToV2(v1: SessionManifest): SessionManifest {
  const segments = Array.isArray(v1.segments) ? v1.segments : [];
  
  // Compute total bytes
  const totalBytes = segments.reduce((acc, seg) => acc + (typeof seg.bytes === 'number' ? seg.bytes : 0), 0);

  // Compute duration
  let durationMs = 0;
  if (segments.length > 0) {
    const lastSeg = segments[segments.length - 1];
    if (lastSeg) {
      durationMs = (lastSeg.startMs || 0) + (lastSeg.durationMs || 0);
    }
  }

  // Derive title
  const primarySourceLabel = v1.sources && v1.sources.length > 0 && v1.sources[0] ? v1.sources[0].displayLabel : undefined;
  const rawTitle = (v1 as any).title;
  const title = rawTitle && typeof rawTitle === 'string' && rawTitle.trim()
    ? sanitizeTitle(rawTitle)
    : formatDefaultTitle(v1.createdAt, primarySourceLabel);

  // Recoverability flag: unfinished session with recorded segments
  const isRecoverable = (
    v1.status === 'recording' ||
    v1.status === 'paused' ||
    v1.status === 'interrupted' ||
    v1.status === 'finalizing'
  ) && segments.length > 0;

  // Storage backend fallback
  const storageBackend: StorageBackend = (v1 as any).storageBackend || 'memory';

  return {
    ...v1,
    schemaVersion: 2,
    title,
    durationMs,
    totalBytes,
    finalizedAt: v1.status === 'ready' ? ((v1 as any).finalizedAt || v1.createdAt) : undefined,
    storageBackend,
    isRecoverable
  };
}

/**
 * High-level migrator function: sequentially upgrades any session manifest
 * to CURRENT_MANIFEST_SCHEMA_VERSION (Version 2).
 */
export function migrateSessionManifest(raw: unknown): SessionManifest {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Cannot migrate manifest: payload is not a valid object');
  }

  let current = raw as any;

  // Step 1: Migrate v0 (or unversioned) to v1
  if (!current.schemaVersion || current.schemaVersion < 1) {
    current = migrateV0ToV1(current);
  }

  // Step 2: Migrate v1 to v2
  if (current.schemaVersion < CURRENT_MANIFEST_SCHEMA_VERSION) {
    current = migrateV1ToV2(current);
  }

  // Step 3: Validate migrated manifest
  const validation = validateSessionManifest(current);
  if (!validation.valid) {
    console.warn(`[Capdio Migrator] Manifest validation warnings for session '${current.sessionId}':`, validation.errors);
  }

  return current as SessionManifest;
}
