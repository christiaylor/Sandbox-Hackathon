// Policy Guardian - Content Script
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
  const SEARCH_ENGINE_HOST_PATTERNS = [
    /(^|\.)google\./i,
    /(^|\.)duckduckgo\.com$/i,
    /(^|\.)bing\.com$/i,
    /(^|\.)search\.yahoo\.com$/i,
    /(^|\.)yandex\./i,
    /(^|\.)baidu\.com$/i,
    /(^|\.)ecosia\.org$/i,
    /(^|\.)startpage\.com$/i,
    /(^|\.)brave\.com$/i,
    /(^|\.)qwant\.com$/i,
  ];

  function isSearchEnginePage() {
    let host = '';
    try {
      host = window.location.hostname.toLowerCase();
    } catch {
      return false;
    }

    return SEARCH_ENGINE_HOST_PATTERNS.some((pattern) => pattern.test(host));
  }

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
    const authPath = /\/(sign[-_ ]?up|signup|register|create[-_ ]?account|join|auth|login)\b/.test(url);

    const hasSignupLanguage = ACCOUNT_KEYWORDS.some(kw =>
      title.includes(kw) || url.includes(kw.replace(/\s+/g, '')) || headings.includes(kw) || buttonText.includes(kw)
    );

    const hasPassword = !!document.querySelector('input[type="password"]');
    const hasEmail = !!document.querySelector('input[type="email"], input[name*="email" i], input[id*="email" i]');
    const hasConsentLanguage = /terms|privacy|agree|consent|policy/.test(formsText);
    const hasLegalAgreementAnchors = !!document.querySelector('a[href*="terms" i], a[href*="privacy" i], a[href*="legal" i]');
    const hasSocialAuth = /(continue|sign|log).*(google|github|gitlab|apple|microsoft|facebook)|google|github|gitlab|apple|microsoft|facebook/.test(buttonText);
    const hasAuthUiElements = hasEmail || hasPassword || hasSocialAuth;

    return (hasSignupLanguage || authPath) && (hasAuthUiElements || hasConsentLanguage || hasLegalAgreementAnchors);
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

  function pickServiceLegalBundleLinks(links) {
    if (!links || links.length === 0) return [];
    const scored = links
      .map((link) => {
        const text = `${link.text || ''} ${link.href || ''}`.toLowerCase();
        let score = 0;
        let type = 'other';
        if (text.includes('terms of service') || text.includes('terms and conditions') || text.includes('/terms')) {
          score += 10;
          type = 'terms';
        } else if (text.includes('privacy policy') || text.includes('/privacy')) {
          score += 9;
          type = 'privacy';
        } else if (text.includes('legal')) {
          score += 4;
        }
        return { link, score, type };
      })
      .sort((a, b) => b.score - a.score);

    const terms = scored.find((s) => s.type === 'terms');
    const privacy = scored.find((s) => s.type === 'privacy');
    const selected = [];
    if (terms) selected.push(terms.link);
    if (privacy && (!terms || privacy.link.href !== terms.link.href)) selected.push(privacy.link);
    if (selected.length === 0 && scored[0]) selected.push(scored[0].link);
    return selected.slice(0, 2);
  }

  function buildFallbackLegalLinks(pageUrl) {
    try {
      const origin = new URL(pageUrl).origin;
      return [
        { text: 'Terms of Service', href: `${origin}/terms` },
        { text: 'Terms of Service', href: `${origin}/legal/terms` },
        { text: 'Privacy Policy', href: `${origin}/privacy` },
        { text: 'Privacy Policy', href: `${origin}/legal/privacy` },
      ];
    } catch {
      return [];
    }
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
    if (document.getElementById('policy-guardian-panel')) return;

    const isDetected = context.tosPage || context.accountPage;
    const badgeText = context.tosPage
      ? '⚠️ Terms/Policy Page Detected'
      : '🧾 Account Creation Page Detected';
    const hintText = context.tosPage
      ? 'Summarize this policy in plain English.'
      : 'Found an account creation flow. Summarize will analyze Terms/Privacy documents for this service.';
    const analyzeLabel = context.tosPage ? 'Summarize' : 'Summarize Docs';

    const panel = document.createElement('div');
    panel.id = 'policy-guardian-panel';
    panel.innerHTML = `
      <div id="tg-header">
        <div id="tg-logo">
          <svg id="tg-logo-mark" viewBox="0 0 742 684" aria-hidden="true">
            <path fill="currentColor" d="M347.827,62.859c-.314-.28.021-.007-.036-.058-.041-.024-.721-.296-2.157-.543-1.042-.236-2.39-.206-3.441-.348-10.424-.259-19.85,1.313-30.644,3.031-33.31,5.694-73.711,15.666-107.243,22.718-50.82,10.993-123.586,25.554-175.372,35.231.001,0,17.821-22.751,17.821-22.751-.007.064-.01.251-.012.44,0,0-.006.562-.006.562l-.004,1.195c.042,5.955.217,11.879.53,17.856,8.964,163.155,77.11,324.741,197.447,436.826,39.723,37.254,84.78,68.95,132.993,94.236,0,0-15.284,0-15.284,0,32.046-18.008,63.124-38.686,91.442-62.113,114.546-93.087,188.016-229.599,218.965-372.695,2.573-11.941,4.917-23.922,6.964-35.941,0,0,32.555,30.682,32.555,30.682-71.963,18.798-145.73,35.853-220.662,39.873-41.741,1.286-88.5.264-124.685-24.942-16.491-11.769-29.038-30.214-32.955-50.387-6.006-27.765,3.12-57.574,10.118-83.036,1.252-4.721,2.375-9.213,3.174-13.276,1.093-5.771,2.002-11.637.958-15.783-.107-.326-.162-.4-.197-.455-.039-.052-.073-.111-.272-.323h0ZM392.295,19.655c24.391,25.267,20.111,58.654,11.536,89.029-4.507,18.003-13.702,42.197-8.86,58.009,5.142,13.855,24.492,18.746,38.765,21.739,27.545,5.092,57.262,4.014,85.386,1.881,50.257-4.159,100.81-13.422,150.29-24.064,19.759-4.25,50.975-11.378,70.829-15.726-5.887,28.807-12.828,64.117-20.689,92.114-50.777,186.318-168.979,347.429-341.85,436.976,0,0-7.836,4.163-7.836,4.163,0,0-7.447-4.162-7.447-4.162C201.808,591.326,96.358,447.285,38.888,275.217,20.441,219.294,6.314,161.566,1.161,102.756c0,0-.102-1.699-.102-1.699,0,0-1.059-17.629-1.059-17.629l18.88-5.123C80.466,61.952,217.769,23.284,277.827,9.36,297.774,4.908,318.104.485,339.049.016c19.617-.34,38.934,4.826,53.247,19.64h0Z"/>
          </svg>
          <span id="tg-title">Policy Guardian</span>
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
        </div>
        <div id="tg-results" style="display:none"></div>
      </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #policy-guardian-panel {
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
        #policy-guardian-panel {
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
      #tg-logo-mark {
        width: 20px;
        height: 20px;
        color: var(--tg-gold);
        flex: 0 0 auto;
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
      .tg-risk-card {
        border: 1px solid var(--tg-accent-soft-2);
        border-radius: 10px;
        padding: 10px 12px;
        margin-bottom: 10px;
        background: var(--tg-accent-soft);
      }
      .tg-risk-score {
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 0.8px;
      }
      .tg-risk-reason {
        margin-top: 6px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--tg-body);
      }
      .tg-risk-high .tg-risk-score { color: var(--tg-danger); }
      .tg-risk-medium .tg-risk-score { color: var(--tg-gold); }
      .tg-risk-low .tg-risk-score { color: var(--tg-ok); }
      .tg-sentence-summary {
        margin-bottom: 12px;
        font-size: 13px;
        line-height: 1.6;
        color: var(--tg-bold);
      }
      .tg-categories {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-bottom: 12px;
      }
      .tg-category-card {
        border: 1px solid var(--tg-border);
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 11px;
        line-height: 1.5;
        color: var(--tg-body);
      }
      .tg-empty-group {
        font-size: 11px;
        color: var(--tg-muted);
        margin: 0 0 10px;
        padding: 6px 2px;
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
    const candidateLinks = context.tosPage
      ? []
      : [...context.legalLinks, ...buildFallbackLegalLinks(pageUrl)];
    const bundleLinks = pickServiceLegalBundleLinks(candidateLinks);
    const primaryLink = pickPrimaryLegalLink(candidateLinks);
    const message = bundleLinks.length >= 2
      ? { type: 'ANALYZE_TOS_URLS', urls: bundleLinks.map((l) => l.href) }
      : primaryLink
        ? { type: 'ANALYZE_TOS_URL', url: primaryLink.href }
        : { type: 'ANALYZE_TOS', text: extractPageText(), url: pageUrl, pageLastModified };

    chrome.runtime.sendMessage(message, (response) => {
      btn.disabled = false;
      btn.textContent = 'Re-analyze';

      if (response && response.error === 'NO_API_KEY') {
        results.innerHTML = `
          <div class="tg-no-key">
            <strong style="color:var(--tg-gold)">🔑 API Key Required</strong><br><br>
            To analyze Terms & Conditions, Policy Guardian needs your Google AI Studio API key.<br><br>
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
    if (Array.isArray(data.analyzed_urls) && data.analyzed_urls.length) {
      const links = data.analyzed_urls
        .map((u) => `<a class="tg-link-open" href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a>`)
        .join(', ');
      html += `<div class="tg-hint" style="margin-bottom:8px">Summarized docs: ${links}</div>`;
    }

    if (data.cache_status) {
      const cacheLabel = data.cache_status === 'HIT'
        ? 'Loaded from policy history'
        : data.cache_status === 'REFRESHED'
          ? 'Policy changed, summary regenerated'
          : 'New policy summary generated';
      html += `<div class="tg-hint" style="margin-bottom:10px;color:var(--tg-gold)">${escapeHtml(cacheLabel)}</div>`;
    }

    const riskValueRaw = (data.overall_risk || 'Unknown').toString();
    const riskValue = riskValueRaw.toUpperCase();
    const riskClass = riskValue.includes('HIGH')
      ? 'tg-risk-high'
      : riskValue.includes('MED')
        ? 'tg-risk-medium'
        : riskValue.includes('LOW')
          ? 'tg-risk-low'
          : '';
    const riskSummary =
      data.risk_summary ||
      [data.overall_risk_reason, data.plain_language_summary, data.summary].filter(Boolean).join(' ');
    const riskReason = riskSummary || 'No summary returned.';
    html += `
      <div class="tg-risk-card ${riskClass}">
        <div class="tg-risk-score">OVERALL RISK: ${escapeHtml(riskValue)}</div>
        <div class="tg-risk-reason">${escapeHtml(riskReason)}</div>
      </div>
    `;

    const groups = [
      { label: `🔴 High Concern (${highFlags.length})`, items: highFlags },
      { label: `🟡 Worth Noting (${medFlags.length})`, items: medFlags },
      { label: `🔵 Minor Points (${lowFlags.length})`, items: lowFlags },
    ];

    for (const group of groups) {
      html += `<div class="tg-section-title">${group.label}</div>`;
      if (group.items.length === 0) {
        html += `<p class="tg-empty-group">No concerns in this category.</p>`;
        continue;
      }
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

    const categories = [
      data.your_data,
      data.billing_and_cancellation,
      data.dispute_resolution,
      data.account_termination,
      data.your_content,
      data.changes_to_terms,
    ].filter(Boolean);

    if (categories.length) {
      html += `<div class="tg-section-title">Policy Breakdown</div>`;
      html += '<div class="tg-categories">';
      html += categories.map((line) => `<div class="tg-category-card">${escapeHtml(line)}</div>`).join('');
      html += '</div>';
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
  const shouldAutoInject = !isSearchEnginePage() && (pageContext.tosPage || pageContext.accountPage);
  if (shouldAutoInject) {
    // Small delay to let page fully render
    setTimeout(() => injectPanel(pageContext), 1200);
  }

  // Also listen for messages from popup to trigger manual analysis
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TRIGGER_PANEL') {
      if (isSearchEnginePage()) return;
      injectPanel(detectPageContext());
    }
  });

})();
