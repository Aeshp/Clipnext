# Changelog

All notable changes to **Clip*Next*** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-04-06

> 🚀 **Initial Public Release** — Welcome to the first public release of ClipNext!

### Added

- **Immortal Favorites** — A dedicated storage tier that completely bypasses the 7-day automated expiry and 50-item capacity cap. Starred snippets stay forever.
- **Smart OTA Updates** — A background-polling system that checks the GitHub Releases API every 24 hours (without rate-limiting) and triggers a red notification badge when a new version is available.
- **Fun Notifications** — A toggleable, randomized toast notification system injected directly into the host DOM without CSS bleed.
- **Manifest V3 Architecture** — Built entirely on modern Service Workers and Offscreen Documents. Zero legacy background pages.
- **Rich Clipboard Capture** — Real-time capture of text, screenshots, and copied images via system clipboard polling.
- **Instant Search** — Fuzzy-find any snippet in your clipboard history with real-time filtering.
- **Filter Chips** — One-tap filtering by `All`, `Text`, or `Images`.
- **7-Day Auto-Cleanup** — Expired items are automatically purged via `chrome.alarms`.
- **Manual Delete & Bulk Delete** — Single-item and multi-select deletion with a safe confirmation modal.

### UI & UX

- Replaced standard text buttons with clean, inline SVG iconography.
- Built custom Webkit scrollbars for a sleek, developer-focused aesthetic.
- Implemented a custom HTML/CSS destructive-action modal to intercept "Clear All" commands and prevent accidental data loss.
- Designed a dedicated Settings view with a Single Page Application (SPA) routing feel.
- Added centered branding header with extension logo.

---

[1.1.0]: https://github.com/Aeshp/Clipnext/releases/tag/v1.1.0
