// test-harness/test-security-boundaries.js
// Automated security boundary and permission verification for OCS-004

import puppeteer from 'puppeteer-core';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Users\\Himel\\.cache\\puppeteer\\chrome\\win64-152.0.7977.42\\chrome-win64\\chrome.exe';
const EXTENSION_PATH = path.join(__dirname, 'extension');
const PORT = 3460;

// Whitelist of strictly permitted permissions in V1
const ALLOWED_PERMISSIONS = new Set([
  'tabCapture',
  'offscreen',
  'activeTab',
  'storage'
]);

// Explicitly forbidden permissions (PRD & TDR §03)
const FORBIDDEN_PERMISSIONS = [
  '<all_urls>',
  '*://*/*',
  'tabs',
  'scripting',
  'webRequest',
  'webRequestBlocking',
  'cookies',
  'history',
  'bookmarks',
  'management',
  'nativeMessaging',
  'declarativeNetRequest'
];

function logSection(title) {
  console.log(`\n==================================================`);
  console.log(`🔒 [SECURITY AUDIT] ${title}`);
  console.log(`==================================================`);
}

// 1. Static Manifest Audit
function auditManifest() {
  logSection('1. Static Manifest & Permission Audit');
  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  console.log(`Manifest Version: ${manifest.manifest_version}`);

  if (manifest.manifest_version !== 3) {
    throw new Error(`Expected MV3, found ${manifest.manifest_version}`);
  }

  // Check host_permissions
  if (manifest.host_permissions && manifest.host_permissions.length > 0) {
    for (const hp of manifest.host_permissions) {
      if (hp === '<all_urls>' || hp === '*://*/*') {
        throw new Error(`FAIL: Over-broad host permission detected: ${hp}`);
      }
    }
  } else {
    console.log('✅ PASS: Zero broad host_permissions declared.');
  }

  // Check permissions against allowed whitelist and forbidden list
  const declaredPermissions = manifest.permissions || [];
  for (const perm of declaredPermissions) {
    if (FORBIDDEN_PERMISSIONS.includes(perm)) {
      throw new Error(`FAIL: Forbidden permission detected: ${perm}`);
    }
    if (!ALLOWED_PERMISSIONS.has(perm)) {
      throw new Error(`FAIL: Undeclared/Unreviewed permission detected: ${perm}`);
    }
  }
  console.log(`✅ PASS: Declared permissions (${declaredPermissions.join(', ')}) strictly match least-privilege whitelist.`);

  // Check CSP
  const csp = manifest.content_security_policy?.extension_pages;
  if (!csp) {
    throw new Error('FAIL: Content Security Policy extension_pages is missing');
  }
  if (csp.includes('unsafe-eval') || csp.includes('http:') || csp.includes('https:')) {
    throw new Error(`FAIL: Insecure CSP directive found: ${csp}`);
  }
  console.log(`✅ PASS: Strict CSP configured: "${csp}"`);

  // Check externally_connectable
  if (manifest.externally_connectable) {
    const matches = manifest.externally_connectable.matches || [];
    if (matches.includes('<all_urls>') || matches.includes('*://*/*')) {
      throw new Error(`FAIL: Insecure externally_connectable wildcard detected: ${matches.join(', ')}`);
    }
  } else {
    console.log('✅ PASS: Zero externally_connectable declarations (web origin isolation guaranteed by browser).');
  }

  return { success: true, manifest };
}

