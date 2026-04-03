# Clipboard Extension

A Manifest V3 Chrome extension that captures copied text, stores clipboard history, and provides a searchable popup manager.

## Features

- Captures copied text from web pages.
- Stores history in `chrome.storage.local`.
- Keeps the latest 50 items (FIFO).
- Skips duplicate consecutive entries.
- Adds expiry metadata to each item and removes expired items after 7 days.
- Runs periodic cleanup with `chrome.alarms`.
- Popup UI with search, copy-back, delete item, and clear all actions.

## Installation

1. Clone this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `clipboard-extension` folder.

## Folder Structure

```text
clipboard-extension/
├── manifest.json
├── src/
│   ├── background/
│   │   └── service-worker.js
│   ├── content/
│   │   └── content.js
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── lib/
│       └── storage.js
├── assets/
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── README.md
```

## Notes

- Background logic lives in `src/background/service-worker.js`.
- Page event capture and optional paste handling live in `src/content/content.js`.
- Popup UI lives in `src/popup/`.
- Shared storage helpers are centralized in `src/lib/storage.js`.
