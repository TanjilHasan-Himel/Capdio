// apps/extension/src/offscreen/index.ts
// Capdio Offscreen Document - Media Sandbox & Recorder Host

import { registerMessageListener } from '../shared/message-bus';

console.log('[Capdio Offscreen] Host initializing...');

function probeCapabilities() {
  const codecs = [
    'video/webm',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=h264,opus',
    'video/mp4'
  ];

  const codecSupport: Record<string, boolean> = {};
  for (const codec of codecs) {
    codecSupport[codec] = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(codec);
  }

  return {
    audioContext: typeof AudioContext !== 'undefined',
    mediaDevices: typeof navigator.mediaDevices !== 'undefined',
    mediaRecorder: typeof MediaRecorder !== 'undefined',
    codecs: codecSupport
  };
}

registerMessageListener('offscreen', {
  PING: async () => {
    return {
      offscreenActive: true,
      timestamp: Date.now(),
      capabilities: probeCapabilities()
    };
  }
});

console.log('[Capdio Offscreen] Host ready and message listeners registered');

