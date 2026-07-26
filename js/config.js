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

  // ── Section sizes ───────────────────────────────────────
  latestVideoCount: 8,      // videos in "Latest Recitations"
  mostViewedCount: 8,       // videos in "Most Viewed"
  mostLikedCount: 8,        // videos in "Most Liked"
  allVideosPageSize: 24,    // videos added per "Load more" click

  // How many videos (newest first) to index for the Most Viewed /
  // Most Liked / All Videos sections. Higher = more complete but
  // slower first load. Cached in the visitor's browser for 1 hour.
  maxVideosToIndex: 600,

  // ── Playlists section ───────────────────────────────────
  // OPTION A (zero setup): list playlist IDs here.
  //   YouTube → your playlist → copy the "list=..." part of the URL.
  //   Example:
  //     { id: "PLxxxxxxxxxxxxxxxx", title: "Surah Al-Baqarah — Complete" },
  // OPTION B: add a YouTube Data API key below and playlists load
  //   automatically — anything listed here is shown first.
  playlists: [
    // { id: "PL...", title: "My playlist name" },
  ],

  // ── YouTube Data API v3 key (recommended) ───────────────
  // A free API key gives the site exact view counts AND like counts
  // (the "Most Liked" section needs it — without a key that section
  // stays hidden and "Most Viewed" uses public mirror data instead).
  // Create one at:
  //   https://console.cloud.google.com/apis/credentials
  // (enable "YouTube Data API v3", then restrict the key to your domain)
  apiKey: "",

  // How many auto-loaded playlists to show (only used with apiKey).
  maxPlaylists: 12,
};
