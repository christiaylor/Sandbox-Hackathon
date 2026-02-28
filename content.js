// TOS Guardian - Content Script
// Detects Terms & Conditions pages and triggers analysis

(function() {
  'use strict';

  const TOS_KEYWORDS = [
    'terms of service', 'terms and conditions', 'terms of use',
    'user agreement', 'end user license agreement', 'eula',
    'privacy policy', 'service agreement', 'legal agreement',
    'conditions of use', 'acceptable use policy'
  ];

  function isTOSPage() {
    const title = document.title.toLowerCase();
    const h1s = Array.from(document.querySelectorAll('h1, h2')).map(el => el.textContent.toLowerCase());
    const url = window.location.href.toLowerCase();
    
    const allText = [title, ...h1s, url].join(' ');
    return TOS_KEYWORDS.some(kw => allText.includes(kw));
  }

  function extractPageText() {
    // Remove scripts, styles, nav, footer to get main content
    const clone = document.body.cloneNode(true);
    const remove = clone.querySelectorAll('script, style, nav, footer, header, aside, iframe');
    remove.forEach(el => el.remove());
    
    const text = clone.innerText || clone.textContent || '';
    // Limit to 8000 chars to stay within API limits
    return text.replace(/\s+/g, ' ').trim().substring(0, 8000);
  }

  function injectPanel() {
    if (document.getElementById('tos-guardian-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tos-guardian-panel';
    panel.innerHTML = `
      <div id="tg-header">
        <div id="tg-logo">
          <span id="tg-shield">🛡️</span>
          <span id="tg-title">TOS Guardian</span>
        </div>
        <div id="tg-controls">
          <button id="tg-analyze-btn">Analyze</button>
          <button id="tg-close-btn">✕</button>
        </div>
      </div>
      <div id="tg-body">
        <div id="tg-status">
          <div class="tg-detected-badge">⚠️ Terms & Conditions Detected</div>
          <p class="tg-hint">Click Analyze to scan for red flags using AI.</p>
        </div>
        <div id="tg-results" style="display:none"></div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #tos-guardian-panel {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 380px;
        max-height: 520px;
        background: #0d0d0f;
        border: 1px solid #2a2a35;
        border-radius: 16px;
        font-family: 'Georgia', serif;
        font-size: 13px;
        color: #e8e6df;
        box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,100,60,0.15);
        z-index: 2147483647;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        animation: tg-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @keyframes tg-slide-in {
        from { opacity: 0; transform: translateY(20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      #tg-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        background: linear-gradient(135deg, #1a0a08 0%, #160814 100%);
        border-bottom: 1px solid #2a2a35;
      }
      #tg-logo {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #tg-shield {
        font-size: 20px;
      }
      #tg-title {
        font-size: 15px;
        font-weight: bold;
        letter-spacing: 0.5px;
        color: #ff6e3c;
      }
      #tg-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #tg-analyze-btn {
        background: linear-gradient(135deg, #ff4a1c, #ff6e3c);
        color: white;
        border: none;
        border-radius: 8px;
        padding: 6px 14px;
        font-size: 12px;
        font-family: 'Georgia', serif;
        cursor: pointer;
        font-weight: bold;
        letter-spacing: 0.3px;
        transition: opacity 0.2s;
      }
      #tg-analyze-btn:hover { opacity: 0.85; }
      #tg-analyze-btn:disabled { opacity: 0.4; cursor: default; }
      #tg-close-btn {
        background: none;
        border: 1px solid #333;
        color: #888;
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      #tg-close-btn:hover { color: #fff; border-color: #666; }
      #tg-body {
        padding: 14px 16px;
        overflow-y: auto;
        flex: 1;
        max-height: 400px;
      }
      .tg-detected-badge {
        display: inline-block;
        background: rgba(255, 74, 28, 0.12);
        border: 1px solid rgba(255, 74, 28, 0.35);
        color: #ff8060;
        border-radius: 8px;
        padding: 5px 10px;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .tg-hint {
        color: #888;
        font-size: 12px;
        margin: 0;
        font-style: italic;
      }
      .tg-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #aaa;
        font-size: 12px;
        padding: 8px 0;
      }
      .tg-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #333;
        border-top-color: #ff6e3c;
        border-radius: 50%;
        animation: tg-spin 0.8s linear infinite;
      }
      @keyframes tg-spin { to { transform: rotate(360deg); } }
      .tg-summary {
        background: rgba(255,255,255,0.03);
        border-left: 3px solid #ff4a1c;
        padding: 10px 12px;
        border-radius: 0 8px 8px 0;
        margin-bottom: 14px;
        font-size: 12px;
        line-height: 1.6;
        color: #ccc;
      }
      .tg-section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #ff6e3c;
        margin: 12px 0 8px;
        font-weight: bold;
      }
      .tg-flag {
        background: rgba(255, 40, 20, 0.07);
        border: 1px solid rgba(255, 60, 30, 0.2);
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 8px;
      }
      .tg-flag-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 4px;
      }
      .tg-severity {
        font-size: 10px;
        font-weight: bold;
        letter-spacing: 0.5px;
        padding: 2px 7px;
        border-radius: 4px;
      }
      .sev-high { background: rgba(220,30,30,0.25); color: #ff6060; border: 1px solid rgba(220,30,30,0.4); }
      .sev-medium { background: rgba(220,140,30,0.2); color: #ffb060; border: 1px solid rgba(220,140,30,0.3); }
      .sev-low { background: rgba(100,100,200,0.15); color: #9090ff; border: 1px solid rgba(100,100,200,0.25); }
      .tg-flag-title {
        font-size: 12px;
        font-weight: bold;
        color: #e0ddd5;
      }
      .tg-flag-desc {
        font-size: 11px;
        color: #999;
        line-height: 1.5;
        margin: 0;
      }
      .tg-ok {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #60c060;
        font-size: 12px;
        padding: 10px;
      }
      .tg-footer {
        font-size: 10px;
        color: #555;
        text-align: center;
        padding-top: 10px;
        border-top: 1px solid #1e1e26;
        margin-top: 6px;
      }
      .tg-no-key {
        background: rgba(255,200,0,0.06);
        border: 1px solid rgba(255,200,0,0.2);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 11px;
        color: #ccc;
        line-height: 1.6;
      }
      .tg-no-key a {
        color: #ff8060;
        text-decoration: none;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById('tg-close-btn').onclick = () => panel.remove();
    document.getElementById('tg-analyze-btn').onclick = () => startAnalysis();
  }

  async function startAnalysis() {
    const btn = document.getElementById('tg-analyze-btn');
    const results = document.getElementById('tg-results');
    const status = document.getElementById('tg-status');

    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    status.style.display = 'none';
    results.style.display = 'block';
    results.innerHTML = `<div class="tg-loading"><div class="tg-spinner"></div> Reading the fine print…</div>`;

    const text = extractPageText();

    // Send to background for API call
    chrome.runtime.sendMessage({ type: 'ANALYZE_TOS', text }, (response) => {
      btn.disabled = false;
      btn.textContent = 'Re-analyze';

      if (response && response.error === 'NO_API_KEY') {
        results.innerHTML = `
          <div class="tg-no-key">
            <strong style="color:#ffb060">🔑 API Key Required</strong><br><br>
            To analyze Terms & Conditions, TOS Guardian needs your Google AI Studio API key.<br><br>
            1. Click the extension icon in Chrome's toolbar<br>
            2. Enter your <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio API key</a><br>
            3. Click Analyze again
          </div>`;
        return;
      }

      if (response && response.flags) {
        renderResults(response, results);
      } else {
        results.innerHTML = `<div class="tg-hint" style="color:#e06060">Analysis failed. ${response?.error || 'Please try again.'}</div>`;
      }
    });
  }

  function renderResults(data, container) {
    const highFlags = data.flags.filter(f => f.severity === 'HIGH');
    const medFlags = data.flags.filter(f => f.severity === 'MEDIUM');
    const lowFlags = data.flags.filter(f => f.severity === 'LOW');

    let html = '';

    if (data.summary) {
      html += `<div class="tg-summary">${escapeHtml(data.summary)}</div>`;
    }

    if (data.flags.length === 0) {
      html += `<div class="tg-ok">✅ No major red flags detected. Still read carefully!</div>`;
    } else {
      const groups = [
        { label: '🔴 High Concern', items: highFlags },
        { label: '🟡 Worth Noting', items: medFlags },
        { label: '🔵 Minor Points', items: lowFlags },
      ];

      for (const group of groups) {
        if (group.items.length === 0) continue;
        html += `<div class="tg-section-title">${group.label}</div>`;
        for (const flag of group.items) {
          const sevClass = flag.severity === 'HIGH' ? 'sev-high' : flag.severity === 'MEDIUM' ? 'sev-medium' : 'sev-low';
          html += `
            <div class="tg-flag">
              <div class="tg-flag-header">
                <span class="tg-severity ${sevClass}">${flag.severity}</span>
                <span class="tg-flag-title">${escapeHtml(flag.title)}</span>
              </div>
              <p class="tg-flag-desc">${escapeHtml(flag.description)}</p>
            </div>`;
        }
      }
    }

    html += `<div class="tg-footer">Powered by Claude · Always read original document</div>`;
    container.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Run detection
  if (isTOSPage()) {
    // Small delay to let page fully render
    setTimeout(injectPanel, 1200);
  }

  // Also listen for messages from popup to trigger manual analysis
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TRIGGER_PANEL') {
      injectPanel();
    }
  });

})();
