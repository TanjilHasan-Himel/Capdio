// test-harness/test-manifest-storage-migration.js
// Automated Integration Test for Session Manifest Storage & Migration (OCS-201)

import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_DIST = path.resolve(__dirname, '..', 'apps', 'extension', 'dist');

async function runManifestMigrationIntegrationTest() {
  console.log('🚀 Running OCS-201 Session Manifest Storage & Migration Integration Test...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIST}`,
      `--load-extension=${EXTENSION_DIST}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  try {
    // 1. Locate Capdio Service Worker
    console.log('1. Locating Capdio Service Worker...');
    let workerTarget = null;
    for (let i = 0; i < 40; i++) {
      const targets = browser.targets();
      workerTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (workerTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!workerTarget) throw new Error('Capdio Service Worker not found');
    const worker = await workerTarget.worker();
    const extensionId = new URL(workerTarget.url()).hostname;
    console.log(`✅ Extension active. ID: ${extensionId}`);

    // 2. Seed chrome.storage.local with Legacy V0 and V1 Manifests
    console.log('\n2. Seeding chrome.storage.local with legacy V0 and V1 manifests...');
    const seedResult = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;

      const legacyV0 = {
        sessionId: 'sess_v0_ancient',
        createdAt: '2026-11-06T12:00:00.000Z',
        status: 'ready',
        profile: { width: 1280, height: 720, fps: 30 },
        sources: [{ sourceId: 'src_0', kind: 'tab', displayLabel: 'Ancient Tab', authorizedAt: '2026-11-06T12:00:01.000Z' }],
        segments: [{ partId: 'part_0', sourceId: 'src_0', startMs: 0, durationMs: 4000, bytes: 180000 }]
      };

      const legacyV1 = {
        schemaVersion: 1,
        sessionId: 'sess_v1_interrupted',
        createdAt: '2026-11-07T09:30:00.000Z',
        status: 'interrupted',
        profile: { width: 1920, height: 1080, fps: 30, mimePreference: 'webm', tabAudio: true, microphone: true },
        sources: [{ sourceId: 'src_1', kind: 'tab', displayLabel: 'Design Review', authorizedAt: '2026-11-07T09:30:01.000Z' }],
        segments: [
          { partId: 'p0', sourceId: 'src_1', startMs: 0, durationMs: 2500, bytes: 120000 },
          { partId: 'p1', sourceId: 'src_1', startMs: 2500, durationMs: 2500, bytes: 130000 }
        ]
      };

      await chrome.storage.local.set({
        'capdio_session_sess_v0_ancient': legacyV0,
        'capdio_session_sess_v1_interrupted': legacyV1,
        'capdio_sessions_index': ['sess_v0_ancient', 'sess_v1_interrupted']
      });

      return { seeded: true };
    });

    console.log('Seeded state:', seedResult);

    // 3. Open Extension Popup to communicate with Background Worker
    console.log('\n3. Opening extension page to interact with Service Worker...');
    const popupPage = await browser.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'load' });

    // 4. Query Sessions via Typed Message Bus (LIST_SESSIONS)
    console.log('\n4. Dispatching LIST_SESSIONS message to Service Worker...');
    const listResponse = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          id: 'msg_' + Date.now(),
          target: 'background',
          action: 'LIST_SESSIONS',
          timestamp: Date.now()
        }, resolve);
      });
    });

    console.log('LIST_SESSIONS response:', JSON.stringify(listResponse, null, 2));
    if (!listResponse.success || !Array.isArray(listResponse.data?.sessions)) {
      throw new Error(`Failed to list sessions: ${JSON.stringify(listResponse)}`);
    }

    const sessions = listResponse.data.sessions;
    if (sessions.length < 2) {
      throw new Error(`Expected at least 2 sessions, got ${sessions.length}`);
    }

    // Verify V0 was upgraded to Schema V2
    const v0Upgraded = sessions.find((s) => s.sessionId === 'sess_v0_ancient');
    if (!v0Upgraded) throw new Error('Missing sess_v0_ancient in listed sessions');
    console.log('Upgraded V0 Manifest:', v0Upgraded);

    if (v0Upgraded.schemaVersion !== 2) {
      throw new Error(`Expected schemaVersion 2 for V0, got ${v0Upgraded.schemaVersion}`);
    }
    if (v0Upgraded.totalBytes !== 180000) {
      throw new Error(`Expected totalBytes 180000 for V0, got ${v0Upgraded.totalBytes}`);
    }
    if (!v0Upgraded.title || !v0Upgraded.title.includes('Ancient Tab')) {
      throw new Error(`Expected title derived from Ancient Tab, got '${v0Upgraded.title}'`);
    }
    console.log('✅ PASS: Legacy V0 manifest automatically migrated to Schema V2 upon listing.');

    // Verify V1 was upgraded to Schema V2
    const v1Upgraded = sessions.find((s) => s.sessionId === 'sess_v1_interrupted');
    if (!v1Upgraded) throw new Error('Missing sess_v1_interrupted in listed sessions');
    console.log('Upgraded V1 Manifest:', v1Upgraded);

    if (v1Upgraded.schemaVersion !== 2) {
      throw new Error(`Expected schemaVersion 2 for V1, got ${v1Upgraded.schemaVersion}`);
    }
    if (v1Upgraded.totalBytes !== 250000) {
      throw new Error(`Expected totalBytes 250000 for V1, got ${v1Upgraded.totalBytes}`);
    }
    if (v1Upgraded.durationMs !== 5000) {
      throw new Error(`Expected durationMs 5000 for V1, got ${v1Upgraded.durationMs}`);
    }
    if (v1Upgraded.isRecoverable !== true) {
      throw new Error(`Expected isRecoverable=true for interrupted session with segments`);
    }
    console.log('✅ PASS: Schema V1 manifest automatically migrated to Schema V2 with recoverability metadata.');

    // 5. Verify that Migrated Records were Rewritten to chrome.storage.local
    console.log('\n5. Verifying migrated manifests were written back to chrome.storage.local...');
    const storageCheck = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;
      const data = await chrome.storage.local.get(['capdio_session_sess_v0_ancient', 'capdio_session_sess_v1_interrupted']);
      return {
        v0Version: data['capdio_session_sess_v0_ancient']?.schemaVersion,
        v1Version: data['capdio_session_sess_v1_interrupted']?.schemaVersion
      };
    });
    console.log('Storage check result:', storageCheck);
    if (storageCheck.v0Version !== 2 || storageCheck.v1Version !== 2) {
      throw new Error(`Storage was not updated to Schema V2: ${JSON.stringify(storageCheck)}`);
    }
    console.log('✅ PASS: Storage was atomically upgraded to Schema V2.');

    // 6. Test GET_SESSION
    console.log('\n6. Testing GET_SESSION message...');
    const getRes = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          id: 'msg_' + Date.now(),
          target: 'background',
          action: 'GET_SESSION',
          timestamp: Date.now(),
          payload: { sessionId: 'sess_v1_interrupted' }
        }, resolve);
      });
    });
    if (!getRes.success || getRes.data?.session?.sessionId !== 'sess_v1_interrupted') {
      throw new Error(`GET_SESSION failed: ${JSON.stringify(getRes)}`);
    }
    console.log('✅ PASS: GET_SESSION successfully retrieved migrated session.');

    // 7. Test UPDATE_SESSION_METADATA (Rename Session)
    console.log('\n7. Testing UPDATE_SESSION_METADATA (Renaming session)...');
    const updateRes = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          id: 'msg_' + Date.now(),
          target: 'background',
          action: 'UPDATE_SESSION_METADATA',
          timestamp: Date.now(),
          payload: {
            sessionId: 'sess_v1_interrupted',
            title: '<script>alert("xss")</script> Sprint Retrospective 2026'
          }
        }, resolve);
      });
    });

    console.log('UPDATE_SESSION_METADATA response:', updateRes);
    if (!updateRes.success || !updateRes.data?.session) {
      throw new Error(`UPDATE_SESSION_METADATA failed: ${JSON.stringify(updateRes)}`);
    }
    const updatedTitle = updateRes.data.session.title;
    console.log(`Sanitized Title in response: "${updatedTitle}"`);
    if (updatedTitle !== 'alert(-xss-) Sprint Retrospective 2026') {
      throw new Error(`Expected sanitized title 'alert(-xss-) Sprint Retrospective 2026', got '${updatedTitle}'`);
    }
    console.log('✅ PASS: Session title safely updated and sanitized via message bus.');

    // 8. Test DELETE_SESSION
    console.log('\n8. Testing DELETE_SESSION...');
    const deleteRes = await popupPage.evaluate(async () => {
      const chrome = globalThis.chrome;
      return new Promise(resolve => {
        chrome.runtime.sendMessage({
          id: 'msg_' + Date.now(),
          target: 'background',
          action: 'DELETE_SESSION',
          timestamp: Date.now(),
          payload: { sessionId: 'sess_v0_ancient' }
        }, resolve);
      });
    });

    console.log('DELETE_SESSION response:', deleteRes);
    if (!deleteRes.success) throw new Error(`DELETE_SESSION failed: ${JSON.stringify(deleteRes)}`);

    // Verify deleted session is gone from storage and index
    const storageAfterDelete = await worker.evaluate(async () => {
      const chrome = globalThis.chrome;
      const data = await chrome.storage.local.get(['capdio_session_sess_v0_ancient', 'capdio_sessions_index']);
      return {
        sessionExists: !!data['capdio_session_sess_v0_ancient'],
        index: data['capdio_sessions_index']
      };
    });

    console.log('Storage after delete:', storageAfterDelete);
    if (storageAfterDelete.sessionExists) {
      throw new Error('Deleted session still exists in chrome.storage.local');
    }
    if (storageAfterDelete.index.includes('sess_v0_ancient')) {
      throw new Error('Deleted session ID still present in capdio_sessions_index');
    }
    console.log('✅ PASS: Session cleanly removed from storage and index.');

    console.log('\n=============================================================');
    console.log('🎉 ALL OCS-201 STORAGE & MIGRATION INTEGRATION TESTS PASSED!');
    console.log('=============================================================\n');
  } finally {
    await browser.close().catch(() => {});
  }
}

runManifestMigrationIntegrationTest().catch(err => {
  console.error('\n❌ OCS-201 integration test failed:', err);
  process.exit(1);
});
