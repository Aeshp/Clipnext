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

export function createHistoryItem(text) {
  const createdAt = Date.now();

  return {
    id: generateId(),
    text,
    createdAt,
    expiry: createdAt + SEVEN_DAYS_MS,
  };
}

export function isActiveHistoryItem(item, now = Date.now()) {
  return (
    item &&
    typeof item.id === "string" &&
    typeof item.text === "string" &&
    typeof item.createdAt === "number" &&
    typeof item.expiry === "number" &&
    item.expiry > now
  );
}

export function sortHistoryLatestFirst(history) {
  return history
    .filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
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

  const lastItem = history[history.length - 1];
  if (lastItem && lastItem.text === text) {
    return { ok: false, reason: "duplicate" };
  }

  history.push(createHistoryItem(text));

  const trimmedHistory = history.slice(-MAX_ITEMS);
  await saveHistory(trimmedHistory);

  return { ok: true };
}
