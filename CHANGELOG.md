# Changelog

All notable changes to **Usage Meter for Claude** will be documented in this file.

## [0.5.0] - 2026-10-17

### Architecture & Interception
- **Manifest V3 MAIN-World Injection:** Configured early bridge execution (`run_at: "document_start"` in `world: "MAIN"`), ensuring `window.fetch` and `history.pushState` are wrapped before Claude's SPA bundles initialize.
- **Resilient Fallback Injection:** Retained dynamic script injection fallback with ping/pong handshake for non-Chromium or older MV3 environments.
- **Extended Request Interception:** Added wrapping for both `fetch` and `XMLHttpRequest`, intercepting completions, SSE streams, conversation payloads, and native `/usage` calls.
- **Incremental Stream Parser:** Parses SSE chunks incrementally without delaying or buffering the host page's responses; dispatches `cc:stream_completed` to trigger immediate post-response usage refresh.

### DOM Mounting & Navigation
- **Centralized Selectors Configuration:** Consolidated all query selectors into `CC.SELECTORS` with explicit rationale and fallbacks (favoring `data-testid`, semantic containers, and ARIA roles over fragile or hashed class names).
- **Debounced MutationObserver:** Replaced immediate thrashing observer with a debounced 150ms observer, preventing UI freezing during token streaming.
- **Idempotent Injection:** Ensured single-instance mounting that cleanly survives rapid DOM reconciliation.
- **Floating Fallback Panel:** Introduced an automatic fallback mode: if in-page input controls are not located within 3 seconds, the widget gracefully docks as a floating panel (bottom-right) and automatically transitions inline once input controls appear.
- **Reliable SPA Detection:** Combined early-patched `pushState`/`replaceState`, `popstate`, and a 500ms path watcher to guarantee conversation switching updates instantly.

### UI & Styling Redesign
- **Shadow DOM Style Isolation:** Encapsulated all widget DOM and styles inside an open ShadowRoot (`#cc-usage-meter-root`), preventing host page CSS or Tailwind resets from clobbering widget styles.
- **Compact 3-Row Layout:**
  - **Context:** Displays approximate token count (`~tokens / 200k`) and context utilization bar.
  - **Session 5h:** 5-hour rolling usage percentage, reset countdown, and temporal progress marker.
  - **Weekly 7d:** 7-day usage percentage, reset countdown, and temporal progress marker.
- **Prompt Cache Pill:** Pill badge with animated circular SVG countdown ring indicating prompt cache validity.
- **Dynamic Color Ramp:** Smooth utilization-based interpolation:
  - 0–60%: Teal/Green
  - 60–85%: Amber
  - 85–100%: Red/Coral with soft glow and subtle pulse above 90%.
- **Accessibility & Motion:** Implemented `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, high-contrast text (>= 4.5:1), and full respect for `prefers-reduced-motion`.
- **Theme Awareness:** Dynamically tracks Claude's light and dark modes via HTML attributes, body classes, computed background colors, and system preferences.
- **Collapsed Mode:** Compact one-line summary mode (`~12k ctx · 42% 5h · 18% 7d`) with persistent state stored in `localStorage`.
- **Unavailable State:** Actionable error state with inline "Retry" button when network errors or rate limits (429/401/403) occur.

### Diagnostics & Safety
- **Debug Logging Mode:** Added `localStorage.setItem('cc_debug', 'true')` ring buffer recording matched selectors, parsed endpoints, and timestamps.
- **Sanitized Log Export:** Implemented `window.__CC_COPY_DEBUG_LOG()` to easily export redacted diagnostics (strips UUIDs, emails, cookies, and chat text).
- **Non-blocking Tokenizer:** Implemented async micro-task yielding during token computation on long chats to ensure smooth typing and UI interactions.
- **Userscript Synchronization:** Updated `userscript/claude-counter.user.js` to match the exact same resilient architecture and Shadow DOM UI.
