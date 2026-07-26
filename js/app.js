/* ═══════════════════════════════════════════════════════════
   Daily Recitation TV HD — site logic

   Builds a full video index for the channel, then renders:
     Latest · Most Viewed · Most Liked · All Videos (search/sort)

   Data sources:
     0. js/videos.js — the baked-in index of ALL the channel's
        video links (kept fresh by scripts/update-videos.mjs and
        the GitHub Action). Renders instantly, works offline.
     Then a live refresh on top, in order of preference:
     1. YouTube Data API v3  (if an apiKey is configured — exact
        views AND likes, powers the "Most Liked" section)
     2. Public Invidious / Piped mirrors (no key needed — titles,
        dates and view counts)
     3. Channel RSS feed via rss2json (latest 15 videos only)
   Live results are cached in localStorage for 1 hour.
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const cfg = window.SITE_CONFIG || SITE_CONFIG;

  const channelUrl = "https://www.youtube.com/" + cfg.channelHandle;
  const subscribeUrl = channelUrl + "?sub_confirmation=1";
  const videosUrl = channelUrl + "/videos";
  const playlistsUrl = channelUrl + "/playlists";

  const CACHE_KEY = "drtv_videos_v2_" + (cfg.apiKey ? "api" : "pub") + "_" + cfg.maxVideosToIndex;
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour

  /* ── Static link wiring ──────────────────────────────── */
  const $ = (id) => document.getElementById(id);
  const setHref = (id, url) => { const el = $(id); if (el) el.href = url; };

  setHref("nav-subscribe", subscribeUrl);
  setHref("hero-subscribe", subscribeUrl);
  setHref("cta-subscribe", subscribeUrl);
  setHref("all-videos-link", videosUrl);
  setHref("all-playlists-link", playlistsUrl);
  setHref("share-channel", channelUrl);
  setHref("share-wa", "https://wa.me/?text=" + encodeURIComponent(
    "Listen to beautiful Quran recitations on " + cfg.channelName + " — " + channelUrl));

  $("year").textContent = new Date().getFullYear();

  const player = $("featured-player");
  if (player && cfg.uploadsPlaylistId) {
    player.src = "https://www.youtube.com/embed/videoseries?list=" + cfg.uploadsPlaylistId + "&rel=0";
  }

  /* ── Mobile nav ──────────────────────────────────────── */
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    links.addEventListener("click", (e) => {
      if (e.target.closest("a")) links.classList.remove("open");
    });
  }

  /* ── Copy channel link ───────────────────────────────── */
  const copyBtn = $("copy-link");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(channelUrl);
        copyBtn.textContent = "✓ Link copied!";
      } catch {
        copyBtn.textContent = channelUrl;
      }
      setTimeout(() => (copyBtn.textContent = "⧉ Copy channel link"), 2500);
    });
  }

  /* ── Helpers ─────────────────────────────────────────── */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const compact = (n) => {
    if (n == null || isNaN(n)) return "";
    try {
      return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
    } catch {
      return String(n);
    }
  };

  const fmtDate = (ts) => {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return "";
    }
  };

  const fetchJson = async (url, timeoutMs) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  };

  /* Video shape: { id, title, published (ms), views (n|null), likes (n|null) } */

  /* ── Source 1: YouTube Data API ──────────────────────── */
  async function fetchViaApi() {
    const base = "https://www.googleapis.com/youtube/v3/";
    const cap = cfg.maxVideosToIndex || 600;
    let items = [];
    let pageToken = "";
    while (items.length < cap) {
      const data = await fetchJson(
        base + "playlistItems?part=snippet&maxResults=50&playlistId=" + cfg.uploadsPlaylistId +
        "&key=" + cfg.apiKey + (pageToken ? "&pageToken=" + pageToken : ""), 12000);
      items = items.concat(data.items || []);
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    items = items.slice(0, cap);

    const videos = items.map((it) => ({
      id: it.snippet.resourceId.videoId,
      title: it.snippet.title,
      published: Date.parse(it.snippet.publishedAt) || 0,
      views: null,
      likes: null,
    }));

    // Fetch statistics in chunks of 50.
    for (let i = 0; i < videos.length; i += 50) {
      const chunk = videos.slice(i, i + 50);
      const data = await fetchJson(
        base + "videos?part=statistics&maxResults=50&id=" +
        chunk.map((v) => v.id).join(",") + "&key=" + cfg.apiKey, 12000);
      const stats = {};
      (data.items || []).forEach((it) => (stats[it.id] = it.statistics || {}));
      chunk.forEach((v) => {
        const s = stats[v.id];
        if (s) {
          v.views = s.viewCount != null ? Number(s.viewCount) : null;
          v.likes = s.likeCount != null ? Number(s.likeCount) : null;
        }
      });
    }
    return { videos, source: "api" };
  }

  /* ── Source 2: Invidious mirrors ─────────────────────── */
  const INVIDIOUS_INSTANCES = [
    "https://inv.nadeko.net",
    "https://yewtu.be",
    "https://invidious.nerdvpn.de",
    "https://iv.ggtyler.dev",
  ];

  async function fetchViaInvidious(base) {
    const cap = cfg.maxVideosToIndex || 600;
    let videos = [];
    let continuation = "";
    for (let page = 0; page < 20 && videos.length < cap; page++) {
      const url = base + "/api/v1/channels/" + cfg.channelId + "/videos" +
        (continuation ? "?continuation=" + encodeURIComponent(continuation) : "");
      const data = await fetchJson(url, 9000);
      const list = Array.isArray(data) ? data : data.videos || [];
      if (!list.length) break;
      videos = videos.concat(list.map((v) => ({
        id: v.videoId,
        title: v.title,
        published: (v.published || 0) * 1000,
        views: v.viewCount != null ? Number(v.viewCount) : null,
        likes: null,
      })));
      continuation = !Array.isArray(data) && data.continuation;
      if (!continuation) break;
    }
    if (!videos.length) throw new Error("empty from " + base);
    return { videos: videos.slice(0, cap), source: "invidious" };
  }

  /* ── Source 3: Piped mirrors ─────────────────────────── */
  const PIPED_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://api.piped.private.coffee",
    "https://pipedapi.reallyaweso.me",
  ];

  async function fetchViaPiped(base) {
    const cap = cfg.maxVideosToIndex || 600;
    let data = await fetchJson(base + "/channel/" + cfg.channelId, 9000);
    let videos = [];
    for (let page = 0; page < 20 && videos.length < cap; page++) {
      const list = data.relatedStreams || [];
      videos = videos.concat(list.map((v) => ({
        id: (v.url || "").replace("/watch?v=", ""),
        title: v.title,
        published: v.uploaded || 0,
        views: v.views != null ? Number(v.views) : null,
        likes: null,
      })));
      if (!data.nextpage) break;
      data = await fetchJson(base + "/nextpage/channel/" + cfg.channelId +
        "?nextpage=" + encodeURIComponent(data.nextpage), 9000);
    }
    videos = videos.filter((v) => v.id);
    if (!videos.length) throw new Error("empty from " + base);
    return { videos: videos.slice(0, cap), source: "piped" };
  }

  /* ── Source 4: RSS (latest 15 only) ──────────────────── */
  async function fetchViaRss() {
    const feed = "https://www.youtube.com/feeds/videos.xml?channel_id=" + cfg.channelId;
    const data = await fetchJson(
      "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed), 9000);
    if (data.status !== "ok") throw new Error("rss2json " + data.status);
    const videos = (data.items || []).map((it) => {
      const id = (it.link.match(/[?&]v=([\w-]+)/) || [])[1] || "";
      return { id, title: it.title, published: Date.parse(it.pubDate) || 0, views: null, likes: null };
    }).filter((v) => v.id);
    if (!videos.length) throw new Error("rss empty");
    return { videos, source: "rss" };
  }

  /* ── Orchestrator with cache ─────────────────────────── */
  async function loadVideoIndex() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.at < CACHE_TTL && cached.videos.length) return cached;
    } catch { /* ignore */ }

    const attempts = [];
    if (cfg.apiKey) attempts.push(() => fetchViaApi());
    INVIDIOUS_INSTANCES.forEach((b) => attempts.push(() => fetchViaInvidious(b)));
    PIPED_INSTANCES.forEach((b) => attempts.push(() => fetchViaPiped(b)));
    attempts.push(() => fetchViaRss());

    let lastErr;
    for (const attempt of attempts) {
      try {
        const result = await attempt();
        result.at = Date.now();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch { /* full */ }
        return result;
      } catch (err) {
        lastErr = err;
        console.warn("Video source failed:", err.message || err);
      }
    }
    throw lastErr || new Error("all sources failed");
  }

  /* ── Rendering ───────────────────────────────────────── */
  const fmtDur = (secs) => {
    if (secs == null || isNaN(secs)) return "";
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
    const mm = h ? String(m).padStart(2, "0") : String(m);
    return (h ? h + ":" : "") + mm + ":" + String(s).padStart(2, "0");
  };

  const videoCard = (v) => `
    <a class="video-card" href="https://www.youtube.com/watch?v=${esc(v.id)}"
       data-video-id="${esc(v.id)}" target="_blank" rel="noopener">
      <div class="thumb">
        <img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" loading="lazy" />
        <span class="play-badge" aria-hidden="true">▶</span>
        ${v.duration != null ? `<span class="dur-badge">${fmtDur(v.duration)}</span>` : ""}
        ${v.views != null ? `<span class="view-badge">👁 ${compact(v.views)}</span>` : ""}
      </div>
      <div class="video-meta">
        <h3>${esc(v.title)}</h3>
        <p class="meta-line">
          ${v.published ? `<time datetime="${new Date(v.published).toISOString()}">${fmtDate(v.published)}</time>` : ""}
          ${v.views != null ? `<span>· ${compact(v.views)} views</span>` : ""}
          ${v.likes != null ? `<span>· 👍 ${compact(v.likes)}</span>` : ""}
        </p>
      </div>
    </a>`;

  const fallbackNote = (label, url) => `
    <div class="fallback-note">
      <p>Couldn't load this section automatically right now.</p>
      <p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a></p>
    </div>`;

  /* ── Video modal (play on the page) ──────────────────── */
  const modal = $("video-modal");
  const modalPlayer = $("modal-player");

  function openModal(v) {
    modalPlayer.src = "https://www.youtube.com/embed/" + v.id + "?autoplay=1&rel=0";
    $("modal-title").textContent = v.title;
    $("modal-stats").textContent = [
      v.views != null ? compact(v.views) + " views" : "",
      v.likes != null ? compact(v.likes) + " likes" : "",
      v.published ? fmtDate(v.published) : "",
    ].filter(Boolean).join(" · ");
    $("modal-yt-link").href = "https://www.youtube.com/watch?v=" + v.id;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    modal.hidden = true;
    modalPlayer.src = "";
    document.body.style.overflow = "";
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !modal.hidden) closeModal();
    });
  }

  let videoById = {};
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".video-card[data-video-id]");
    if (!card || !modal) return;
    const v = videoById[card.dataset.videoId];
    if (!v) return; // fall through to the normal YouTube link
    e.preventDefault();
    openModal(v);
  });

  /* ── All Videos: search / sort / pagination ──────────── */
  const state = { videos: [], filtered: [], shown: 0 };

  function applyFilter() {
    const q = ($("search-input").value || "").trim().toLowerCase();
    const sort = $("sort-select").value;
    let list = state.videos;
    if (q) list = list.filter((v) => v.title.toLowerCase().includes(q));
    list = list.slice();
    if (sort === "newest") list.sort((a, b) => b.published - a.published);
    else if (sort === "oldest") list.sort((a, b) => a.published - b.published);
    else if (sort === "views") list.sort((a, b) => (b.views || 0) - (a.views || 0));
    else if (sort === "likes") list.sort((a, b) => (b.likes || 0) - (a.likes || 0));
    state.filtered = list;
    state.shown = 0;
    $("all-grid").innerHTML = "";
    showMore();
  }

  function showMore() {
    const page = cfg.allVideosPageSize || 24;
    const next = state.filtered.slice(state.shown, state.shown + page);
    state.shown += next.length;
    $("all-grid").insertAdjacentHTML("beforeend", next.map(videoCard).join(""));
    $("load-more").hidden = state.shown >= state.filtered.length;
    $("browse-count").textContent = state.filtered.length
      ? "Showing " + state.shown + " of " + state.filtered.length + " recitations"
      : "No recitations match your search.";
  }

  /* ── Boot ────────────────────────────────────────────── */
  let controlsWired = false;

  function renderAll(videos, source) {
    videoById = {};
    videos.forEach((v) => (videoById[v.id] = v));
    const hasViews = videos.some((v) => v.views != null);
    const hasLikes = videos.some((v) => v.likes != null);

    // Latest
    const latest = videos.slice().sort((a, b) => b.published - a.published);
    $("latest-grid").innerHTML = latest.slice(0, cfg.latestVideoCount || 8).map(videoCard).join("");

    // Most viewed
    if (hasViews) {
      const byViews = videos.slice().sort((a, b) => (b.views || 0) - (a.views || 0));
      $("most-viewed-grid").innerHTML = byViews.slice(0, cfg.mostViewedCount || 8).map(videoCard).join("");
      $("most-viewed").hidden = false;

      const total = videos.reduce((s, v) => s + (v.views || 0), 0);
      if (total > 0) $("stat-views").textContent = compact(total) + "+";
      $("stat-views").parentElement.style.display = "";
    } else {
      $("most-viewed").hidden = true;
      $("stat-views").parentElement.style.display = "none";
    }

    // Most liked (needs API key data)
    const sortSel = $("sort-select");
    if (hasLikes) {
      const byLikes = videos.slice().sort((a, b) => (b.likes || 0) - (a.likes || 0));
      $("most-liked-grid").innerHTML = byLikes.slice(0, cfg.mostLikedCount || 8).map(videoCard).join("");
      $("most-liked").hidden = false;
      document.querySelectorAll('[data-requires="likes"]').forEach((el) => (el.parentElement.style.display = ""));
      if (sortSel && !sortSel.querySelector('option[value="likes"]')) {
        sortSel.insertAdjacentHTML("beforeend", '<option value="likes">Most liked</option>');
      }
    } else {
      $("most-liked").hidden = true;
      document.querySelectorAll('[data-requires="likes"]').forEach((el) => (el.parentElement.style.display = "none"));
      const likeOpt = sortSel && sortSel.querySelector('option[value="likes"]');
      if (likeOpt) {
        if (sortSel.value === "likes") sortSel.value = "views";
        likeOpt.remove();
      }
    }

    if (videos.length > 20) $("stat-videos").textContent = compact(videos.length) + (source === "rss" ? "" : "+");

    // All videos
    state.videos = videos;
    if (!controlsWired) {
      $("search-input").addEventListener("input", applyFilter);
      $("sort-select").addEventListener("change", applyFilter);
      $("load-more").addEventListener("click", showMore);
      controlsWired = true;
    }
    applyFilter();
  }

  // Live data wins per-video; baked entries not in the live set survive,
  // so the site never shows fewer videos after a partial live refresh.
  function mergeVideos(baked, live) {
    const byId = {};
    baked.forEach((v) => (byId[v.id] = v));
    live.forEach((v) => {
      const prev = byId[v.id] || {};
      byId[v.id] = {
        ...prev,
        ...v,
        views: v.views != null ? v.views : prev.views ?? null,
        likes: v.likes != null ? v.likes : prev.likes ?? null,
        duration: v.duration != null ? v.duration : prev.duration ?? null,
        published: v.published || prev.published || 0,
      };
    });
    return Object.values(byId);
  }

  async function boot() {
    const baked =
      window.VIDEO_DATA && Array.isArray(window.VIDEO_DATA.videos) && window.VIDEO_DATA.videos.length
        ? window.VIDEO_DATA
        : null;

    // 1. Instant render from the baked-in index (all video links ship
    //    with the site itself).
    if (baked) renderAll(baked.videos, baked.source);

    // 2. Live refresh for up-to-the-hour stats and brand-new uploads.
    try {
      const live = await loadVideoIndex();
      const videos = baked ? mergeVideos(baked.videos, live.videos) : live.videos;
      renderAll(videos, baked ? baked.source : live.source);
    } catch (err) {
      console.warn("Live video refresh failed:", err);
      if (!baked) {
        const note = fallbackNote("Watch on YouTube →", videosUrl);
        $("latest-grid").innerHTML = note;
        $("all-grid").innerHTML = note;
        $("browse-count").textContent = "";
      }
    }
  }

  /* ── Playlists ───────────────────────────────────────── */
  const playlistCard = (pl) => `
    <div class="playlist-card">
      <div class="player-frame">
        <iframe
          src="https://www.youtube.com/embed/videoseries?list=${esc(pl.id)}&rel=0"
          title="${esc(pl.title)}"
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen></iframe>
      </div>
      <h3>${esc(pl.title)}${pl.count ? `<span class="pl-count">· ${esc(pl.count)} videos</span>` : ""}</h3>
    </div>`;

  async function loadPlaylistsViaApi() {
    const data = await fetchJson(
      "https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&maxResults=" +
      Math.min(cfg.maxPlaylists || 12, 50) + "&channelId=" + cfg.channelId + "&key=" + cfg.apiKey, 12000);
    return (data.items || []).map((it) => ({
      id: it.id,
      title: it.snippet.title,
      count: it.contentDetails && it.contentDetails.itemCount,
    }));
  }

  async function loadPlaylistsViaInvidious() {
    for (const base of INVIDIOUS_INSTANCES) {
      try {
        const data = await fetchJson(base + "/api/v1/channels/" + cfg.channelId + "/playlists", 9000);
        const list = (data.playlists || []).map((p) => ({
          id: p.playlistId,
          title: p.title,
          count: p.videoCount,
        }));
        if (list.length) return list.slice(0, cfg.maxPlaylists || 12);
      } catch (err) {
        console.warn("Playlist source failed:", err.message || err);
      }
    }
    return [];
  }

  async function renderPlaylists() {
    const grid = $("playlist-grid");
    if (!grid) return;

    const manual = (cfg.playlists || []).filter((p) => p && p.id);
    let auto = [];
    try {
      auto = cfg.apiKey ? await loadPlaylistsViaApi() : await loadPlaylistsViaInvidious();
    } catch (err) {
      console.warn("Playlists:", err);
    }

    const seen = new Set(manual.map((p) => p.id));
    const all = manual.concat(auto.filter((p) => !seen.has(p.id)));

    if (all.length) {
      grid.innerHTML = all.map(playlistCard).join("");
    } else {
      grid.innerHTML =
        playlistCard({ id: cfg.uploadsPlaylistId, title: "All Recitations — Latest Uploads" }) +
        fallbackNote("Browse every playlist on YouTube →", playlistsUrl);
    }
  }

  boot();
  renderPlaylists();
})();
