#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   update-videos.mjs — regenerates js/videos.js with every
   video on the channel, so the website itself contains all
   video links (no client-side fetching required).

   Usage:
     node scripts/update-videos.mjs

   Data source:
     - With YT_API_KEY set (env var, or apiKey in js/config.js):
       official YouTube Data API — exact dates, views AND likes.
     - Without a key: YouTube's public browse endpoint — all
       videos with titles, views and durations (dates are
       approximate, likes unavailable).

   Requires Node 18+ (built-in fetch). No npm dependencies.
   ═══════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configSrc = readFileSync(join(root, "js", "config.js"), "utf8");

const pick = (name) => {
  const m = configSrc.match(new RegExp(name + '\\s*:\\s*"([^"]*)"'));
  return m ? m[1] : "";
};

const CHANNEL_ID = pick("channelId");
const UPLOADS_ID = pick("uploadsPlaylistId") || "UU" + CHANNEL_ID.slice(2);
const API_KEY = process.env.YT_API_KEY || pick("apiKey");

if (!CHANNEL_ID) {
  console.error("Could not read channelId from js/config.js");
  process.exit(1);
}

const getJson = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url.split("?")[0]);
  return res.json();
};

/* ── Official API (with key): everything, exactly ───────── */
async function fetchViaApi() {
  const base = "https://www.googleapis.com/youtube/v3/";
  const items = [];
  let pageToken = "";
  do {
    const data = await getJson(
      base + "playlistItems?part=snippet&maxResults=50&playlistId=" + UPLOADS_ID +
      "&key=" + API_KEY + (pageToken ? "&pageToken=" + pageToken : ""));
    items.push(...(data.items || []));
    pageToken = data.nextPageToken || "";
    process.stdout.write("\rFetched " + items.length + " videos…");
  } while (pageToken);
  console.log();

  const videos = items.map((it) => ({
    id: it.snippet.resourceId.videoId,
    title: it.snippet.title,
    published: Date.parse(it.snippet.publishedAt) || 0,
    views: null,
    likes: null,
    duration: null,
  }));

  const parseDur = (iso) => {
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
    return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
  };

  for (let i = 0; i < videos.length; i += 50) {
    const chunk = videos.slice(i, i + 50);
    const data = await getJson(
      base + "videos?part=statistics,contentDetails&maxResults=50&id=" +
      chunk.map((v) => v.id).join(",") + "&key=" + API_KEY);
    const byId = {};
    (data.items || []).forEach((it) => (byId[it.id] = it));
    chunk.forEach((v) => {
      const it = byId[v.id];
      if (!it) return;
      const s = it.statistics || {};
      v.views = s.viewCount != null ? Number(s.viewCount) : null;
      v.likes = s.likeCount != null ? Number(s.likeCount) : null;
      v.duration = parseDur(it.contentDetails && it.contentDetails.duration);
    });
    process.stdout.write("\rFetched stats " + Math.min(i + 50, videos.length) + "/" + videos.length + "…");
  }
  console.log();
  return { videos, source: "api" };
}

/* ── Public browse endpoint (no key) ────────────────────── */
const INNERTUBE = "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";
const CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20240701.00.00", hl: "en", gl: "US" } };

const browse = (body) =>
  getJson(INNERTUBE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ context: CONTEXT, ...body }),
  });

const parseViews = (t) => {
  if (!t) return null;
  const m = String(t).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return /no views/i.test(t) ? 0 : null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[(m[2] || "").toUpperCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
};

const parseAgo = (t) => {
  const m = /(\d+)\s+(second|minute|hour|day|week|month|year)/.exec(t || "");
  if (!m) return 0;
  const unit = { second: 1e3, minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 26298e5, year: 315576e5 }[m[2]];
  return Date.now() - Number(m[1]) * unit;
};

const parseClock = (t) => {
  const parts = String(t || "").split(":").map((n) => parseInt(n, 10));
  if (parts.some(isNaN) || !parts.length) return null;
  return parts.reduce((s, n) => s * 60 + n, 0);
};

function* findRenderers(node) {
  if (!node || typeof node !== "object") return;
  if (node.videoRenderer) yield { type: "video", r: node.videoRenderer };
  if (node.richItemRenderer && node.richItemRenderer.content) yield* findRenderers(node.richItemRenderer.content);
  if (node.continuationItemRenderer) {
    const token = node.continuationItemRenderer.continuationEndpoint
      && node.continuationItemRenderer.continuationEndpoint.continuationCommand
      && node.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
    if (token) yield { type: "continuation", token };
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (v && typeof v === "object" && key !== "videoRenderer") yield* findRenderers(v);
  }
}

const text = (t) => (t && (t.simpleText || (t.runs || []).map((r) => r.text).join(""))) || "";

async function fetchViaBrowse() {
  const videos = [];
  const seen = new Set();
  // "EgZ2aWRlb3PyBgQKAjoA" = the channel's Videos tab (latest first)
  let data = await browse({ browseId: CHANNEL_ID, params: "EgZ2aWRlb3PyBgQKAjoA" });

  for (let page = 0; page < 200; page++) {
    let token = null;
    for (const found of findRenderers(data)) {
      if (found.type === "continuation") { token = found.token; continue; }
      const r = found.r;
      if (!r.videoId || seen.has(r.videoId)) continue;
      seen.add(r.videoId);
      videos.push({
        id: r.videoId,
        title: text(r.title),
        published: parseAgo(text(r.publishedTimeText)),
        views: parseViews(text(r.viewCountText)),
        likes: null,
        duration: parseClock(text(r.lengthText)),
      });
    }
    process.stdout.write("\rFetched " + videos.length + " videos…");
    if (!token) break;
    data = await browse({ continuation: token });
  }
  console.log();
  if (!videos.length) throw new Error("browse endpoint returned no videos");
  return { videos, source: "browse" };
}

/* ── Main ───────────────────────────────────────────────── */
let result;
if (API_KEY) {
  console.log("Using YouTube Data API (exact views + likes)…");
  result = await fetchViaApi();
} else {
  console.log("No YT_API_KEY set — using public browse endpoint (views only, approximate dates).");
  console.log("Tip: add a free API key for exact dates and the Most Liked section.");
  result = await fetchViaBrowse();
}

result.generatedAt = Date.now();

const out =
  "/* AUTO-GENERATED VIDEO INDEX — refreshed by scripts/update-videos.mjs\n" +
  "   Generated: " + new Date(result.generatedAt).toISOString() +
  " · source: " + result.source + " · " + result.videos.length + " videos */\n" +
  "window.VIDEO_DATA = " + JSON.stringify(result) + ";\n";

writeFileSync(join(root, "js", "videos.js"), out);
console.log("Wrote js/videos.js — " + result.videos.length + " videos (source: " + result.source + ")");
