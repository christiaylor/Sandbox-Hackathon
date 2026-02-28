// TOS Guardian - Background Service Worker (Google AI Studio / Gemini)
// Uses local Mongo-backed cache API to avoid regenerating summaries for unchanged policies.

const DEFAULT_CACHE_API_BASE = "http://localhost:8787";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_TOS") {
    analyzePolicy({
      text: message.text,
      url: message.url || sender?.tab?.url || "",
      pageLastModified: message.pageLastModified || null,
    })
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ error: err.message });
      });
    return true;
  }

  if (message.type === "ANALYZE_TOS_URL") {
    analyzePolicyFromUrl(message.url || "")
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "ANALYZE_TOS_URLS") {
    analyzePolicyFromUrls(Array.isArray(message.urls) ? message.urls : [])
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "GET_POLICY_HISTORY") {
    getPolicyHistory(message.query || "", message.limit || 30)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function analyzePolicyFromUrl(policyUrl) {
  if (!policyUrl) {
    return { error: "No Terms/Privacy URL provided." };
  }

  const response = await fetch(policyUrl, { method: "GET" });
  if (!response.ok) {
    throw new Error(`Failed to load policy page (${response.status}).`);
  }

  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    throw new Error("Policy link did not return readable HTML/text.");
  }

  const raw = await response.text();
  const text = extractTextFromHtml(raw);
  if (!text || text.length < 200) {
    throw new Error("Policy content was too short to summarize.");
  }

  const sourceLastModified = response.headers.get("last-modified");
  const analysis = await analyzePolicy({
    text,
    url: policyUrl,
    pageLastModified: sourceLastModified,
  });

  return {
    ...analysis,
    analyzed_url: policyUrl,
  };
}

async function analyzePolicyFromUrls(policyUrls) {
  const normalized = Array.from(new Set(policyUrls.filter(Boolean).map((u) => String(u).trim()))).slice(0, 3);
  if (normalized.length === 0) {
    return { error: "No Terms/Privacy URLs provided." };
  }

  const docs = [];
  for (const url of normalized) {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`Failed to load policy page (${response.status}) for ${url}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      throw new Error(`Policy link did not return readable HTML/text: ${url}`);
    }

    const raw = await response.text();
    const text = extractTextFromHtml(raw);
    if (text && text.length >= 200) {
      docs.push({ url, text });
    }
  }

  if (docs.length === 0) {
    throw new Error("Could not extract enough policy text from linked documents.");
  }

  const combined = docs
    .map((d, i) => `DOCUMENT ${i + 1}: ${d.url}\n${d.text}`)
    .join("\n\n");

  let origin = "https://tos-guardian.local";
  try {
    origin = new URL(docs[0].url).origin;
  } catch {}
  const bundleId = await hashText(docs.map((d) => d.url).sort().join("|"));
  const bundleUrl = `${origin}/__legal_bundle__/${bundleId}`;

  const analysis = await analyzePolicy({
    text: combined,
    url: bundleUrl,
    pageLastModified: null,
  });

  return {
    ...analysis,
    analyzed_urls: docs.map((d) => d.url),
  };
}

function extractTextFromHtml(html) {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

  return stripped.substring(0, 12000);
}

async function analyzePolicy({ text, url, pageLastModified }) {
  const contentHash = await hashText(text || "");
  const lookup = await lookupCachedSummary({ url, contentHash });

  if (lookup?.status === "HIT" && lookup.summary) {
    return {
      ...lookup.summary,
      cache_status: "HIT",
      policy_updated_at: lookup.policyUpdatedAt || null,
      generated_at: lookup.generatedAt || null,
    };
  }

  const summary = await analyzeWithGemini(text);
  if (summary?.error) {
    return summary;
  }

  await upsertSummary({
    url,
    contentHash,
    summary,
    sourceLastModified: pageLastModified,
  });

  return {
    ...summary,
    cache_status: lookup?.status === "STALE" ? "REFRESHED" : "MISS",
    policy_updated_at: new Date().toISOString(),
    generated_at: new Date().toISOString(),
  };
}

async function hashText(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function lookupCachedSummary({ url, contentHash }) {
  if (!url || !contentHash) return null;
  const cacheApiBase = await getCacheApiBase();

  try {
    const response = await fetch(`${cacheApiBase}/api/policies/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, contentHash }),
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Cache API is optional in dev; Gemini flow still works when unavailable.
    return null;
  }
}

