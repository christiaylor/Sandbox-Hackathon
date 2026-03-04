document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const cacheApiBaseUrlInput = document.getElementById('cacheApiBaseUrl');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const scanBtn = document.getElementById('scanBtn');

  const settingsTabBtn = document.getElementById('settingsTabBtn');
  const historyTabBtn = document.getElementById('historyTabBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const historyPanel = document.getElementById('historyPanel');

  const historySearch = document.getElementById('historySearch');
  const historyRefreshBtn = document.getElementById('historyRefreshBtn');
  const historyStatus = document.getElementById('historyStatus');
  const historyList = document.getElementById('historyList');
  const COLOR_OK = 'var(--tg-ok)';
  const COLOR_DANGER = 'var(--tg-danger)';
  const COLOR_MUTED = 'var(--tg-muted)';

  function setSettingsStatus(message, color) {
    statusEl.style.color = color;
    statusEl.textContent = message;
  }

  function setHistoryStatus(message, color) {
    historyStatus.style.color = color;
    historyStatus.textContent = message;
  }

  function switchTab(tab) {
    const isSettings = tab === 'settings';
    settingsTabBtn.classList.toggle('active', isSettings);
    historyTabBtn.classList.toggle('active', !isSettings);
    settingsPanel.classList.toggle('active', isSettings);
    historyPanel.classList.toggle('active', !isSettings);
  }

  function formatDate(value) {
    if (!value) return 'n/a';
    const d = new Date(value);
    if (Number.isNaN(d.valueOf())) return 'n/a';
    return d.toLocaleString();
  }

  function renderHistory(items) {
    if (!Array.isArray(items) || items.length === 0) {
      historyList.innerHTML = `<div class="history-empty">No cached policies yet.</div>`;
      return;
    }

    historyList.innerHTML = items.map((item) => {
      const url = item.urlRaw || item.urlNormalized || '';
      const risk = item.summary?.overall_risk || 'Unknown';
      const riskReason = item.summary?.overall_risk_reason || '';
      return `
        <div class="history-item">
          <a class="history-url" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>
          <div class="history-meta">Updated: ${escapeHtml(formatDate(item.policyUpdatedAt))}</div>
          <div class="history-meta">Generated: ${escapeHtml(formatDate(item.generatedAt))}</div>
          <span class="history-risk">Risk: ${escapeHtml(risk)}</span>
          ${riskReason ? `<div class="history-meta">${escapeHtml(riskReason)}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  async function loadHistory() {
    setHistoryStatus('Loading...', COLOR_MUTED);
    historyList.innerHTML = '';

    chrome.runtime.sendMessage(
      {
        type: 'GET_POLICY_HISTORY',
        query: historySearch.value.trim(),
        limit: 40,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setHistoryStatus('Failed to load history.', COLOR_DANGER);
          historyList.innerHTML = `<div class="history-empty">${escapeHtml(chrome.runtime.lastError.message || 'Unknown error')}</div>`;
          return;
        }

        if (!response?.ok) {
          setHistoryStatus('History unavailable.', COLOR_DANGER);
          historyList.innerHTML = `<div class="history-empty">${escapeHtml(response?.error || 'Cache API unreachable')}</div>`;
          return;
        }

        renderHistory(response.items || []);
        setHistoryStatus(`Loaded ${response.items?.length || 0} item(s).`, COLOR_OK);
      },
    );
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str || '');
    return div.innerHTML;
  }

  settingsTabBtn.addEventListener('click', () => switchTab('settings'));
  historyTabBtn.addEventListener('click', async () => {
    switchTab('history');
    await loadHistory();
  });

  // Load saved settings
  const { apiKey, cacheApiBaseUrl } = await chrome.storage.local.get(['apiKey', 'cacheApiBaseUrl']);
  if (apiKey) {
    apiKeyInput.value = apiKey;
    setSettingsStatus('✓ Settings loaded', COLOR_OK);
  }
  cacheApiBaseUrlInput.value = cacheApiBaseUrl || 'http://localhost:8787';

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const cacheApiBaseUrl = cacheApiBaseUrlInput.value.trim().replace(/\/+$/, '');

    if (!/^https?:\/\//i.test(cacheApiBaseUrl)) {
      setSettingsStatus('Cache API URL must start with http:// or https://', COLOR_DANGER);
      return;
    }

    const payload = { cacheApiBaseUrl };
    if (key) payload.apiKey = key;
    await chrome.storage.local.set(payload);
    setSettingsStatus('✓ Saved!', COLOR_OK);
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2000);
  });

  // Trigger scan on current tab
  scanBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      });
    } catch {}

    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_PANEL' });
    window.close();
  });

  historyRefreshBtn.addEventListener('click', loadHistory);
  historySearch.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadHistory();
  });
});
