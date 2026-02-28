// TOS Guardian - Background Service Worker (Google AI Studio / Gemini)

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_TOS") {
    analyzeWithGemini(message.text)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({ error: err.message });
      });
    return true;
  }
});

async function analyzeWithGemini(tosText) {
  const { apiKey } = await chrome.storage.local.get("apiKey");

  if (!apiKey) {
    return { error: "NO_API_KEY" };
  }

  const prompt = `You are a legal expert specializing in consumer protection. Analyze the following Terms of Service / Terms and Conditions text and identify red flags that users should know before accepting.

Return ONLY valid JSON (no markdown, no explanation outside the JSON) in this exact format:
{
  "summary": "One or two sentence plain-English summary of what this agreement is about and overall risk level.",
  "flags": [
    {
      "severity": "HIGH",
      "title": "Short title of the concern",
      "description": "Plain English explanation of why this is concerning and what it means for the user."
    }
  ]
}

Severity levels:
- HIGH: Significant risk to user (data selling, waiving rights, auto-renewal traps, one-sided arbitration, broad data collection, liability waivers)
- MEDIUM: Worth knowing (data sharing with third parties, opt-out clauses, content ownership claims, unilateral change rights)
- LOW: Minor concerns (cookie usage, standard contact clauses, minor limitations)

Focus on what's genuinely unusual or harmful. If nothing concerning, return an empty flags array.

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
