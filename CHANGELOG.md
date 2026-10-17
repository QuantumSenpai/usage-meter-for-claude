# Changelog

All notable changes to **Usage Meter for Claude** will be documented in this file.

## [0.5.2] - 2026-10-17

### Context Token Counting & Loading State Fixes
- **Root Cause Fix for "~0 / 200k" Display:**
  - Resolved race condition where shallow `/chat_conversations/` requests (metadata GETs or PATCHes with `chat_messages: []`) were intercepted by `bridge.js` and emitted `cc:conversation` before the actual conversation tree arrived.
  - Capped conversation interception in `bridge.js` to HTTP `GET` requests with verified `chat_messages` arrays, requiring `tree=` or leaf UUID when messages are empty.
  - Added shallow payload guard in `main.js` preventing non-tree payloads from overwriting full conversation metrics.
  - Fixed initial state in `ui.js`: initializes Context row with a loading state (`"— / 200k"`, percent `"—"`, bar width 0%) instead of hardcoded `~0 / 200k`.
  - Distinguishes loading state (`isLoaded: false`, shows `"—"`) from a genuinely empty loaded conversation (`totalTokens: 0, isLoaded: true`, shows `~0 / 200k`, `0%`).
  - Added `renderAll()` to `ui.initialize()` to ensure cached metrics are immediately rendered into freshly mounted DOM elements, eliminating panel mount race conditions.

### Over-Limit (>200k Tokens) & Compact Formatting
- **Over-Limit Handling:**
  - In chats exceeding the 200k context limit (e.g. 231,255 tokens), bar width is strictly capped at 100% (no visual overflow or NaN).
  - Main value displays real compact token count (e.g. `~231k / 200k`).
  - Percentage label displays `>100%`.
  - Bar color dynamically switches to high/warning utilization color (`#ef4444` / preset high).
  - Numbers $\ge 1,000$ are consistently formatted with `k` notation (e.g. `~14k`, `~200k`, `~231k`).

### Free Plan Compact Row
- **Single Neutral Notice for Free Plan:**
  - When usage state is `empty` (Free accounts returning null windows), Session 5h and Weekly 7d rows are completely hidden.
  - Replaced with ONE compact neutral line: *"Session & weekly limits not provided on this plan"*.
  - Completely eliminates misleading `0%` or `n/a` progress bars, red styling, and Retry buttons on Free tier.

### Conversation Refresh & Lifecycle
- **Automatic Context Refresh:**
  - Context tokens now refresh automatically when an assistant response finishes streaming (`cc:stream_completed`).
  - Switching chats via sidebar or links instantly resets to loading state (`"—"`) and fetches the new conversation tree.
  - Re-observes recreated `document.body` to guarantee panel self-healing even if Claude's framework re-renders the document root.

### Real-Shape Unit Test Suite
- Created `tests/fixtures/conversation_tree.json` using the confirmed claude.ai tree structure (empty `text: ""`, `content[].text`, attachments in `attachments[].extracted_content`, branching messages with root ID stop).
- Created `tests/tokens.test.js` (10/10 tests passing) covering:
  - Empty text + `content[].text` extraction
  - Attachment `extracted_content` counting
  - Branched tree leaf trunk isolation (ignoring abandoned branches)
  - Root message ID (`00000000-0000-4000-8000-000000000000`) traversal stop
  - Loading state (`isLoaded: false` -> `"—"`) vs genuine zero (`~0`)
  - Over-limit (>200k) formatting, capped bar, and `>100%` display
  - Consistent compact (k) formatting

---

### Organization ID & Network Reliability
- **Strict UUID Validation:** Enforced strict regex matching (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`) on all organization IDs. Explicitly rejects non-UUID URL slugs like `/api/organizations/discoverable`, preventing HTTP 400 Bad Request calls.
- **Ordered Resolution:** Prioritizes validated UUID from `lastActiveOrg` cookie, falling back to validated UUIDs sniffed from network paths. Never issues `/usage` calls without a valid UUID.
- **Request Discipline & Throttling:**
  - Promise deduplication ensures only one `/usage` request is in-flight at any time across all triggers.
  - Enforced a minimum 30-second throttle between background requests.
  - Immediate post-response refresh permitted once right after a streamed assistant message completes.
  - Exponential backoff on errors / HTTP 429, halting automatic retries after 3 consecutive failures until the next user event.

### Plan-Aware Usage Model & Normalizer
- **Plan-Aware Normalization (`src/content/normalize.js`):**
  - Distinguishes between `ok` (data present), `empty` (valid 200 with all-null windows / empty limits on Free tier), and `error` (actual HTTP / network failures).
  - Free-plan accounts now display a calm neutral message: *"No usage window active, or not provided for this plan"* with an explanatory tooltip instead of a red error banner.
  - Rows with no data are shown as greyed-out `n/a` or hidden, never as misleading `0%`.
  - Context (token) row is displayed only when an active conversation exists.
  - SSE fallback: if `/usage` is empty, active limits from SSE `message_limit` events fill the session and weekly bars live.
- **Automated Test Suite:** Created `tests/normalize.test.js` running against real free-plan and synthetic paid-plan fixtures in `tests/fixtures/`.

### Draggable Fixed Panel & Settings
- **DOM-Independent Fixed Panel:** Replaced brittle in-page DOM injection with a `position: fixed` draggable panel encapsulated inside an open ShadowRoot.
- **Draggable & Viewport Clamped:** Drag handle on the panel header allows placement anywhere on screen; coordinates are clamped to the viewport and saved in `localStorage.cc_panel_pos`. Includes a "Reset Position" button.
- **Self-Healing Mount:** Lightweight MutationObserver and 1s heartbeat detector automatically re-attach the panel within ~1s if removed by page transitions.
- **Compact Pill Mode:** Collapses into a minimal status pill (`⚡ 42% 5h · 18% 7d · ~14k`); click anywhere to expand. State remembered in `localStorage.cc_pill`.
- **Settings & Color Presets:**
  - Added 5 presets: **Default** (Claude Natural), **Ocean**, **Sunset**, **Mono**, and **High-contrast**.
  - Custom color pickers for low, mid, and high utilization thresholds, and background opacity slider.
  - WCAG contrast validator warns when custom color combinations fall below 4.5:1.
  - Row visibility toggles for Context, Session 5h, and Weekly 7d.

---

## [0.5.0] - 2026-10-17

### Architecture & Interception
- **Manifest V3 MAIN-World Injection:** Configured early bridge execution (`run_at: "document_start"` in `world: "MAIN"`), ensuring `window.fetch` and `history.pushState` are wrapped before Claude's SPA bundles initialize.
- **Resilient Fallback Injection:** Retained dynamic script injection fallback with ping/pong handshake for non-Chromium or older MV3 environments.
- **Extended Request Interception:** Added wrapping for both `fetch` and `XMLHttpRequest`, intercepting completions, SSE streams, conversation payloads, and native `/usage` calls.
- **Incremental Stream Parser:** Parses SSE chunks incrementally without delaying or buffering host page responses.

### Diagnostics & Safety
- **Debug Logging Mode:** Added `localStorage.setItem('cc_debug', 'true')` ring buffer recording matched selectors, parsed endpoints, and timestamps.
- **Sanitized Log Export:** Implemented `window.__CC_COPY_DEBUG_LOG()` to export redacted diagnostics (strips UUIDs, emails, tokens, and chat text).
- **Non-blocking Tokenizer:** Implemented async micro-task yielding during token computation on long chats.
