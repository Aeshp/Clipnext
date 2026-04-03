import {
  HISTORY_KEY,
  clearHistory,
  getHistory,
  saveHistory,
  sortHistoryLatestFirst,
} from "../lib/storage.js";

const listEl = document.getElementById("list");
const emptyStateEl = document.getElementById("emptyState");
const clearAllBtn = document.getElementById("clearAllBtn");
const searchInputEl = document.getElementById("searchInput");
const feedbackEl = document.getElementById("feedback");

const FEEDBACK_DURATION_MS = 1400;

let allItems = [];
let copiedItemId = "";
let feedbackTimer = 0;
let copiedTimer = 0;

function formatTime(value) {
  if (typeof value !== "number") {
    return "";
  }

  return new Date(value).toLocaleString();
}

function getVisibleItems() {
  const query = searchInputEl.value.trim().toLowerCase();
  if (!query) {
    return allItems;
  }

  return allItems.filter((item) => item.text.toLowerCase().includes(query));
}

function setFeedback(message) {
  window.clearTimeout(feedbackTimer);

  if (!message) {
    feedbackEl.textContent = "";
    feedbackEl.classList.add("hidden");
    return;
  }

  feedbackEl.textContent = message;
  feedbackEl.classList.remove("hidden");

  feedbackTimer = window.setTimeout(() => {
    feedbackEl.textContent = "";
    feedbackEl.classList.add("hidden");
  }, FEEDBACK_DURATION_MS);
}

function markCopied(id) {
  copiedItemId = id;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    copiedItemId = "";
    renderItems(getVisibleItems());
  }, FEEDBACK_DURATION_MS);
}

function renderItems(items) {
  listEl.textContent = "";

  if (allItems.length === 0) {
    emptyStateEl.classList.remove("hidden");
    emptyStateEl.textContent = "No items";
    clearAllBtn.disabled = true;
    return;
  }

  if (items.length === 0) {
    emptyStateEl.classList.remove("hidden");
    emptyStateEl.textContent = "No matches";
    clearAllBtn.disabled = false;
    return;
  }

  emptyStateEl.classList.add("hidden");
  clearAllBtn.disabled = false;

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "item";
    if (item.id === copiedItemId) {
      card.classList.add("is-copied");
    }

    const top = document.createElement("div");
    top.className = "item-top";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "item-copy";
    copyBtn.dataset.copyId = item.id;
    copyBtn.title = item.text;

    const textEl = document.createElement("p");
    textEl.className = "item-text";
    textEl.textContent = item.text;

    copyBtn.append(textEl);

    if (typeof item.createdAt === "number") {
      const timeEl = document.createElement("div");
      timeEl.className = "item-time";
      timeEl.textContent = formatTime(item.createdAt);
      copyBtn.append(timeEl);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-delete";
    deleteBtn.textContent = "Delete";
    deleteBtn.dataset.deleteId = item.id;

    top.append(copyBtn, deleteBtn);
    card.append(top);

    listEl.append(card);
  }
}

async function refresh() {
  const history = await getHistory();
  allItems = sortHistoryLatestFirst(history);
  renderItems(getVisibleItems());
}

async function deleteOne(id) {
  const history = await getHistory();
  const next = history.filter((item) => item && item.id !== id);

  await saveHistory(next);
}

async function clearAll() {
  await clearHistory();
}

async function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helperTextArea = document.createElement("textarea");
  helperTextArea.value = text;
  helperTextArea.setAttribute("readonly", "readonly");
  helperTextArea.style.position = "fixed";
  helperTextArea.style.left = "-9999px";
  document.body.append(helperTextArea);
  helperTextArea.select();
  document.execCommand("copy");
  helperTextArea.remove();
}

async function tryPasteToActiveField(text) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

    if (!tab || typeof tab.id !== "number") {
      return false;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "PASTE_TEXT",
      text,
    });

    return Boolean(response && response.ok);
  } catch (_error) {
    return false;
  }
}

async function copyItemById(id) {
  const item = allItems.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  await copyToClipboard(item.text);
  markCopied(item.id);
  renderItems(getVisibleItems());

  const pasted = await tryPasteToActiveField(item.text);
  setFeedback(pasted ? "Copied and pasted" : "Copied!");
}

listEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const deleteBtn = target.closest("button[data-delete-id]");
  if (deleteBtn) {
    const id = deleteBtn.dataset.deleteId;
    if (!id) {
      return;
    }

    deleteBtn.disabled = true;

    try {
      await deleteOne(id);
      await refresh();
    } finally {
      deleteBtn.disabled = false;
    }

    return;
  }

  const copyBtn = target.closest("button[data-copy-id]");
  if (!copyBtn) {
    return;
  }

  const id = copyBtn.dataset.copyId;
  if (!id) {
    return;
  }

  copyBtn.disabled = true;

  try {
    await copyItemById(id);
  } catch (_error) {
    setFeedback("Copy failed");
  } finally {
    copyBtn.disabled = false;
  }
});

clearAllBtn.addEventListener("click", async () => {
  clearAllBtn.disabled = true;

  try {
    await clearAll();
    await refresh();
  } finally {
    clearAllBtn.disabled = false;
  }
});

searchInputEl.addEventListener("input", () => {
  renderItems(getVisibleItems());
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(changes, HISTORY_KEY)) {
    return;
  }

  refresh().catch((error) => {
    console.error("Failed to refresh popup:", error);
  });
});

refresh().catch((error) => {
  console.error("Failed to load clipboard history:", error);
});
