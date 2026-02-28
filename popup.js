document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusEl = document.getElementById('status');
  const scanBtn = document.getElementById('scanBtn');

  // Load saved key
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (apiKey) {
    apiKeyInput.value = apiKey;
    statusEl.textContent = '✓ Key saved';
  }

  // Save key
  saveBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      statusEl.style.color = '#e06060';
      statusEl.textContent = 'Please enter an API key.';
      return;
    }
    await chrome.storage.local.set({ apiKey: key });
    statusEl.style.color = '#60c060';
    statusEl.textContent = '✓ Saved!';
    setTimeout(() => { statusEl.textContent = ''; }, 2000);
  });

  // Trigger scan on current tab
  scanBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Inject content script if not already there, then trigger panel
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch {}

    chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_PANEL' });
    window.close();
  });
});
