# Usage Meter for Claude

An unofficial browser extension that shows token count, cache timer, and usage bars on claude.ai.

> **Status:** Version 0.5.6. Updated for the current claude.ai with Manifest V3 MAIN-world early interception, resilient inline Shadow DOM mounting directly above the composer card, and thin line / expandable view.
> Not affiliated with or endorsed by Anthropic.

## Based on

This project is a modified version of [claude-counter](https://github.com/she-llac/claude-counter) by [she-llac](https://github.com/she-llac), used under the MIT License. The original copyright notice and license are preserved in [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Features

- **Inline Mount Above Composer**: Docks directly above Claude's composer input card in normal document flow. Sits as an inline sibling with zero fixed overlays and zero floating drag handles.
- **Context Token Count & Utilization**: Displays chat size and utilization percentages (`62% used · 38% left`) vs the context window (default 200,000 tokens with manual override setting in the gear drawer).
- **Utilization Tier Colors**: `<60%` low color (emerald green `#10b981`), `60% to <90%` mid warning color (amber orange `#f59e0b`), and `>=90%` high color (crimson red `#ef4444`). Over-100% chats cap progress bar at 100% and show `100%+ used · 0% left` while preserving the full estimate in the expanded view.
- **Fast Post-Stream Updates**: Automatically triggers an immediate conversation refetch as soon as the assistant stops streaming, using stale-while-revalidate to prevent UI flickering, with an automatic single 1500ms retry if the server has not yet committed the message.
- **Prompt Cache Timer**: Countdown timer showing how long the conversation remains cached (5-minute sliding window) with an animated circular progress indicator inside the expandable drawer.
- **Usage Bars**: Session (5-hour) and weekly (7-day) usage from Claude's native API, with progress bars and reset countdowns. Free plan accounts display a single neutral compact notice when usage limits are null.
- **Shadow DOM Style Isolation**: Zero CSS conflicts with Claude's layout or Tailwind resets.
- **Theme-Aware**: Automatically mirrors Claude's light and dark themes.
- **Compact Thin Line Mode**: Default collapsed view (~32px height) shows `Context [bar] 62% used · 38% left`, expanding on demand to reveal full details and controls.

## Installation

### Chrome / Brave / Edge / Chromium (Load Unpacked)

1. Clone or download this repository.
2. Open your browser and navigate to `chrome://extensions` or `brave://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select this repository's folder.
5. Open or reload `https://claude.ai`.

> **Brave Browser Note:** The extension functions seamlessly with default Brave Shields. When making updates, click the Reload icon under `brave://extensions` and perform a hard refresh (`Cmd+Shift+R` or `Ctrl+Shift+R`) on your active `claude.ai` tab.

### Userscript

1. Install [`userscript/claude-counter.user.js`](./userscript/claude-counter.user.js) with a userscript manager (e.g. Tampermonkey, Violentmonkey).

## How it works

- **Inline Mounting & Self-Healing:** Anchored to `[data-testid="chat-input"]`, dynamically resolves the surrounding composer card (`bg-surface-3` or 6th ancestor), and inserts host `#cc-usage-meter-root` as the card's previous sibling in normal flow. Lightweight MutationObservers ensure the host remains in place across SPA transitions.
- **Request Discipline:** Calls to `/usage` are deduplicated (single in-flight promise), throttled to a minimum 30-second interval (with one immediate refresh after an assistant message completes), with exponential backoff on errors.
- **Plan-Aware Usage Model:** Queries Claude's `/api/organizations/{orgId}/usage` endpoint using your active session. Free-plan accounts typically return all-null limits; the extension recognizes this as a valid empty state rather than an error. Live SSE `message_limit` chunks update utilization bars in real time.
- **Token Counting:** Uses a vendored `o200k_base` tokenizer for approximate token counting, yielding asynchronously across long message trunks to avoid main-thread stuttering. Context tokens display only when an active conversation exists.

> **Note:** Because this extension relies on claude.ai's undocumented internals and private API endpoints, free plans may show no usage windows, and Anthropic UI updates may require occasional maintenance updates.

## Privacy

- **100% Local:** All data processing and token counting happens locally in your browser.
- **No Telemetry / No External Servers:** Makes requests strictly to `claude.ai` with your active cookies. No third-party network requests or analytics.

## Debugging

To view diagnostics:
1. Open DevTools Console on `claude.ai`.
2. Enable debug logging:
   ```javascript
   localStorage.setItem('cc_debug', 'true');
   ```
3. Refresh the page. Redacted diagnostic lines (`[UsageMeter:Debug]`) will print directly to the browser Console for timing, state changes, and key names.
   (All organization UUIDs, emails, tokens, and chat message contents are automatically sanitized).

## Credits

- Original project: [she-llac/claude-counter](https://github.com/she-llac/claude-counter) (MIT)
- Token counting via [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) (MIT)
- Original project was inspired by [Claude Usage Tracker](https://github.com/lugia19/Claude-Usage-Extension) by lugia19

## License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).