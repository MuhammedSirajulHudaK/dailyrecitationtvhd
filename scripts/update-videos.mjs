#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   update-videos.mjs — regenerates js/videos.js with every
   video on the channel, so the website itself contains all
   video links (no client-side fetching required).

   Usage:
     node scripts/update-videos.mjs

   Data sources (best available wins, results are MERGED into
   the existing index so it only ever grows):
     - With YT_API_KEY set (env var, or apiKey in js/config.js):
       official YouTube Data API — exact dates, views AND likes.
     - YouTube's public browse endpoint — all videos with titles,
       views and durations (dates approximate, no likes).
     - The channel RSS feed — latest 15 videos with view counts.

   Requires Node 18+ (built-in fetch). No npm dependencies.
   ═══════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const configSrc = readFileSync(join(root, "js", "config.js"), "utf8");
const videosPath = join(root, "js", "videos.js");

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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

  const parseIsoDur = (iso) => {
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
      v.duration = parseIsoDur(it.contentDetails && it.contentDetails.duration);
    });
    process.stdout.write("\rFetched stats " + Math.min(i + 50, videos.length) + "/" + videos.length + "…");
  }
  console.log();
  if (!videos.length) throw new Error("API returned no videos");
  return { videos, source: "api" };
}

/* ── Public browse endpoint (no key) ────────────────────── */
// The web client's public innertube key — embedded in every YouTube
// page; required for youtubei requests from non-browser clients.
const WEB_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE = "https://www.youtube.com/youtubei/v1/browse?key=" + WEB_KEY + "&prettyPrint=false";
const CONTEXT = { client: { clientName: "WEB", clientVersion: "2.20250620.00.00", hl: "en", gl: "US" } };

const browse = (body) =>
  getJson(INNERTUBE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      origin: "https://www.youtube.com",
      referer: "https://www.youtube.com/",
      "x-youtube-client-name": "1",
      "x-youtube-client-version": CONTEXT.client.clientVersion,
    },
    body: JSON.stringify({ context: CONTEXT, ...body }),
  });

