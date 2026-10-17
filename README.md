<div align="center">

# ⏳ Usage Meter for Claude

**See your Claude session and weekly limits at a glance, right above the chat box.**

![Version](https://img.shields.io/badge/version-0.6.1-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![Browsers](https://img.shields.io/badge/Chrome%20%7C%20Brave%20%7C%20Edge-supported-orange)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

*Unofficial. Not affiliated with or endorsed by Anthropic.*

</div>

---

## ✨ Features

| | |
|---|---|
| 📊 **Session (5h) and Weekly (7d)** | Two clean rows with a progress bar, `X% used · Y% left`, and a reset countdown |
| 🕒 **Reset time** | Countdown on the row, exact local time on hover |
| 🎨 **Color tiers** | 🟢 under 60% · 🟠 60 to 89% · 🔴 90% and above |
| 💾 **Remembers last value** | Bars show instantly after a refresh, with a tooltip like "As of your last message at HH:MM" |
| 🔄 **Live updates** | Updates after every reply from Claude's own response stream |
| 🧱 **Shadow DOM isolation** | No CSS clashes with claude.ai |
| 🌗 **Light and dark** | Follows Claude's theme |
| ⚙️ **Settings drawer** | Gear icon for theme preset, colors and opacity, with Reset Defaults |

> Context size and Cache timer exist in the code but are **hidden by default**.

---

## 🚀 Installation

**Chrome / Brave / Edge (Load unpacked)**

1. Clone or download this repo.
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the folder that contains `manifest.json`.
5. Open or reload [claude.ai](https://claude.ai).

> 💡 **After any code change:** click **Reload** on the extension card, then hard refresh claude.ai (`Cmd+Shift+R` / `Ctrl+Shift+R`).

---

## 🧠 How it works

- **Live data:** reads the usage data that claude.ai already sends to your browser (the `message_limit` event in the reply stream, plus the `/usage` endpoint).
- **Request discipline:** `/usage` calls are deduplicated and limited to one every 30 seconds, with backoff on errors.
- **Rollover safe:** once a window resets, the row shows `—` until your next message.
- **Multi-account safe:** saved values are kept per organization.
- **Self-healing mount:** the panel re-attaches itself above the composer after page navigation.

> ⚠️ This relies on undocumented claude.ai internals. Updates on Anthropic's side may need small fixes here.

---

## 🔒 Privacy

- 100% local. No analytics, no tracking, no external servers.
- Requests go only to `claude.ai`, using the session you are already logged into.

---

## 🛠️ Troubleshooting

**Panel shows the header but no rows?** Clear the saved extension data. Open DevTools Console on claude.ai and run:

```js
Object.keys(localStorage).filter(k=>k.startsWith('cc_')&&k!=='cc_debug').forEach(k=>localStorage.removeItem(k));location.reload()
```

**Debug logs:**

```js
localStorage.setItem('cc_debug','true')
```

Refresh the page. A clipboard icon appears in the panel header and copies a redacted log (no org IDs, emails, tokens or chat text).

---

## 🧪 Tests

```sh
node tests/normalize.test.js && node tests/tokens.test.js && node tests/mount.test.js
```

---

## 🙏 Credits

- Based on [claude-counter](https://github.com/she-llac/claude-counter) by [she-llac](https://github.com/she-llac) (MIT)
- Token counting via [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT)
- Inspired by [Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19

## 📄 License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).