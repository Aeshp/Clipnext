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
const chipButtons = document.querySelectorAll(".chip[data-filter]");

const FEEDBACK_DURATION_MS = 1400;

let allItems = [];
let currentFilter = "all";
let copiedItemId = "";
let feedbackTimer = 0;
let copiedTimer = 0;
let ownWriteInProgress = false;

function formatTime(value) {
  if (typeof value !== "number") {
    return "";
  }

  return new Date(value).toLocaleString();
}

function getItemType(item) {
  return item.type || "text";
}

function getVisibleItems() {
  let items = allItems;

  if (currentFilter !== "all") {
    items = items.filter((item) => getItemType(item) === currentFilter);
  }

  const query = searchInputEl.value.trim().toLowerCase();
  if (!query) {
    return items;
  }

  return items.filter((item) => {
    const itemType = getItemType(item);
    if (itemType === "text") {
      return item.text.toLowerCase().includes(query);
    }

    if (itemType === "image") {
      return "image".includes(query) || (item.mime || "").toLowerCase().includes(query);
    }
    return false;
  });
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
    const emptyMessages = {
      all: "No matches",
      text: "No text items",
      image: "No images found",
    };
    emptyStateEl.classList.remove("hidden");
    emptyStateEl.textContent = emptyMessages[currentFilter] || "No matches";
    clearAllBtn.disabled = false;
    return;
  }

  emptyStateEl.classList.add("hidden");
  clearAllBtn.disabled = false;

  for (const item of items) {
    const itemType = getItemType(item);
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

    if (itemType === "text") {
      copyBtn.title = item.text;

      const textEl = document.createElement("p");
      textEl.className = "item-text";
      textEl.textContent = item.text;
      copyBtn.append(textEl);
    } else if (itemType === "image") {
      copyBtn.title = "Click to copy image";

      const imgEl = document.createElement("img");
      imgEl.className = "item-image";
      imgEl.src = item.image;
      imgEl.alt = "Clipboard image";
      imgEl.loading = "lazy";
      copyBtn.append(imgEl);

      const badge = document.createElement("span");
      badge.className = "item-badge";
      badge.textContent = (item.mime || "image/png").replace("image/", "").toUpperCase();
      copyBtn.append(badge);
    }

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
  allItems = allItems.filter((item) => item.id !== id);
  renderItems(getVisibleItems());

  ownWriteInProgress = true;
  try {
    const history = await getHistory();
    const next = history.filter((item) => item && item.id !== id);
    await saveHistory(next);
  } finally {
    ownWriteInProgress = false;
  }
}

async function clearAll() {
  allItems = [];
  renderItems(getVisibleItems());

  ownWriteInProgress = true;
  try {
    await clearHistory();
  } finally {
    ownWriteInProgress = false;
  }
}

async function copyTextToClipboard(text) {
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

async function copyImageToClipboard(dataUrl) {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== "function") {
    setFeedback("Image copy not supported");
    return;
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();

  let pngBlob = blob;
  if (blob.type !== "image/png") {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  const clipboardItem = new ClipboardItem({ "image/png": pngBlob });
  await navigator.clipboard.write([clipboardItem]);
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

  const itemType = getItemType(item);

  if (itemType === "text") {
    await copyTextToClipboard(item.text);
    markCopied(item.id);
    renderItems(getVisibleItems());

    const pasted = await tryPasteToActiveField(item.text);
    setFeedback(pasted ? "Copied and pasted" : "Copied!");
  } else if (itemType === "image") {
    await copyImageToClipboard(item.image);
    markCopied(item.id);
    renderItems(getVisibleItems());
    setFeedback("Image copied!");
  }
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

chipButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter || "all";

    chipButtons.forEach((chip) => chip.classList.remove("active"));
    btn.classList.add("active");

    renderItems(getVisibleItems());
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(changes, HISTORY_KEY)) {
    return;
  }

  if (ownWriteInProgress) {
    return;
  }

  refresh().catch((error) => {
    console.error("Failed to refresh popup:", error);
  });
});

refresh().catch((error) => {
  console.error("Failed to load clipboard history:", error);
});