const parseViews = (t) => {
  if (!t) return null;
  if (/no views/i.test(t)) return 0;
  const m = String(t).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
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

const text = (t) =>
  (t && (t.simpleText || (t.runs || []).map((r) => r.text).join(""))) || "";

function findToken(node) {
  if (!node || typeof node !== "object") return null;
  if (node.continuationCommand && node.continuationCommand.token) {
    return node.continuationCommand.token;
  }
  for (const key of Object.keys(node)) {
    const t = findToken(node[key]);
    if (t) return t;
  }
  return null;
}

// Renderer names that represent a single video across YouTube layouts.
const VIDEO_RENDERERS = ["videoRenderer", "gridVideoRenderer", "videoWithContextRenderer", "reelItemRenderer"];

function* findRenderers(node) {
  if (!node || typeof node !== "object") return;
  for (const name of VIDEO_RENDERERS) {
    if (node[name] && node[name].videoId) yield { type: "video", r: node[name] };
  }
  // 2024+ layout: videos arrive as lockupViewModel objects.
  if (
    node.lockupViewModel &&
    node.lockupViewModel.contentId &&
    String(node.lockupViewModel.contentType || "").includes("VIDEO")
  ) {
    yield { type: "lockup", r: node.lockupViewModel };
  }
  if (node.continuationItemRenderer) {
    // The token's nesting varies by layout (continuationEndpoint,
    // commandExecutorCommand, …) — search the whole renderer for it.
    const token = findToken(node.continuationItemRenderer);
    if (token) yield { type: "continuation", token };
  }
  for (const key of Object.keys(node)) {
    if (VIDEO_RENDERERS.includes(key) || key === "lockupViewModel") continue;
    const v = node[key];
    if (v && typeof v === "object") yield* findRenderers(v);
  }
}

function rendererToVideo(r) {
  return {
    id: r.videoId,
    title: text(r.title) || text(r.headline),
    published: parseAgo(text(r.publishedTimeText)),
    views: parseViews(text(r.viewCountText) || text(r.shortViewCountText)),
    likes: null,
    duration: parseClock(text(r.lengthText)),
  };
}

function lockupToVideo(l) {
  const meta = l.metadata && l.metadata.lockupMetadataViewModel;
  const title = (meta && meta.title && meta.title.content) || "";
  // Views, upload age and duration live in loosely-structured view-model
  // strings; pattern-match them out of the whole lockup subtree.
  const raw = JSON.stringify(l);
  const viewsM = /"([\d.,]+[KMB]?) views"/.exec(raw);
  const agoM = /"(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)"/.exec(raw);
  const durM = /"((?:\d+:)?\d{1,2}:\d{2})"/.exec(raw);
  return {
    id: l.contentId,
    title,
    published: agoM ? parseAgo(agoM[1]) : 0,
    views: viewsM ? parseViews(viewsM[1]) : null,
    likes: null,
    duration: durM ? parseClock(durM[1]) : null,
  };
}

async function fetchViaBrowse() {
  const videos = [];
  const seen = new Set();
  // "EgZ2aWRlb3PyBgQKAjoA" = the channel's Videos tab (latest first)
  let data = await browse({ browseId: CHANNEL_ID, params: "EgZ2aWRlb3PyBgQKAjoA" });

  for (let page = 0; page < 200; page++) {
    let token = null;
    let found = 0;
    for (const item of findRenderers(data)) {
      if (item.type === "continuation") { token = item.token; continue; }
      const id = item.type === "lockup" ? item.r.contentId : item.r.videoId;
      if (seen.has(id)) continue;
      seen.add(id);
      videos.push(item.type === "lockup" ? lockupToVideo(item.r) : rendererToVideo(item.r));
      found++;
    }
    process.stdout.write("\rFetched " + videos.length + " videos…");
    if (page === 0 && !found) {
      // Surface why the response had no videos, for the Action logs.
      console.log("\nBrowse response top-level keys:", Object.keys(data).join(", "));
      if (data.alerts) console.log("Alerts:", JSON.stringify(data.alerts).slice(0, 500));
      const raw = JSON.stringify(data);
      console.log("Response size:", raw.length, "bytes; first 400 chars:", raw.slice(0, 400));
    }
    if (!token || !found) {
      if (!token) console.log("\nNo continuation token on page " + (page + 1) + " — reached the end.");
      break;
    }
    data = await browse({ continuation: token });
  }
  console.log();
  if (!videos.length) throw new Error("browse endpoint returned no videos");
  return { videos, source: "browse" };
}

/* ── RSS feed (latest 15, includes view counts) ─────────── */
async function fetchViaRss() {
  const res = await fetch(
    "https://www.youtube.com/feeds/videos.xml?channel_id=" + CHANNEL_ID,
    { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error("RSS HTTP " + res.status);
  const xml = await res.text();
  const videos = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml))) {
    const e = m[1];
    const g = (re) => { const r = re.exec(e); return r ? r[1] : ""; };
    const id = g(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    if (!id) continue;
    const viewsAttr = g(/<media:statistics[^>]*views="(\d+)"/);
    videos.push({
      id,
      title: g(/<title>([\s\S]*?)<\/title>/)
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'"),
      published: Date.parse(g(/<published>([^<]+)<\/published>/)) || 0,
      views: viewsAttr ? Number(viewsAttr) : null,
      likes: null,
      duration: null,
    });
  }
  if (!videos.length) throw new Error("RSS feed returned no videos");
  return { videos, source: "rss" };
}

/* ── Merge with the existing index (never shrink) ───────── */
function readExisting() {
  try {
    if (!existsSync(videosPath)) return [];
    const src = readFileSync(videosPath, "utf8");
    const m = src.match(/window\.VIDEO_DATA\s*=\s*(\{[\s\S]*\});/);
    if (!m) return [];
    const data = JSON.parse(m[1]);
    // Discard the hand-written seed entry once real data arrives.
    if (data.source === "seed") return [];
    return Array.isArray(data.videos) ? data.videos : [];
  } catch {
    return [];
  }
}

function merge(existing, fresh) {
  const byId = new Map(existing.map((v) => [v.id, v]));
  for (const v of fresh) {
    const prev = byId.get(v.id) || {};
    byId.set(v.id, {
      ...prev,
      ...v,
      title: v.title || prev.title || "",
      published: v.published || prev.published || 0,
      views: v.views != null ? v.views : prev.views != null ? prev.views : null,
      likes: v.likes != null ? v.likes : prev.likes != null ? prev.likes : null,
      duration: v.duration != null ? v.duration : prev.duration != null ? prev.duration : null,
    });
  }
  return [...byId.values()].sort((a, b) => (b.published || 0) - (a.published || 0));
}

/* ── Main ───────────────────────────────────────────────── */
const attempts = [];
if (API_KEY) attempts.push(["YouTube Data API", fetchViaApi]);
attempts.push(["public browse endpoint", fetchViaBrowse]);
attempts.push(["RSS feed", fetchViaRss]);

let result = null;
for (const [label, fn] of attempts) {
  try {
    console.log("Trying " + label + "…");
    result = await fn();
    break;
  } catch (err) {
    console.warn(label + " failed: " + (err.message || err));
  }
}

const existing = readExisting();

if (!result) {
  if (existing.length) {
    console.log("All sources failed — keeping the existing " + existing.length + "-video index.");
    process.exit(0);
  }
  console.error("All sources failed and no existing index — nothing to write.");
  process.exit(1);
}

const videos = merge(existing, result.videos);
const out =
  "/* AUTO-GENERATED VIDEO INDEX — refreshed by scripts/update-videos.mjs\n" +
  "   Generated: " + new Date().toISOString() +
  " · source: " + result.source + " · " + videos.length + " videos */\n" +
  "window.VIDEO_DATA = " +
  JSON.stringify({ generatedAt: Date.now(), source: result.source, videos }) +
  ";\n";

writeFileSync(videosPath, out);
console.log(
  "Wrote js/videos.js — " + videos.length + " videos total (" +
  result.videos.length + " from " + result.source + ", " + existing.length + " already indexed)");
