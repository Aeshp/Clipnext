# Privacy Policy for ClipNext

**Last Updated: April 2026**

ClipNext is an open-source, local-first Chrome extension. This Privacy Policy outlines our strict guidelines regarding how your data is handled. 

Our core philosophy is absolute data sovereignty: **We do not collect, transmit, or store your personal data on any external servers.** ## 1. Data Collection and Storage
ClipNext acts as a short-term memory utility for your browser. To function, it processes text and images copied to your system clipboard. 

* **100% Local Storage:** All clipboard history, pinned favorites, and user settings are stored exclusively on your local machine using Chrome's native `chrome.storage.local` API. 
* **Zero Remote Collection:** We do not operate any backend servers. We do not use analytics trackers, telemetry, or keystroke loggers. We have zero visibility into what you copy, save, or paste.

## 2. Chrome Permissions & Justifications
ClipNext requests specific browser permissions strictly to provide its core functionality. Here is exactly what they do and why they are required:

* **`clipboardRead` & `clipboardWrite`:** Required to detect when you copy an item and to write a selected item back to your system clipboard when you wish to paste it.
* **`storage`:** Required to save your clipboard history and UI preferences securely on your local hard drive.
* **`alarms` & `offscreen`:** Required to maintain the background processes necessary for a Manifest V3 extension to reliably poll the clipboard and check for updates.

## 3. Network Requests & Third-Party Services
ClipNext operates almost entirely offline. It makes exactly one automated network request:
* **GitHub API (`api.github.com`):** The extension pings the public GitHub API periodically to check if a new open-source release of ClipNext is available. This is a read-only fetch request. No user data, identifiers, or clipboard contents are sent during this request.

## 4. Data Retention and Deletion
Because your data is stored locally, you have absolute control over it. 
* You can clear individual items or your entire clipboard history at any time via the extension's user interface.
* Uninstalling the ClipNext extension from your browser will permanently delete all stored clipboard data and settings from your device.

## 5. Security
While we ensure that ClipNext does not transmit your data over the internet, the security of your stored clipboard history ultimately depends on the physical and digital security of your local machine. We recommend employing standard OS-level security practices (e.g., disk encryption, screen locks) if you frequently copy highly sensitive credentials.

## 6. Changes to This Policy
As ClipNext is an open-source project, any future changes to its architecture or permissions will be publicly documented in our repository commits and releases. If any update requires a change to this Privacy Policy, the "Last Updated" date at the top will be revised.

## 7. Contact
If you have any questions regarding this Privacy Policy or the security of the extension, please open an issue on our public GitHub repository:
[https://github.com/Aeshp/Clipnext/issues](https://github.com/Aeshp/Clipnext/issues)