async function upsertSummary({ url, contentHash, summary, sourceLastModified }) {
  if (!url || !contentHash || !summary) return;
  const cacheApiBase = await getCacheApiBase();

  try {
    await fetch(`${cacheApiBase}/api/policies/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        contentHash,
        summary,
        sourceLastModified,
      }),
    });
  } catch {
    // Ignore cache write failures; analysis is already available to the user.
  }
}

async function getPolicyHistory(query, limit) {
  const cacheApiBase = await getCacheApiBase();
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  params.set("limit", String(Math.max(1, Math.min(Number(limit) || 30, 100))));

  const response = await fetch(`${cacheApiBase}/api/policies/history?${params.toString()}`);
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `History API error ${response.status}`);
  }
  return await response.json();
}

async function getCacheApiBase() {
  const { cacheApiBaseUrl } = await chrome.storage.local.get("cacheApiBaseUrl");
  if (typeof cacheApiBaseUrl === "string" && cacheApiBaseUrl.trim()) {
    return cacheApiBaseUrl.trim().replace(/\/+$/, "");
  }
  return DEFAULT_CACHE_API_BASE;
}

async function analyzeWithGemini(tosText) {
  const { apiKey } = await chrome.storage.local.get("apiKey");

  if (!apiKey) {
    return { error: "NO_API_KEY" };
  }

  const prompt = `You are a legal expert specializing in consumer protection. When given a Terms and Conditions, Privacy Policy, or similar legal document, extract and summarize the most critical information into a standardized Quick Summary.

Return ONLY valid JSON (no markdown, no explanation outside the JSON) in this exact format:

{
  "overall_risk": "Low | Medium | High",
  "overall_risk_reason": "One sentence explanation.",
  "flags": [
    {
      "severity": "HIGH | MEDIUM | LOW",
      "title": "Short title of the concern",
      "description": "Plain English explanation of why this is concerning and what it means for the user."
    }
  ],
  "your_data": "1-2 sentences: what data is collected, whether it's sold or shared with third parties, and retention policy. 'Not specified' if absent.",
  "billing_and_cancellation": "1-2 sentences: auto-renewal, cancellation terms, refund policy, or free trial conditions. 'Not applicable' if none.",
  "dispute_resolution": "1-2 sentences: arbitration requirements, class-action waiver, and governing jurisdiction. 'Not specified' if absent.",
  "account_termination": "1-2 sentences: conditions for account suspension or deletion, and what happens to user data afterward. 'Not specified' if absent.",
  "your_content": "1-2 sentences: who owns content the user creates or uploads, and what license the company claims. 'Not specified' if absent.",
  "changes_to_terms": "1 sentence: how users are notified of changes and whether continued use constitutes acceptance. 'Not specified' if absent."
}

When writing the values for your_data, billing_and_cancellation, dispute_resolution, account_termination, your_content, and changes_to_terms, begin each value with its corresponding emoji label exactly as follows:
- your_data → "🔒 Your Data: ..."
- billing_and_cancellation → "💳 Billing & Cancellation: ..."
- dispute_resolution → "⚖️ Dispute Resolution: ..."
- account_termination → "🚪 Account Termination: ..."
- your_content → "📝 Your Content: ..."
- changes_to_terms → "🔄 Changes to Terms: ..."

Severity levels:
- HIGH: Significant risk to the user (data selling, waiving legal rights, auto-renewal traps, one-sided arbitration, broad liability waivers)
- MEDIUM: Worth knowing (data sharing with third parties, opt-out clauses, content ownership claims, unilateral change rights)
- LOW: Minor concerns (cookie usage, standard contact clauses, minor limitations)

Be neutral and plain-spoken. Only editorialize in the flags and overall_risk_reason fields. If nothing concerning is found, return an empty flags array.

TERMS & CONDITIONS TEXT:
${tosText}`;

  const model = "gemini-2.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1500, temperature: 0.2 },
    }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    const msg = errData.error?.message || `API error ${response.status}`;
    if (response.status === 400 || response.status === 403) {
      throw new Error(
        `Invalid Google AI Studio key. Get one at aistudio.google.com. (${msg})`,
      );
    }
    throw new Error(msg);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const cleaned = rawText.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Failed to parse AI response.");
  }
}
