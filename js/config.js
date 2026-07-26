/* ═══════════════════════════════════════════════════════════
   Daily Recitation TV HD — site configuration
   Edit the values below to customise the website.
   ═══════════════════════════════════════════════════════════ */

const SITE_CONFIG = {
  // ── Channel identity ────────────────────────────────────
  channelName: "Daily Recitation TV HD",
  channelHandle: "@DailyRecitationTVHD",
  channelId: "UCzl54RQebnO4Ymfahi_eadQ",

  // The "uploads" playlist for the channel (channel ID with UC → UU).
  // Used for the featured "Now Playing" embed.
  uploadsPlaylistId: "UUzl54RQebnO4Ymfahi_eadQ",

  // ── Latest videos ───────────────────────────────────────
  // How many of the latest videos to show in the grid (max 15 via RSS).
  latestVideoCount: 8,

  // ── Playlists section ───────────────────────────────────
  // OPTION A (recommended, zero setup): list your playlist IDs here.
  //   Find them on YouTube → your playlist → the "list=..." part of the URL.
  //   Example:
  //     { id: "PLxxxxxxxxxxxxxxxx", title: "Surah Al-Baqarah — Complete" },
  // OPTION B: add a YouTube Data API key below and playlists load
  //   automatically — anything listed here is shown first.
  playlists: [
    // { id: "PL...", title: "My playlist name" },
  ],

  // ── Optional: YouTube Data API v3 key ───────────────────
  // With a (free) API key the site automatically loads your playlists
  // and video stats. Create one at:
  //   https://console.cloud.google.com/apis/credentials
  // (enable "YouTube Data API v3", then restrict the key to your domain)
  apiKey: "",

  // How many auto-loaded playlists to show (only used with apiKey).
  maxPlaylists: 12,
};
