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

- **Fixed Draggable Panel:** Mounts independently of Claude's internal DOM structure in an isolated ShadowRoot. Clamped to the viewport, remembers custom dragged coordinates, and includes a compact pill minimize mode.
- **Self-Healing Mount:** A lightweight observer and heartbeat ensure the panel remains mounted and re-attaches within ~1s across single-page transitions.
- **Request Discipline:** Calls to `/usage` are deduplicated so only one request is in-flight at a time, throttled to a minimum 30-second interval (with one immediate refresh after an assistant message completes), with exponential backoff on errors.
- **Plan-Aware Usage Model:** Queries Claude's `/api/organizations/{orgId}/usage` endpoint using your active session. Free-plan accounts typically return all-null limits; the extension recognizes this as a valid empty state rather than an error. When live SSE `message_limit` chunks are received, they fill utilization bars in real time.
- **Token counting:** Uses a vendored `o200k_base` tokenizer for approximate token counting, yielding asynchronously across long message trunks to avoid main-thread stuttering. Context tokens display only when an active conversation exists.

> **Note:** Because this extension relies on claude.ai's undocumented internals and private API endpoints, free plans may show no usage windows, and Anthropic UI updates may require occasional maintenance updates.

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