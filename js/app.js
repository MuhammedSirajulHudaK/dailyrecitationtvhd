/* ═══════════════════════════════════════════════════════════
   Daily Recitation TV HD — site logic
   Loads latest videos + playlists from YouTube, wires up UI.
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const cfg = window.SITE_CONFIG || SITE_CONFIG;

  const channelUrl = "https://www.youtube.com/" + cfg.channelHandle;
  const subscribeUrl = channelUrl + "?sub_confirmation=1";
  const videosUrl = channelUrl + "/videos";
  const playlistsUrl = channelUrl + "/playlists";

  /* ── Static link wiring ──────────────────────────────── */
  const setHref = (id, url) => {
    const el = document.getElementById(id);
    if (el) el.href = url;
  };

  setHref("nav-subscribe", subscribeUrl);
  setHref("hero-subscribe", subscribeUrl);
  setHref("cta-subscribe", subscribeUrl);
  setHref("all-videos-link", videosUrl);
  setHref("all-playlists-link", playlistsUrl);
  setHref("share-channel", channelUrl);
  setHref(
    "share-wa",
    "https://wa.me/?text=" +
      encodeURIComponent(
        "Listen to beautiful Quran recitations on " +
          cfg.channelName +
          " — " +
          channelUrl
      )
  );

  document.getElementById("year").textContent = new Date().getFullYear();

  /* ── Featured player (uploads playlist) ──────────────── */
  const player = document.getElementById("featured-player");
  if (player && cfg.uploadsPlaylistId) {
    player.src =
      "https://www.youtube.com/embed/videoseries?list=" +
      cfg.uploadsPlaylistId +
      "&rel=0";
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
  const copyBtn = document.getElementById("copy-link");
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
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  const videoCard = (v) => `
    <a class="video-card" href="https://www.youtube.com/watch?v=${esc(v.id)}"
       target="_blank" rel="noopener">
      <div class="thumb">
        <img src="${esc(v.thumb)}" alt="" loading="lazy" />
        <span class="play-badge" aria-hidden="true">▶</span>
      </div>
      <div class="video-meta">
        <h3>${esc(v.title)}</h3>
        ${v.published ? `<time datetime="${esc(v.published)}">${fmtDate(v.published)}</time>` : ""}
      </div>
    </a>`;

  const fallbackNote = (label, url) => `
    <div class="fallback-note">
      <p>Couldn't load this section automatically right now.</p>
      <p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a></p>
    </div>`;

  /* ── Latest videos ───────────────────────────────────── */
  async function loadLatestViaApi() {
    const url =
      "https://www.googleapis.com/youtube/v3/playlistItems" +
      "?part=snippet&maxResults=" +
      Math.min(cfg.latestVideoCount || 8, 50) +
      "&playlistId=" +
      cfg.uploadsPlaylistId +
      "&key=" +
      cfg.apiKey;
    const res = await fetch(url);
    if (!res.ok) throw new Error("API " + res.status);
    const data = await res.json();
    return (data.items || []).map((it) => {
      const sn = it.snippet;
      const t = sn.thumbnails || {};
      return {
        id: sn.resourceId.videoId,
        title: sn.title,
        published: sn.publishedAt,
        thumb: (t.high || t.medium || t.default || {}).url || "",
      };
    });
  }

  async function loadLatestViaRss() {
    // YouTube's RSS feed doesn't allow browser CORS requests, so we go
    // through the free rss2json relay. Needs no key for public feeds.
    const feed =
      "https://www.youtube.com/feeds/videos.xml?channel_id=" + cfg.channelId;
    const res = await fetch(
      "https://api.rss2json.com/v1/api.json?rss_url=" + encodeURIComponent(feed)
    );
    if (!res.ok) throw new Error("rss2json " + res.status);
    const data = await res.json();
    if (data.status !== "ok") throw new Error("rss2json status " + data.status);
    return (data.items || []).slice(0, cfg.latestVideoCount || 8).map((it) => {
      const id = (it.link.match(/[?&]v=([\w-]+)/) || [])[1] || "";
      return {
        id,
        title: it.title,
        published: it.pubDate,
        thumb: id
          ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"
          : it.thumbnail || "",
      };
    });
  }

  async function renderLatest() {
    const grid = document.getElementById("video-grid");
    if (!grid) return;
    try {
      const videos = cfg.apiKey
        ? await loadLatestViaApi()
        : await loadLatestViaRss();
      if (!videos.length) throw new Error("empty");
      grid.innerHTML = videos.map(videoCard).join("");

      const stat = document.getElementById("stat-videos");
      const stats = document.getElementById("hero-stats");
      if (stat && stats) {
        stat.textContent = "1,700+";
        stats.hidden = false;
      }
    } catch (err) {
      console.warn("Latest videos:", err);
      grid.innerHTML = fallbackNote("Watch the latest videos on YouTube →", videosUrl);
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
      <h3>${esc(pl.title)}${
        pl.count ? `<span class="pl-count">· ${esc(pl.count)} videos</span>` : ""
      }</h3>
    </div>`;

  async function loadPlaylistsViaApi() {
    const url =
      "https://www.googleapis.com/youtube/v3/playlists" +
      "?part=snippet,contentDetails&maxResults=" +
      Math.min(cfg.maxPlaylists || 12, 50) +
      "&channelId=" +
      cfg.channelId +
      "&key=" +
      cfg.apiKey;
    const res = await fetch(url);
    if (!res.ok) throw new Error("API " + res.status);
    const data = await res.json();
    return (data.items || []).map((it) => ({
      id: it.id,
      title: it.snippet.title,
      count: it.contentDetails && it.contentDetails.itemCount,
    }));
  }

  async function renderPlaylists() {
    const grid = document.getElementById("playlist-grid");
    if (!grid) return;

    const manual = (cfg.playlists || []).filter((p) => p && p.id);
    let auto = [];

    if (cfg.apiKey) {
      try {
        auto = await loadPlaylistsViaApi();
      } catch (err) {
        console.warn("Playlists API:", err);
      }
    }

    // Manual entries first, then API results (deduped).
    const seen = new Set(manual.map((p) => p.id));
    const all = manual.concat(auto.filter((p) => !seen.has(p.id)));

    if (all.length) {
      grid.innerHTML = all.map(playlistCard).join("");
    } else {
      // Zero-config fallback: embed the channel's uploads as one collection
      // and point visitors at the full playlists page.
      grid.innerHTML =
        playlistCard({ id: cfg.uploadsPlaylistId, title: "All Recitations — Latest Uploads" }) +
        fallbackNote("Browse every playlist on YouTube →", playlistsUrl);
    }
  }

  renderLatest();
  renderPlaylists();
})();
