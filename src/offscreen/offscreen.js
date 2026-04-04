const MAX_IMAGE_BYTES = 1 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;

let lastTextHash = "";
let lastImageHash = "";

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function quickHash(str) {
  if (typeof str !== "string") return "";
  return str.length + ":" + str.slice(0, 200);
}

function normalizeText(text) {
  if (typeof text !== "string") return "";
  return text.replace(/\s+/g, " ").trim();
}

async function readClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const types = item.types || [];

      for (const type of types) {
        if (type === "image/png" || type === "image/jpeg") {
          const blob = await item.getType(type);
          if (blob && blob.size > 0 && blob.size <= MAX_IMAGE_BYTES) {
            const dataUrl = await blobToBase64(blob);
            return { image: dataUrl, mime: type };
          }
        }
      }

      if (types.includes("text/plain")) {
        const blob = await item.getType("text/plain");
        const text = await blob.text();
        if (text && text.trim()) {
          return { text: text.trim() };
        }
      }
    }
  } catch (_e) {
    return await readViaExecCommand();
  }

  return null;
}

function readViaExecCommand() {
  return new Promise((resolve) => {
    const textarea = document.getElementById("t");
    textarea.value = "";
    textarea.focus();

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      textarea.removeEventListener("paste", handler, true);

      const items = e.clipboardData ? e.clipboardData.items : null;
      if (items) {
        for (const item of items) {
          if (item.type === "image/png" || item.type === "image/jpeg") {
            const file = item.getAsFile();
            if (file && file.size > 0 && file.size <= MAX_IMAGE_BYTES) {
              blobToBase64(file)
                .then((dataUrl) => resolve({ image: dataUrl, mime: item.type }))
                .catch(() => resolve(null));
              return;
            }
          }
        }

        const textData = e.clipboardData.getData("text/plain");
        if (textData && textData.trim()) {
          resolve({ text: textData.trim() });
          return;
        }
      }

      resolve(null);
    };

    textarea.addEventListener("paste", handler, true);
    if (!document.execCommand("paste")) {
      textarea.removeEventListener("paste", handler, true);
      resolve(null);
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "READ_CLIPBOARD") {
    return false;
  }

  readClipboard()
    .then((result) => sendResponse(result))
    .catch(() => sendResponse(null));

  return true;
});

async function pollClipboard() {
  try {
    const result = await readClipboard();
    if (!result) return;

    if (result.image) {
      const hash = quickHash(result.image);
      if (hash === lastImageHash) return;
      lastImageHash = hash;
      lastTextHash = "";

      chrome.runtime.sendMessage({
        type: "COPIED_IMAGE",
        image: result.image,
        mime: result.mime,
        source: "poll",
      }).catch(() => {});
    } else if (result.text) {
      const hash = normalizeText(result.text);
      if (hash === lastTextHash) return;
      lastTextHash = hash;
      lastImageHash = "";
      chrome.runtime.sendMessage({
        type: "COPIED_TEXT",
        text: result.text,
        source: "poll",
      }).catch(() => {});
    }
  } catch (_error) {
  }
}

setInterval(pollClipboard, POLL_INTERVAL_MS);
pollClipboard();
