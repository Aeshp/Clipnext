(function () {
  "use strict";

  if (window.__clipcardInjectedLoaded) {
    return;
  }
  window.__clipcardInjectedLoaded = true;

  const MESSAGE_SOURCE = "__clipcard_injected";

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl === "string") {
          resolve(dataUrl);
        } else {
          reject(new Error("FileReader did not produce a string"));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function postToContentScript(payload) {
    try {
      window.postMessage(
        { source: MESSAGE_SOURCE, payload },
        "*"
      );
    } catch (_error) {
    }
  }

  const originalWriteText = navigator.clipboard.writeText.bind(
    navigator.clipboard
  );

  navigator.clipboard.writeText = async function (text) {
    if (typeof text === "string" && text.trim()) {
      postToContentScript({ type: "COPIED_TEXT", text: text.trim() });
    }

    return originalWriteText(text);
  };
  const originalWrite = navigator.clipboard.write.bind(navigator.clipboard);

  navigator.clipboard.write = async function (clipboardItems) {
    if (Array.isArray(clipboardItems)) {
      for (const item of clipboardItems) {
        if (!item || typeof item.getType !== "function") {
          continue;
        }

        const types = item.types || [];

        for (const mime of types) {
          if (mime !== "image/png" && mime !== "image/jpeg") {
            continue;
          }

          try {
            const blob = await item.getType(mime);
            if (!blob || blob.size === 0) {
              continue;
            }

            const dataUrl = await blobToBase64(blob);
            postToContentScript({
              type: "COPIED_IMAGE",
              image: dataUrl,
              mime,
            });
          } catch (_error) {
          }

          break;
        }

        if (types.includes("text/plain")) {
          try {
            const blob = await item.getType("text/plain");
            const text = await blob.text();
            if (text && text.trim()) {
              postToContentScript({ type: "COPIED_TEXT", text: text.trim() });
            }
          } catch (_error) {
          }
        }
      }
    }

    return originalWrite(clipboardItems);
  };
})();
