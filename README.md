<div align="center">

# ⏳ Usage Meter for Claude

**See your Claude session and weekly limits at a glance, right above the chat box.**

![Version](https://img.shields.io/badge/version-0.7.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![Verified](https://img.shields.io/badge/verified-Chrome%20%7C%20Brave-orange)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

*Unofficial. Not affiliated with or endorsed by Anthropic.*

</div>

---

## ✨ Features

| | |
|---|---|
| 📊 **Session (5h) and Weekly (7d)** | Two clean rows with a progress bar and `X% used · Y% left` |
| 🕒 **Reset time** | Countdown on the row, exact local time on hover |
| 🎨 **Color tiers** | 🟢 under 60% · 🟠 60 to 89% · 🔴 90% and above |
| 💾 **Remembers the last value** | Saved per account, so the numbers can show again after a refresh until the window resets |
| 🔄 **Live updates** | Updates after every reply from Claude |
| 🧱 **Shadow DOM isolation** | No CSS clashes with claude.ai |
| 🌗 **Light and dark** | Follows Claude's theme |
| ⚙️ **Settings drawer** | Gear icon for theme preset, colors and opacity, with Reset Defaults |

> Context size and Cache timer rows exist but are **off by default**. Turn them on from the gear settings if you want them.

---

## ✅ Status

| | |
|---|---|
| **Verified** | Free plan, Chrome and Brave (October 2026) |
| **Not verified** | Paid plans (Pro, Team, Enterprise), Edge, Firefox |

If you try it on something else and it works or fails, please open an issue.

---

## 🚀 Installation

**Chrome / Brave (Load unpacked)**

1. Clone or download this repo.
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the folder that contains `manifest.json`.
5. Open or reload [claude.ai](https://claude.ai).

> 💡 **After any code change:** click **Reload** on the extension card, then hard refresh claude.ai (`Cmd+Shift+R` / `Ctrl+Shift+R`).
>
> Keep the folder in place. The browser loads the extension straight from it.

---

## 🧠 How it works

- **Numbers arrive after you send a message.** claude.ai sends your limit data inside the reply stream. The extension reads a cloned copy of that response, so the page never sees any difference.
- **Free plan:** the `/usage` endpoint returns empty data, so the first numbers appear after your first message in a session. Until then the panel shows the last saved value for that account, or `—` with "No data yet. Updates after your next message."
- **Rollover safe:** once a window resets, the row shows `—` until your next message.
- **Multi-account safe:** saved values are kept per organization.
- **Request discipline:** `/usage` calls are deduplicated and limited to one every 30 seconds, with backoff on errors.
- **Self-healing mount:** the panel re-attaches itself above the composer after page navigation.

> ⚠️ This relies on undocumented claude.ai internals. claude.ai has already changed how replies are delivered once, so expect that it can happen again.

---

## 🔒 Privacy

- 100% local. No analytics, no tracking, no external servers.
- Requests go only to `claude.ai`, using the session you are already logged into.
- Debug mode (off by default) keeps a short log in memory on your machine. Nothing leaves your browser unless you copy and share it yourself.

---

## 🛠️ Troubleshooting

**Numbers stopped updating?** claude.ai may have changed something. To capture what happened:

1. Open DevTools Console on claude.ai and run:

```js
localStorage.setItem('cc_debug','true')
```

2. Refresh the page.
3. Send one short message and wait for the reply to finish.
4. Click the clipboard icon in the panel header, next to the gear. It copies a redacted debug log.
5. Open an issue and paste the log.

> Check the log before you share it. It hides emails, tokens and chat text, but your organization id can still show up inside saved-value key names.

**Panel looks wrong after an update?** Reset only the extension settings:

```js
localStorage.removeItem('cc_settings');location.reload()
```

---

## 🧪 Tests

```sh
node tests/normalize.test.js && node tests/tokens.test.js && node tests/mount.test.js
```

The tests use hand-made fakes. They check the logic, not real claude.ai behavior in a live browser.

---

## 🙏 Credits

- Based on [claude-counter](https://github.com/she-llac/claude-counter) by [she-llac](https://github.com/she-llac) (MIT)
- Token counting via [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT)
- Inspired by [Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19

## 📄 License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
