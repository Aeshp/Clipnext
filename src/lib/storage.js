export const HISTORY_KEY = "clipboard_history";
export const MAX_ITEMS = 50;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const SUPPRESS_KEY = "__clipnext_suppress_clipboard";


function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toTrimmedText(rawText) {
  if (typeof rawText !== "string") {
    return "";
  }

  return rawText.trim();
}

function toComparisonKey(text) {
  if (typeof text !== "string") {
    return "";
  }

  return text.replace(/\s+/g, " ").trim();
}

export function createTextItem(text) {
  const createdAt = Date.now();

  return {
    id: generateId(),
    type: "text",
    text,
    isFavorite: false,
    createdAt,
    expiry: createdAt + SEVEN_DAYS_MS,
  };
}

export function createImageItem(image, mime) {
  const createdAt = Date.now();

  return {
    id: generateId(),
    type: "image",
    image,
    mime: mime || "image/png",
    isFavorite: false,
    createdAt,
    expiry: createdAt + SEVEN_DAYS_MS,
  };
}

export function createHistoryItem(text) {
  return createTextItem(text);
}

export function isActiveHistoryItem(item, now = Date.now()) {
  if (!item || typeof item.id !== "string" || typeof item.createdAt !== "number" || typeof item.expiry !== "number") {
    return false;
  }

  if (item.isFavorite === true) {
    const itemType = item.type || "text";
    if (itemType === "text") return typeof item.text === "string";
    if (itemType === "image") return typeof item.image === "string";
    return false;
  }

  if (item.expiry <= now) {
    return false;
  }

  const itemType = item.type || "text";
  if (itemType === "text") {
    return typeof item.text === "string";
  }

  if (itemType === "image") {
    return typeof item.image === "string";
  }

  return false;
}

export function sortHistoryLatestFirst(history) {
  return history
    .filter((item) => {
      if (!item || typeof item.id !== "string") {
        return false;
      }
      const itemType = item.type || "text";
      if (itemType === "text") return typeof item.text === "string";
      if (itemType === "image") return typeof item.image === "string";
      return false;
    })
    .sort((a, b) => {
      const aTime = typeof a.createdAt === "number" ? a.createdAt : 0;
      const bTime = typeof b.createdAt === "number" ? b.createdAt : 0;
      return bTime - aTime;
    });
}

export async function getHistory() {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history = result[HISTORY_KEY];

  return Array.isArray(history) ? history : [];
}

export async function saveHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    await chrome.storage.local.remove(HISTORY_KEY);
    return;
  }

  await chrome.storage.local.set({
    [HISTORY_KEY]: history,
  });
}

export async function clearHistory() {
  await chrome.storage.local.remove(HISTORY_KEY);
}

/**
 * Set a suppress flag so that clipboard writes triggered by the popup
 * are not re-recorded as new history items.
 * @param {number} durationMs – How long to suppress (default 5000ms)
 */
export async function setSuppressClipboardCapture(durationMs = 5000) {
  const expiresAt = Date.now() + durationMs;
  await chrome.storage.session.set({ [SUPPRESS_KEY]: expiresAt });
}

/**
 * Check whether clipboard capture is currently suppressed.
 * @returns {Promise<boolean>}
 */
export async function isSuppressed() {
  try {
    const result = await chrome.storage.session.get(SUPPRESS_KEY);
    const expiresAt = result[SUPPRESS_KEY];
    if (typeof expiresAt !== "number") {
      return false;
    }
    if (Date.now() >= expiresAt) {
      // Expired – clean up
      await chrome.storage.session.remove(SUPPRESS_KEY);
      return false;
    }
    return true;
  } catch (_error) {
    return false;
  }
}

/**
 * Clear the suppress flag immediately.
 */
export async function clearSuppressFlag() {
  try {
    await chrome.storage.session.remove(SUPPRESS_KEY);
  } catch (_error) {
    // Ignore – session storage may not be available in all contexts
  }
}

/**
 * Move an existing history item to the top by updating its createdAt
 * timestamp and resetting its expiry.
 * @param {string} id – The item ID to move to top
 * @returns {Promise<boolean>} true if the item was found and moved
 */
