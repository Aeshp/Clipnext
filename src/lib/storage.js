export const HISTORY_KEY = "clipboard_history";
export const MAX_ITEMS = 50;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;


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

  const trimmedHistory = history.slice(-MAX_ITEMS);
  await saveHistory(trimmedHistory);

  return { ok: true };
}

export async function appendClipboardImage(imageDataUrl, mime) {
  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:")) {
    return { ok: false, reason: "invalid" };
  }

  const history = await cleanupExpiredHistory();

  const isDuplicate = history.some(
    (item) => item.type === "image" && item.image === imageDataUrl
  );
  if (isDuplicate) {
    return { ok: false, reason: "duplicate" };
  }

  history.push(createImageItem(imageDataUrl, mime));

  const trimmedHistory = history.slice(-MAX_ITEMS);
  await saveHistory(trimmedHistory);

  return { ok: true };
}
