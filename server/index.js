const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const PORT = Number(process.env.PORT || 8787);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "policy_guardian";
const COLLECTION_NAME = "policy_summaries";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

let collection;

function normalizeUrl(input) {
  try {
    const parsed = new URL(input);
    parsed.hash = "";
    parsed.search = "";

    // Keep pathname case-sensitive, normalize duplicate trailing slash.
    if (parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function parseOptionalDate(input) {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.valueOf()) ? null : date;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/policies/lookup", async (req, res) => {
  const { url, contentHash } = req.body || {};
  const urlNormalized = normalizeUrl(url);

  if (!urlNormalized || !contentHash) {
    return res.status(400).json({ error: "url and contentHash are required" });
  }

  const existing = await collection.findOne(
    { urlNormalized },
    {
      projection: {
        _id: 0,
        summary: 1,
        contentHash: 1,
        policyUpdatedAt: 1,
        generatedAt: 1,
      },
    },
  );

  if (!existing) {
    return res.json({ status: "MISS" });
  }

  if (existing.contentHash === contentHash) {
    return res.json({
      status: "HIT",
      summary: existing.summary,
      policyUpdatedAt: existing.policyUpdatedAt || null,
      generatedAt: existing.generatedAt || null,
    });
  }

  return res.json({
    status: "STALE",
    policyUpdatedAt: existing.policyUpdatedAt || null,
    generatedAt: existing.generatedAt || null,
  });
});

app.post("/api/policies/upsert", async (req, res) => {
  const { url, contentHash, summary, sourceLastModified } = req.body || {};
  const urlNormalized = normalizeUrl(url);

  if (!urlNormalized || !contentHash || !summary || typeof summary !== "object") {
    return res.status(400).json({ error: "url, contentHash, and summary are required" });
  }

  const now = new Date();
  const parsedSourceLastModified = parseOptionalDate(sourceLastModified);
  const existing = await collection.findOne({ urlNormalized }, { projection: { _id: 0, contentHash: 1, firstSeenAt: 1 } });

  const isChanged = !existing || existing.contentHash !== contentHash;

  const update = {
    $set: {
      urlRaw: url,
      urlNormalized,
      contentHash,
      summary,
      sourceLastModified: parsedSourceLastModified,
      generatedAt: now,
      lastCheckedAt: now,
      updatedAt: now,
    },
    $setOnInsert: {
      createdAt: now,
      firstSeenAt: now,
    },
  };

  if (isChanged) {
    update.$set.policyUpdatedAt = now;
  }

  await collection.updateOne({ urlNormalized }, update, { upsert: true });

  return res.json({
    status: !existing ? "CREATED" : isChanged ? "UPDATED" : "UNCHANGED",
    policyUpdatedAt: isChanged ? now : null,
  });
});

app.get("/api/policies/history", async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 30, 100));
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";

  const filter = {};
  if (query) {
    filter.$or = [
      { urlRaw: { $regex: query, $options: "i" } },
      { urlNormalized: { $regex: query, $options: "i" } },
    ];
  }

  const items = await collection
    .find(filter, {
      projection: {
        _id: 0,
        urlRaw: 1,
        urlNormalized: 1,
        policyUpdatedAt: 1,
        generatedAt: 1,
        lastCheckedAt: 1,
        "summary.overall_risk": 1,
        "summary.overall_risk_reason": 1,
      },
    })
    .sort({ generatedAt: -1, updatedAt: -1 })
    .limit(limit)
    .toArray();

  return res.json({ items });
});

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const db = client.db(DB_NAME);
  collection = db.collection(COLLECTION_NAME);
  await collection.createIndex({ urlNormalized: 1 }, { unique: true });
  await collection.createIndex({ policyUpdatedAt: -1 });

  app.listen(PORT, () => {
    console.log(`Cache API listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start cache API:", err);
  process.exit(1);
});