export async function moveItemToTop(id) {
  const history = await getHistory();
  const item = history.find((entry) => entry && entry.id === id);

  if (!item) {
    return false;
  }

  const now = Date.now();
  item.createdAt = now;
  item.expiry = now + SEVEN_DAYS_MS;

  await saveHistory(history);
  return true;
}

export async function cleanupExpiredHistory() {
  const now = Date.now();
  const history = await getHistory();
  const activeHistory = history.filter((item) => isActiveHistoryItem(item, now));

  if (activeHistory.length !== history.length) {
    await saveHistory(activeHistory);
  }

  return activeHistory;
}

export async function appendClipboardText(rawText) {
  const text = toTrimmedText(rawText);
  if (!text) {
    return { ok: false, reason: "empty" };
  }

  const history = await cleanupExpiredHistory();

  const key = toComparisonKey(text);
  const isDuplicate = history.some(
    (item) => (item.type || "text") === "text" && toComparisonKey(item.text) === key
  );
  if (isDuplicate) {
    return { ok: false, reason: "duplicate" };
  }

  history.push(createTextItem(text));

  const favorites = history.filter((item) => item.isFavorite === true);
  const nonFavorites = history.filter((item) => item.isFavorite !== true);
  const trimmedNonFavorites = nonFavorites.slice(-MAX_ITEMS);
  await saveHistory([...favorites, ...trimmedNonFavorites]);

  return { ok: true };
}

/**
 * Compute a fuzzy signature for an image data URL so that re-encoded
 * versions of the same image are detected as duplicates.
 */
function imageSignature(dataUrl) {
  if (typeof dataUrl !== "string") return "";
  const len = dataUrl.length;
  const prefix = dataUrl.slice(0, 500);
  const suffix = dataUrl.slice(-500);
  return `${len}:${prefix}:${suffix}`;
}

export async function appendClipboardImage(imageDataUrl, mime) {
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:")) {
    return { ok: false, reason: "invalid" };
  }

  const history = await cleanupExpiredHistory();

  // Exact match
  const exactDuplicate = history.some(
    (item) => item.type === "image" && item.image === imageDataUrl
  );
  if (exactDuplicate) {
    return { ok: false, reason: "duplicate" };
  }

  // Fuzzy match — catches re-encoded versions of the same image
  const sig = imageSignature(imageDataUrl);
  const fuzzyDuplicate = history.some(
    (item) => item.type === "image" && imageSignature(item.image) === sig
  );
  if (fuzzyDuplicate) {
    return { ok: false, reason: "duplicate" };
  }

  history.push(createImageItem(imageDataUrl, mime));

  const favorites = history.filter((item) => item.isFavorite === true);
  const nonFavorites = history.filter((item) => item.isFavorite !== true);
  const trimmedNonFavorites = nonFavorites.slice(-MAX_ITEMS);
  await saveHistory([...favorites, ...trimmedNonFavorites]);

  return { ok: true };
}

export async function toggleFavorite(id, isFavorite) {
  const history = await getHistory();
  const item = history.find((entry) => entry && entry.id === id);

  if (!item) {
    return history;
  }

  item.isFavorite = isFavorite;

  if (isFavorite) {
    item.expiry = Date.now() + SEVEN_DAYS_MS;
  }

  await saveHistory(history);
  return history;
}

export const SETTINGS_KEY = "clipnest_settings";

/** @type {{ notificationsEnabled: boolean }} */
const DEFAULT_SETTINGS = Object.freeze({ notificationsEnabled: true });

/**
 * @returns {Promise<{ notificationsEnabled: boolean }>}
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = result[SETTINGS_KEY];

  if (stored && typeof stored === "object") {
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  return { ...DEFAULT_SETTINGS };
}

/**
 * @param {Partial<{ notificationsEnabled: boolean }>} newSettings
 * @returns {Promise<{ notificationsEnabled: boolean }>}
 */
export async function updateSettings(newSettings) {
  const current = await getSettings();
  const merged = { ...current, ...newSettings };

  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });

  return merged;
}
