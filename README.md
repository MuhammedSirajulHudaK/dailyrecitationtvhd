# Daily Recitation TV HD — Official Website

A fast, dependency-free static website for the
[Daily Recitation TV HD](https://www.youtube.com/@DailyRecitationTVHD) YouTube
channel — beautiful, high-quality recitations of the Holy Quran, free for
everyone, everywhere.

## Features

- 🎬 **Now Playing** — embedded player with the channel's latest uploads
- 🆕 **Latest Recitations** — auto-updating grid of the newest videos
- 📚 **Playlists** — embedded playlist players (manual list or auto-loaded)
- 🕌 **About + Share** — channel mission, copy-link and WhatsApp share
- 🔔 **Subscribe buttons** throughout, with one-click subscribe confirmation
- 📱 Fully responsive, dark emerald + gold design, no build step required

## Getting started

It's a plain static site — no build tools needed. Open `index.html` in a
browser, or serve the folder:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

## Configuration

Everything lives in [`js/config.js`](js/config.js):

| Setting | What it does |
| --- | --- |
| `channelName` / `channelHandle` / `channelId` | Channel identity (already set) |
| `uploadsPlaylistId` | Powers the "Now Playing" embed (already set) |
| `latestVideoCount` | How many videos in the Latest grid (max 15 without an API key) |
| `playlists` | Add your playlist IDs + titles to feature them on the site |
| `apiKey` | Optional YouTube Data API v3 key — auto-loads playlists & more videos |

### Featuring your playlists (2 minutes)

1. Open a playlist on YouTube.
2. Copy the `list=...` value from the URL (starts with `PL`).
3. Add it to `playlists` in `js/config.js`:

```js
playlists: [
  { id: "PLxxxxxxxxxxxx", title: "Surah Al-Baqarah — Complete" },
  { id: "PLyyyyyyyyyyyy", title: "Juz Amma Collection" },
],
```

### Optional: automatic playlists via API key

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create a project, enable **YouTube Data API v3**, create an **API key**.
3. Restrict the key to your website's domain (HTTP referrer restriction).
4. Paste it into `apiKey` in `js/config.js`.

The site then loads all your playlists and latest videos automatically.
Without a key, the site still works: latest videos load via the channel's
public RSS feed, and the uploads playlist is embedded as a fallback.

## Deploying (free options)

- **GitHub Pages** — repo Settings → Pages → deploy from branch, root folder.
- **Netlify / Vercel / Cloudflare Pages** — connect the repo; no build command,
  publish directory is the repo root.

## Structure

```
index.html      # single-page site
css/style.css   # styling (dark emerald + gold theme)
js/config.js    # ← edit this to customise
js/app.js       # YouTube data loading + UI logic
```
