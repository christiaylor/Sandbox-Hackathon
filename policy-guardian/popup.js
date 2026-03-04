document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const scanBtn = document.getElementById('scanBtn');

  const COLOR_OK = 'var(--tg-ok)';
  const COLOR_DANGER = 'var(--tg-danger)';

  function setSettingsStatus(message, color) {
    statusEl.style.color = color;
    statusEl.textContent = message;
  }

  const { apiKey } = await chrome.storage.local.get(['apiKey']);
  if (apiKey) {
    apiKeyInput.value = apiKey;
    setSettingsStatus('✓ Settings loaded', COLOR_OK);
  }

  saveBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();

    if (!key) {
      setSettingsStatus('API key is required.', COLOR_DANGER);
      return;
    }

    await chrome.storage.local.set({ apiKey: key });
    setSettingsStatus('✓ Saved!', COLOR_OK);
    setTimeout(() => {
      statusEl.textContent = '';
    }, 2000);
  });

  scanBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_PANEL' });
    window.close();
  });
});
