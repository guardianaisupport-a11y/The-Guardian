# 🛡️ Guardian AI — Browser Extension

> A Chrome browser extension that protects users from harmful content and hate speech in real time, built with accessibility at its core.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Chrome-yellow.svg)](https://www.google.com/chrome/)
[![Version](https://img.shields.io/badge/Version-1.0.0-green.svg)]()
[![Accessibility](https://img.shields.io/badge/a11y-first-purple.svg)]()

---

## ⬇️ Download & Install

### Step 1 — Download the extension

**[⬇ Download Guardian AI (ZIP)](https://github.com/guardianaisupport/guardianaisupport-a11y/archive/refs/heads/main.zip)**

Or clone via Git:

```bash
git clone https://github.com/guardianaisupport/guardianaisupport-a11y.git
```

---

### Step 2 — Load into Chrome

1. Unzip the downloaded file to a folder on your computer.
2. Open Chrome and navigate to **`chrome://extensions`**
3. Enable **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked** and select the unzipped folder.
5. The Guardian AI 🛡️ shield icon will appear in your extensions bar.
6. Click the shield icon to open the popup and configure your preferences.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🚫 **Hate speech detection** | Flags harmful language as you browse in real time |
| 👁️ **Safe preview** | Preview links before visiting potentially unsafe pages |
| ♿ **Accessibility first** | Built with a11y in mind for all users |
| ⚙️ **Configurable** | Adjust sensitivity and preferences via the popup |
| 🔔 **Onboarding** | Guided setup for new users |
| 🔌 **Background sync** | Persistent background processing via `background.js` |

---

## 📁 File Structure

```
guardianaisupport-a11y/
├── manifest.json          # Extension manifest (permissions, metadata)
├── background.js          # Background service worker
├── config.js              # Shared configuration settings
├── content.js             # Content script injected into web pages
├── content-styles.css     # Styles injected into pages
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic
├── hatespeech.html        # Hate speech alert page
├── hatespeech.js          # Hate speech detection logic
├── safe-preview.html      # Safe link preview UI
├── safe-preview.js        # Safe preview logic
├── safe-preview.css       # Safe preview styles
├── onboarding.html        # First-run onboarding page
├── onboarding.js          # Onboarding logic
├── styles.css             # Global extension styles
├── test_connection.html   # Connection test utility
└── icons/                 # Extension icons
```

---

## 🛠️ Development

To modify and test the extension locally:

1. Make your changes to the source files.
2. Go to `chrome://extensions` and click the **refresh icon** on the Guardian AI card.
3. Reload any open tabs to apply content script changes.

To test the API connection:

```
Open test_connection.html in your browser
```

---

## 🤝 Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgements

Built with care to make the web a safer and more accessible place for everyone.

---

*Made by [guardianaisupport](https://github.com/guardianaisupport)*