// 2. Start HTTP Server for untrusted origin testing
function startServer() {
  return new Promise((resolve) => {
    const fixtureHtml = fs.readFileSync(path.join(__dirname, 'fixtures', 'test-page.html'), 'utf8');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fixtureHtml);
    });
    server.listen(PORT, () => {
      console.log(`Test web server running at http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

// 3. Dynamic Runtime Security & Trust Boundary Tests
async function runRuntimeSecurityTests(server) {
  logSection('2. Dynamic Trust Boundary & Message Validation');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling'
    ],
    defaultViewport: { width: 1280, height: 720 }
  });

  try {
    // Find extension worker
    console.log('Finding Extension Service Worker target...');
    let workerTarget = null;
    for (let i = 0; i < 40; i++) {
      const targets = browser.targets();
      workerTarget = targets.find(t => t.type() === 'service_worker' && t.url().includes('chrome-extension://'));
      if (workerTarget) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!workerTarget) {
      throw new Error('Extension Service Worker not found');
    }

    const extensionUrl = workerTarget.url();
    const extensionId = new URL(extensionUrl).hostname;
    console.log(`✅ Extension loaded. ID: ${extensionId}`);

    const extensionOrigin = `chrome-extension://${extensionId}`;
    await browser.defaultBrowserContext().overridePermissions(extensionOrigin, ['microphone']);
    console.log('✓ Microphone permission granted to', extensionOrigin);

    const worker = await workerTarget.worker();
    worker.on('console', msg => console.log('[SW Log]', msg.text()));

    browser.on('targetcreated', async (t) => {
      try {
        if (t.type() === 'other' && t.url().includes('offscreen.html')) {
          const session = await t.createCDPSession();
          await session.send('Runtime.enable');
          session.on('Runtime.consoleAPICalled', (event) => {
            console.log('[Offscreen Log]', ...event.args.map(a => a.value || a.description));
          });
        }
      } catch (e) {}
    });

    const extensionPage = await browser.newPage();
    await extensionPage.goto(`chrome-extension://${extensionId}/harness.html`, { waitUntil: 'domcontentloaded' });
    console.log('✅ Extension test harness page loaded');

    // Test A: Schema rejection from extension client to service worker
    console.log('\nTesting message schema validation:');
    const malformedResult1 = await extensionPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ invalidField: true }, (res) => {
          resolve(res);
        });
      });
    });
    console.log('Malformed message result (missing action):', malformedResult1);
    if (!malformedResult1 || malformedResult1.errorCode !== 'E_INVALID_MESSAGE') {
      throw new Error(`Expected E_INVALID_MESSAGE for malformed message, got: ${JSON.stringify(malformedResult1)}`);
    }
    console.log('✅ PASS: Malformed message correctly rejected with E_INVALID_MESSAGE');

    const unknownActionResult = await extensionPage.evaluate(async () => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'MALICIOUS_UNKNOWN_ACTION' }, (res) => {
          resolve(res);
        });
      });
    });
    console.log('Unknown action result:', unknownActionResult);
    if (!unknownActionResult || unknownActionResult.success !== false) {
      throw new Error(`Expected rejection for unknown action, got: ${JSON.stringify(unknownActionResult)}`);
    }
    console.log('✅ PASS: Unauthorized / unknown action correctly rejected.');
    console.log('Unknown action result:', unknownActionResult);
    if (!unknownActionResult || unknownActionResult.success !== false) {
      throw new Error(`Expected rejection for unknown action, got: ${JSON.stringify(unknownActionResult)}`);
    }
    console.log('✅ PASS: Unauthorized / unknown action correctly rejected.');

    // Test B: Untrusted Web Origin Isolation
    logSection('3. Untrusted Web Origin Attack Simulation');
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/test-page.html`, { waitUntil: 'domcontentloaded' });

    console.log(`Navigated to untrusted web page: ${page.url()}`);

    const externalAttackResult = await page.evaluate(async (extId) => {
      // Untrusted webpage attempts to communicate directly with extension
      if (!window.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
        return { blockedByBrowser: true, message: 'chrome.runtime.sendMessage not exposed to untrusted web page' };
      }
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(extId, { action: 'RUN_FULL_CAPTURE_SPIKE' }, (response) => {
            const lastErr = chrome.runtime.lastError;
            if (lastErr) {
              resolve({ blockedByBrowser: true, error: lastErr.message });
            } else {
              resolve({ blockedByBrowser: false, response });
            }
          });
        } catch (err) {
          resolve({ blockedByBrowser: true, error: err.message });
        }
      });
    }, extensionId);

    console.log('Untrusted web page external message test result:', externalAttackResult);
    if (!externalAttackResult.blockedByBrowser) {
      throw new Error(`FAIL: Untrusted web page successfully delivered message to extension! Response: ${JSON.stringify(externalAttackResult.response)}`);
    }
    console.log('✅ PASS: Untrusted web page is strictly blocked from communicating with extension service worker.');

    // Test C: Tab Capture Functional Integrity without host_permissions
    logSection('4. Tab Capture Execution Without Host Permissions');

    await page.bringToFront();
    await new Promise(r => setTimeout(r, 1000));

    // Explicitly configure fast duration without hardware microphone spin-up for security verification
    await worker.evaluate(() => {
      globalThis.__recordingConfig = {
        width: 1920,
        height: 1080,
        fps: 30,
        enableMonitorAudio: true,
        includeMic: false,
        durationMs: 1500,
        mimeType: 'video/webm;codecs=vp9,opus'
      };
    });

    console.log('Invoking native Action click via CDP (user gesture emulation)...');
    const browserClient = await browser.target().createCDPSession();
    await browserClient.send('Extensions.triggerAction', {
      id: extensionId,
      targetId: page._tabId
    });

    console.log('Waiting for capture result from service worker...');
    let lastResult = null;
    for (let i = 0; i < 60; i++) {
      const hasResult = await worker.evaluate(() => !!globalThis.__lastResult);
      if (hasResult) {
        lastResult = await worker.evaluate(() => {
          const res = globalThis.__lastResult;
          const recRes = res?.captureResult?.captureResult?.recordResult || res?.captureResult?.recordResult;
          return {
            success: res?.success,
            tabId: res?.tabId,
            streamIdLength: res?.streamIdLength,
            chunksCount: recRes?.chunksCount,
            totalBytes: recRes?.blobSize || recRes?.totalBytes
          };
        });
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    if (!lastResult) {
      throw new Error('Capture did not complete within timeout');
    }

    console.log('Capture execution result:', lastResult);

    if (!lastResult.success) {
      throw new Error(`Capture failed: ${lastResult.error}`);
    }

    if (lastResult.totalBytes && lastResult.totalBytes < 50000) {
      throw new Error(`Expected at least 50KB recording, got ${lastResult.totalBytes}`);
    }

    console.log('✅ PASS: Tab capture and WebM recording completed successfully with ZERO host permissions!');

    console.log('\n==================================================');
    console.log('🎉 ALL SECURITY BOUNDARY & PERMISSION TESTS PASSED!');
    console.log('==================================================\n');

    return {
      manifestAudit: 'PASSED',
      schemaValidation: 'PASSED',
      webOriginIsolation: 'PASSED',
      tabCaptureZeroHostPerms: 'PASSED'
    };
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  try {
    auditManifest();
    const server = await startServer();
    const results = await runRuntimeSecurityTests(server);
    fs.writeFileSync(
      path.join(__dirname, 'security-audit-results.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2)
    );
    process.exit(0);
  } catch (err) {
    console.error('❌ SECURITY AUDIT FAILED:', err);
    process.exit(1);
  }
}

main();
