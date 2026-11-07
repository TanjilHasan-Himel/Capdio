// OpenCapture Studio - Popup logic for Spike

const statusBadge = document.getElementById('statusBadge');
const output = document.getElementById('output');
const btnProbe = document.getElementById('btnProbe');
const btnCapture = document.getElementById('btnCapture');

function log(data) {
  if (typeof data === 'object') {
    output.textContent = JSON.stringify(data, null, 2);
  } else {
    output.textContent = data;
  }
}

btnProbe.addEventListener('click', async () => {
  statusBadge.textContent = 'Probing...';
  log('Sending probe request to offscreen document...');
  try {
    const res = await chrome.runtime.sendMessage({ action: 'RUN_SPIKE_PROBE' });
    statusBadge.textContent = 'Probe Completed';
    log(res);
  } catch (err) {
    statusBadge.textContent = 'Error';
    log({ error: err.message });
  }
});

btnCapture.addEventListener('click', async () => {
  statusBadge.textContent = 'Capturing...';
  btnCapture.disabled = true;
  log('Querying active tab and requesting streamId from popup context...');
  try {
    const allTabs = await chrome.tabs.query({});
    const activeTabs = await chrome.tabs.query({ active: true });
    log({ allTabsCount: allTabs.length, allTabs: allTabs.map(t => ({ id: t.id, url: t.url, active: t.active })), activeTabs });

    const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!activeTab || !activeTab.id) {
      throw new Error('No active tab found in current window');
    }

    log(`Target tab: #${activeTab.id} - ${activeTab.title || activeTab.url}`);

    // If target tab is an internal page or popup, pick the test fixture tab
    let tabToCapture = activeTab;
    if (tabToCapture.url && (tabToCapture.url.startsWith('chrome') || tabToCapture.url.includes('popup.html'))) {
      const nonInternal = allTabs.find(t => t.url && !t.url.startsWith('chrome'));
      if (nonInternal) {
        log(`Switching target from ${tabToCapture.url} to ${nonInternal.url} (#${nonInternal.id})`);
        tabToCapture = nonInternal;
      }
    }

    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabToCapture.id }, (id) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!id) {
          return reject(new Error('No streamId returned by tabCapture.getMediaStreamId'));
        }
        resolve(id);
      });
    });

    log(`Acquired streamId: ${streamId.substring(0, 15)}... (length: ${streamId.length})`);

    const res = await chrome.runtime.sendMessage({
      action: 'RUN_CAPTURE_WITH_STREAM_ID',
      streamId,
      width: 1920,
      height: 1080,
      fps: 30,
      durationMs: 3000
    });

    statusBadge.textContent = 'Capture Completed';
    log(res);
  } catch (err) {
    statusBadge.textContent = 'Capture Failed';
    log({ error: err.message, stack: err.stack });
  } finally {
    btnCapture.disabled = false;
  }
});
