// apps/extension/src/background/index.ts
// Capdio MV3 Service Worker Entrypoint & State Coordinator

import { registerMessageListener } from '../shared/message-bus';
import type { RecordStatus } from '../shared/types';

console.log('[Capdio SW] Service Worker script evaluating...');

const OFFSCREEN_PATH = 'offscreen.html';
let currentStatus: RecordStatus = 'idle';

// Ensure offscreen document exists
export async function ensureOffscreenDocument(): Promise<void> {
  if ('hasDocument' in chrome.offscreen) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) return;
  } else {
    // Fallback for older Chromium versions
    const clients = await (self as any).clients.matchAll();
    const exists = clients.some((c: any) => c.url.endsWith(OFFSCREEN_PATH));
    if (exists) return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Hosting Web Audio mixing and MediaRecorder for screen/tab capture'
  });
  console.log('[Capdio SW] Offscreen document created');
}

// Close offscreen document
export async function closeOffscreenDocument(): Promise<void> {
  if ('hasDocument' in chrome.offscreen) {
    const hasDoc = await chrome.offscreen.hasDocument();
    if (hasDoc) {
      await chrome.offscreen.closeDocument();
      console.log('[Capdio SW] Offscreen document closed');
    }
  }
}

// Register typed message handlers for 'background' target
registerMessageListener('background', {
  PING: async () => {
    return {
      appName: 'Capdio',
      version: '0.1.0',
      timestamp: Date.now(),
      status: currentStatus,
      serviceWorkerActive: true
    };
  },

  GET_STATUS: async () => {
    return {
      status: currentStatus,
      activeSessionId: null
    };
  },

  ENSURE_OFFSCREEN: async () => {
    await ensureOffscreenDocument();
    return { hasDocument: true };
  },

  CLOSE_OFFSCREEN: async () => {
    await closeOffscreenDocument();
    return { hasDocument: false };
  }
});

// Extension Lifecycle Handlers
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {
  console.log('[Capdio SW] onInstalled fired with reason:', details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Capdio SW] onStartup fired; status reset to IDLE');
  currentStatus = 'idle';
});

console.log('[Capdio SW] Service Worker initialized successfully');
