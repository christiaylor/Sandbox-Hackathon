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

  const ACCOUNT_KEYWORDS = [
    'sign up', 'signup', 'register', 'create account', 'join', 'get started',
    'start free trial', 'free trial', 'new account', 'open account'
  ];

  const LEGAL_LINK_KEYWORDS = [
    'terms', 'terms of service', 'terms of use', 'terms and conditions',
    'privacy', 'privacy policy', 'user agreement', 'eula', 'legal'
  ];

  function isTOSPage() {
    const title = document.title.toLowerCase();
    const h1s = Array.from(document.querySelectorAll('h1, h2')).map(el => el.textContent.toLowerCase());
    const url = window.location.href.toLowerCase();
    
    const allText = [title, ...h1s, url].join(' ');
    return TOS_KEYWORDS.some(kw => allText.includes(kw));
  }

  function isAccountCreationPage() {
    const title = document.title.toLowerCase();
    const url = window.location.href.toLowerCase();
    const headings = Array.from(document.querySelectorAll('h1, h2, h3')).map(el => el.textContent.toLowerCase()).join(' ');
    const buttonText = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .map(el => (el.value || el.textContent || '').toLowerCase())
      .join(' ');
    const formsText = Array.from(document.querySelectorAll('form'))
      .map((el) => (el.innerText || el.textContent || '').toLowerCase())
      .join(' ');
    const authPath = /\/(sign[-_ ]?up|signup|register|create[-_ ]?account|join|new|trial)\b/.test(url);

    const hasSignupLanguage = ACCOUNT_KEYWORDS.some(kw =>
      title.includes(kw) || url.includes(kw.replace(/\s+/g, '')) || headings.includes(kw) || buttonText.includes(kw)
    );

    const hasPassword = !!document.querySelector('input[type="password"]');
    const hasEmail = !!document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
    const hasConsentLanguage = /terms|privacy|agree|consent|policy/.test(formsText);

    return (hasPassword && hasEmail && (hasSignupLanguage || authPath)) || ((hasSignupLanguage || authPath) && hasConsentLanguage);
  }

  function findLegalLinks() {
    const links = Array.from(document.querySelectorAll('a[href]'));
    const seen = new Set();
    const matches = [];

    for (const link of links) {
      const text = (link.textContent || '').trim().toLowerCase();
      const href = link.href ? link.href.trim() : '';
      if (!href) continue;

      const haystack = `${text} ${href.toLowerCase()}`;
      if (!LEGAL_LINK_KEYWORDS.some(kw => haystack.includes(kw))) continue;
      if (href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
      if (seen.has(href)) continue;

      seen.add(href);
      matches.push({
        text: (link.textContent || link.getAttribute('aria-label') || 'Legal link').trim().slice(0, 80),
        href
      });
    }

    return matches.slice(0, 8);
  }

  function detectPageContext() {
    const tosPage = isTOSPage();
    const accountPage = isAccountCreationPage();
    const legalLinks = findLegalLinks();
    return { tosPage, accountPage, legalLinks };
  }

  function pickPrimaryLegalLink(links) {
    if (!links || links.length === 0) return null;
    const scored = links
      .map((link) => {
        const text = `${link.text || ''} ${link.href || ''}`.toLowerCase();
        let score = 0;
        if (text.includes('terms of service')) score += 6;
        if (text.includes('terms and conditions')) score += 6;
        if (text.includes('/terms')) score += 5;
        if (text.includes('privacy policy')) score += 4;
        if (text.includes('/privacy')) score += 3;
        if (text.includes('legal')) score += 1;
        return { link, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0]?.link || links[0];
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

  function injectPanel(context = detectPageContext()) {
    if (document.getElementById('tos-guardian-panel')) return;

    const isDetected = context.tosPage || context.accountPage;
    const badgeText = context.tosPage
      ? '⚠️ Terms/Policy Page Detected'
      : '🧾 Account Creation Page Detected';
    const hintText = context.tosPage
      ? 'Summarize this policy in plain English.'
      : 'Found account flow signals. We will summarize the best Terms/Privacy link we can find.';
    const analyzeLabel = context.tosPage ? 'Summarize' : 'Summarize Terms Link';

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
          ${isDetected ? `<div class="tg-detected-badge">${badgeText}</div>` : ''}
          <p class="tg-hint">${hintText}</p>
          <div id="tg-link-results"></div>
        </div>
        <div id="tg-results" style="display:none"></div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #tos-guardian-panel {
        --tg-gold: #d4af37;
        --tg-bold: #ffffff;
        --tg-bg: #0b111a;
        --tg-body: #c8d0db;
        --tg-surface: #101823;
        --tg-border: #263446;
        --tg-muted: #9ca7b8;
        --tg-accent-soft: rgba(212, 175, 55, 0.14);
        --tg-accent-soft-2: rgba(212, 175, 55, 0.24);
        --tg-danger: #d36a6a;
        --tg-ok: #63b56e;
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 380px;
        max-height: 520px;
        background: var(--tg-bg);
        border: 1px solid var(--tg-border);
        border-radius: 16px;
        font-family: 'Georgia', serif;
        font-size: 13px;
        color: var(--tg-body);
        box-shadow: 0 24px 60px rgba(0,0,0,0.45), 0 0 0 1px var(--tg-accent-soft);
        z-index: 2147483647;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        animation: tg-slide-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      }
      @media (prefers-color-scheme: light) {
        #tos-guardian-panel {
          --tg-gold: #a87e10;
          --tg-bold: #0f1e34;
          --tg-bg: #f2efe8;
          --tg-body: #5a6a7e;
          --tg-surface: #fbf9f4;
          --tg-border: #d4ccbd;
          --tg-muted: #6d7c91;
          --tg-accent-soft: rgba(168, 126, 16, 0.12);
          --tg-accent-soft-2: rgba(168, 126, 16, 0.2);
          --tg-danger: #bf5a5a;
          --tg-ok: #4f9a57;
        }
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
        background: var(--tg-surface);
        border-bottom: 1px solid var(--tg-border);
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
        color: var(--tg-gold);
      }
      #tg-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #tg-analyze-btn {
        background: var(--tg-gold);
        color: var(--tg-bg);
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
        background: transparent;
        border: 1px solid var(--tg-border);
        color: var(--tg-muted);
        border-radius: 6px;
        padding: 4px 8px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }
      #tg-close-btn:hover { color: var(--tg-bold); border-color: var(--tg-gold); }
      #tg-body {
        padding: 14px 16px;
        overflow-y: auto;
        flex: 1;
        max-height: 400px;
      }
      .tg-detected-badge {
        display: inline-block;
        background: var(--tg-accent-soft);
        border: 1px solid var(--tg-accent-soft-2);
        color: var(--tg-gold);
        border-radius: 8px;
        padding: 5px 10px;
        font-size: 12px;
        margin-bottom: 8px;
      }
      .tg-hint {
        color: var(--tg-body);
        font-size: 12px;
        margin: 0;
        font-style: italic;
      }
      #tg-link-results {
        margin-top: 10px;
      }
      .tg-link-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        color: var(--tg-gold);
        margin-bottom: 6px;
      }
      .tg-link-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        border: 1px solid var(--tg-border);
        border-radius: 8px;
        padding: 8px 10px;
        margin-bottom: 6px;
      }
      .tg-link-name {
        color: var(--tg-body);
        font-size: 11px;
        line-height: 1.3;
      }
      .tg-link-open {
        color: var(--tg-gold);
        font-size: 11px;
        text-decoration: none;
        white-space: nowrap;
      }
      .tg-link-open:hover {
        text-decoration: underline;
      }
      .tg-loading {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--tg-body);
        font-size: 12px;
        padding: 8px 0;
      }
      .tg-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--tg-border);
        border-top-color: var(--tg-gold);
        border-radius: 50%;
        animation: tg-spin 0.8s linear infinite;
      }
      @keyframes tg-spin { to { transform: rotate(360deg); } }
      .tg-summary {
        background: var(--tg-accent-soft);
        border-left: 3px solid var(--tg-gold);
        padding: 10px 12px;
        border-radius: 0 8px 8px 0;
        margin-bottom: 14px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--tg-body);
      }
      .tg-section-title {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: var(--tg-gold);
        margin: 12px 0 8px;
        font-weight: bold;
      }
      .tg-flag {
        background: var(--tg-accent-soft);
        border: 1px solid var(--tg-accent-soft-2);
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
      .sev-high { background: rgba(191, 90, 90, 0.22); color: var(--tg-bold); border: 1px solid rgba(191, 90, 90, 0.45); }
      .sev-medium { background: var(--tg-accent-soft-2); color: var(--tg-gold); border: 1px solid var(--tg-gold); }
      .sev-low { background: rgba(90, 106, 126, 0.2); color: var(--tg-body); border: 1px solid rgba(90, 106, 126, 0.45); }
      .tg-flag-title {
        font-size: 12px;
        font-weight: bold;
        color: var(--tg-bold);
      }
      .tg-flag-desc {
        font-size: 11px;
        color: var(--tg-body);
        line-height: 1.5;
        margin: 0;
      }
      .tg-ok {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--tg-ok);
        font-size: 12px;
        padding: 10px;
      }
      .tg-footer {
        font-size: 10px;
        color: var(--tg-body);
        text-align: center;
        padding-top: 10px;
        border-top: 1px solid var(--tg-border);
        margin-top: 6px;
      }
      .tg-no-key {
        background: var(--tg-accent-soft);
        border: 1px solid var(--tg-accent-soft-2);
        border-radius: 8px;
        padding: 10px 12px;
        font-size: 11px;
        color: var(--tg-body);
        line-height: 1.6;
      }
      .tg-no-key a {
        color: var(--tg-gold);
        text-decoration: none;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    document.getElementById('tg-analyze-btn').textContent = analyzeLabel;
    document.getElementById('tg-close-btn').onclick = () => panel.remove();
    document.getElementById('tg-analyze-btn').onclick = () => startAnalysis();
    renderLegalLinks(context.legalLinks);
  }

  function renderLegalLinks(links) {
    const container = document.getElementById('tg-link-results');
    if (!container) return;
    if (!links.length) {
      container.innerHTML = '';
      return;
    }

    const html = links.map((link) => `
      <div class="tg-link-item">
        <div class="tg-link-name">${escapeHtml(link.text || 'Legal link')}</div>
        <a class="tg-link-open" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">Open</a>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="tg-link-title">Likely Terms / Privacy Links</div>
      ${html}
      <p class="tg-hint" style="margin-top:4px">Open a legal link, then use Summarize on that page.</p>
    `;
  }

  async function startAnalysis() {
    const btn = document.getElementById('tg-analyze-btn');
    const results = document.getElementById('tg-results');
    const status = document.getElementById('tg-status');
    const context = detectPageContext();

    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    status.style.display = 'none';
    results.style.display = 'block';
    results.innerHTML = `<div class="tg-loading"><div class="tg-spinner"></div> Reading the fine print…</div>`;

    const pageLastModified = document.lastModified || null;
    const pageUrl = window.location.href;
    const primaryLink = !context.tosPage ? pickPrimaryLegalLink(context.legalLinks) : null;
    const message = primaryLink
      ? { type: 'ANALYZE_TOS_URL', url: primaryLink.href }
      : { type: 'ANALYZE_TOS', text: extractPageText(), url: pageUrl, pageLastModified };

    chrome.runtime.sendMessage(message, (response) => {
      btn.disabled = false;
      btn.textContent = 'Re-analyze';

      if (response && response.error === 'NO_API_KEY') {
        results.innerHTML = `
          <div class="tg-no-key">
            <strong style="color:var(--tg-gold)">🔑 API Key Required</strong><br><br>
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
        results.innerHTML = `<div class="tg-hint" style="color:var(--tg-danger)">Analysis failed. ${response?.error || 'Please try again.'}</div>`;
      }
    });
  }

  function renderResults(data, container) {
    const flags = Array.isArray(data.flags) ? data.flags : [];
    const highFlags = flags.filter(f => f.severity === 'HIGH');
    const medFlags = flags.filter(f => f.severity === 'MEDIUM');
    const lowFlags = flags.filter(f => f.severity === 'LOW');

    let html = '';

    if (data.analyzed_url) {
      html += `<div class="tg-hint" style="margin-bottom:8px">Summarized: <a class="tg-link-open" href="${escapeHtml(data.analyzed_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(data.analyzed_url)}</a></div>`;
    }

    if (data.cache_status) {
      const cacheLabel = data.cache_status === 'HIT'
        ? 'Loaded from policy history'
        : data.cache_status === 'REFRESHED'
          ? 'Policy changed, summary regenerated'
          : 'New policy summary generated';
      html += `<div class="tg-hint" style="margin-bottom:10px;color:var(--tg-gold)">${escapeHtml(cacheLabel)}</div>`;
    }

    const summaryBits = [
      data.overall_risk ? `Risk: ${data.overall_risk}` : '',
      data.overall_risk_reason || '',
      data.your_data || '',
      data.billing_and_cancellation || '',
      data.dispute_resolution || '',
      data.account_termination || '',
      data.your_content || '',
      data.changes_to_terms || ''
    ].filter(Boolean);

    if (summaryBits.length) {
      html += `<div class="tg-summary">${escapeHtml(summaryBits.join('\n\n')).replace(/\n/g, '<br>')}</div>`;
    }

    if (flags.length === 0) {
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

    html += `<div class="tg-footer">Powered by Gemini · Always read original document</div>`;
    container.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Run detection
  const pageContext = detectPageContext();
  const shouldAutoInject = pageContext.tosPage || (pageContext.accountPage && pageContext.legalLinks.length > 0);
  if (shouldAutoInject) {
    // Small delay to let page fully render
    setTimeout(() => injectPanel(pageContext), 1200);
  }

  // Also listen for messages from popup to trigger manual analysis
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TRIGGER_PANEL') {
      injectPanel(detectPageContext());
    }
  });

})();
