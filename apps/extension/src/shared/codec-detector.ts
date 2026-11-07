// apps/extension/src/shared/codec-detector.ts
// Capdio MIME & Codec Feature Detection & Graceful Fallback Engine (OCS-105)

import type { CodecCapabilityReport } from './types.ts';
import { MessageBusError } from './message-bus.ts';

export const WEBM_CANDIDATES: readonly string[] = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm'
] as const;

export const MP4_CANDIDATES: readonly string[] = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4;codecs=vp9,opus',
  'video/mp4'
] as const;

/**
 * Returns whether a given MIME type is supported by MediaRecorder in the current environment.
 */
export function isMimeSupported(
  mimeType: string,
  isTypeSupportedFn?: (type: string) => boolean
): boolean {
  const checkFn =
    isTypeSupportedFn ||
    (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? MediaRecorder.isTypeSupported.bind(MediaRecorder)
      : null);

  if (!checkFn) {
    return false;
  }

  try {
    return checkFn(mimeType);
  } catch {
    return false;
  }
}

/**
 * Probes the complete codec capability matrix for both WebM and MP4.
 */
export function getCodecCapabilityReport(
  isTypeSupportedFn?: (type: string) => boolean
): CodecCapabilityReport {
  const supportedWebM = WEBM_CANDIDATES.filter(mime => isMimeSupported(mime, isTypeSupportedFn));
  const supportedMp4 = MP4_CANDIDATES.filter(mime => isMimeSupported(mime, isTypeSupportedFn));

  const bestWebM = supportedWebM[0] || null;
  const bestMp4 = supportedMp4[0] || null;
  const supportedMimeTypes = [...supportedWebM, ...supportedMp4];

  const defaultMimeType = bestWebM || bestMp4 || 'video/webm';

  return {
    supportedMimeTypes,
    bestWebM,
    bestMp4,
    canRecordWebM: supportedWebM.length > 0,
    canRecordMp4: supportedMp4.length > 0,
    defaultMimeType
  };
}

/**
 * Selects the optimal MIME type based on user preference, with safe deterministic fallback.
 * Throws E_CODEC_UNSUPPORTED if neither format is available in the browser.
 */
export function selectBestCodec(
  preference: 'webm' | 'mp4' = 'webm',
  isTypeSupportedFn?: (type: string) => boolean
): { mimeType: string; isFallback: boolean } {
  const report = getCodecCapabilityReport(isTypeSupportedFn);

  if (preference === 'mp4') {
    if (report.bestMp4) {
      return { mimeType: report.bestMp4, isFallback: false };
    }
    // Graceful fallback to best WebM when MP4 is unavailable
    if (report.bestWebM) {
      return { mimeType: report.bestWebM, isFallback: true };
    }
  } else {
    // WebM preference
    if (report.bestWebM) {
      return { mimeType: report.bestWebM, isFallback: false };
    }
    // Fallback to MP4 if WebM is unexpectedly unavailable
    if (report.bestMp4) {
      return { mimeType: report.bestMp4, isFallback: true };
    }
  }

  throw new MessageBusError(
    'E_CODEC_UNSUPPORTED',
    `No supported video recording codec found for preference '${preference}'.`
  );
}
