# Usage Meter for Claude

An unofficial browser extension that shows token count, cache timer, and usage bars on claude.ai.

> **Status:** Version 0.5.0. Updated for the current claude.ai with Manifest V3 MAIN-world early interception, resilient Shadow DOM mounting, and floating fallback mode.
> Not affiliated with or endorsed by Anthropic.

## Based on

This project is a modified version of [claude-counter](https://github.com/she-llac/claude-counter) by [she-llac](https://github.com/she-llac), used under the MIT License. The original copyright notice and license are preserved in [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Features

- **Context token count**: Approximate token count for the current conversation, with a mini progress bar against the 200k context limit (labeled `~`)
- **Prompt cache timer**: Countdown pill showing how long the conversation remains cached (5-minute sliding window) with an animated circular progress indicator
- **Usage bars**: Session (5-hour) and weekly (7-day) usage from Claude's native API, with progress bars and reset countdowns (more accurate than the rounded /usage page)
- **Shadow DOM style isolation**: Zero CSS conflicts with Claude's layout or Tailwind resets
- **Dynamic color ramps**: Smooth teal/green (0–60%) -> amber (60–85%) -> red (85–100%) utilization ramps with gentle glow and pulse above 90%
- **Theme-aware**: Automatically mirrors Claude's light and dark themes
- **Mount resilience**: Automatically docks inline near chat input controls; if controls are deferred or unavailable within 3 seconds, gracefully docks as a bottom-right floating panel so it never fails silently
- **Collapsed mode**: Toggle into a single compact status line (`~24k ctx · 42% 5h · 18% 7d`) with persistent state

## Installation

### Chrome / Brave / Edge / Chromium (Load Unpacked)

1. Clone or download this repository.
2. Open your browser and navigate to `chrome://extensions` or `brave://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this repository's folder.
5. Open or reload `https://claude.ai`.

### Userscript

1. Install [`userscript/claude-counter.user.js`](./userscript/claude-counter.user.js) with a userscript manager (e.g. Tampermonkey, Violentmonkey).

## How it works

- **Early Interception:** In Manifest V3, an early script injected in the `MAIN` world at `document_start` wraps `window.fetch`, `XMLHttpRequest`, and `history.pushState` before Claude's SPA framework executes.
- **Token counting:** Uses a vendored `o200k_base` tokenizer for approximate token counting, yielding asynchronously across long message trunks to avoid main-thread stuttering.
- **Native `/usage` + Live SSE:** Queries Claude's `/api/organizations/{orgId}/usage` endpoint using your active session credentials and reads live SSE `message_limit` stream chunks for exact, unrounded utilization fractions.
- **DOM observer:** Uses a debounced `MutationObserver` alongside SPA navigation watchers (`pushState`, `popstate`, periodic path watcher) to re-attach the widget idempotently as you navigate between conversations.

> **Note:** Because this extension relies on claude.ai's undocumented internals and private API endpoints, Anthropic UI updates may require occasional maintenance updates.

## Privacy

- **100% Local:** All data processing and token counting happens locally in your browser.
- **No telemetry / No external servers:** Makes requests strictly to `claude.ai` with your active cookies. No third-party network requests or analytics.

## Debugging

To view diagnostics or report an issue:
1. Open DevTools Console on `claude.ai`.
2. Enable debug logging:
   ```javascript
   localStorage.setItem('cc_debug', 'true');
   ```
3. Refresh the page. To copy a redacted diagnostic log to your clipboard:
   ```javascript
   window.__CC_COPY_DEBUG_LOG();
   ```
   (All organization UUIDs, emails, tokens, and chat message contents are automatically sanitized).

## Credits

- Original project: [she-llac/claude-counter](https://github.com/she-llac/claude-counter) (MIT)
- Token counting via [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT)
- Original project was inspired by [Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19

## License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).