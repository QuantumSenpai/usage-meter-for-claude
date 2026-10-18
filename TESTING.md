# Testing Checklist: Usage Meter for Claude (v0.6.12)

## Brave & Chrome Checklist (v0.6.12 Diagnostic Lone @ Replacement in Frame ASCII)

### 1. Proto Frame ASCII Lone @ Replacement & Pipeline Verification
- **Preconditions:** Extension loaded in Brave or Chrome. Open `https://claude.ai` with DevTools open.
- **Steps:**
  1. Enable debug mode in DevTools Console:
     ```javascript
     localStorage.setItem('cc_debug', 'true');
     ```
  2. Reload the page (`Cmd + Shift + R`).
  3. Send a message in a conversation.
  4. Click the debug clipboard icon in the panel header next to the gear.
  5. Paste into an editor and inspect copied diagnostics.
- **Expected Results:**
  - `proto_token_seen` entries log with `needle` instead of `token`. The token string (e.g. `five_hour`, `remaining`, `within_limit`) survives intact and is NOT redacted as `[REDACTED_SECRET]`.
  - For uncompressed Connect envelope frames with `length <= 512` that contain a target token, `proto_frame_text` is emitted with `{ pathShape, frameIndex, length, head8hex, frameAscii }`.
  - In `proto_frame_text`, `head8hex` is the first 8 payload bytes as lowercase hex.
  - In `proto_frame_text`, `frameAscii` has non-printable bytes replaced with `.`, UUIDs masked with `[UUID]`, emails masked with `[EMAIL]`, and any remaining `@` bytes replaced with `(at)`. It is capped at 512 characters.
  - `frameAscii` survives in `main.js` debug log entries without being completely wiped to `[REDACTED_EMAIL]`.
  - At most 5 `proto_frame_text` entries are emitted per page load.
  - The live conversation message stream completes normally and renders in the chat UI.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave & Chrome Checklist (v0.6.11 Diagnostic Needle Unredaction & Frame ASCII Inspection)

### 1. Proto Token Needle & Connect Frame ASCII Diagnostic Verification
- **Preconditions:** Extension loaded in Brave or Chrome. Open `https://claude.ai` with DevTools open.
- **Steps:**
  1. Enable debug mode in DevTools Console:
     ```javascript
     localStorage.setItem('cc_debug', 'true');
     ```
  2. Reload the page (`Cmd + Shift + R`).
  3. Send a message in a conversation.
  4. Click the debug clipboard icon in the panel header next to the gear.
  5. Paste into an editor and inspect copied diagnostics.
- **Expected Results:**
  - `proto_token_seen` entries log with `needle` instead of `token`. The token string (e.g. `five_hour`, `remaining`, `within_limit`) survives intact and is NOT redacted as `[REDACTED_SECRET]`.
  - For uncompressed Connect envelope frames with `length <= 512` that contain a target token, `proto_frame_text` is emitted with `{ pathShape, frameIndex, length, head8hex, frameAscii }`.
  - In `proto_frame_text`, `head8hex` is the first 8 payload bytes as lowercase hex.
  - In `proto_frame_text`, `frameAscii` has non-printable bytes replaced with `.`, UUIDs masked with `[UUID]`, and emails masked with `[EMAIL]`. It is capped at 512 characters.
  - At most 5 `proto_frame_text` entries are emitted per page load.
  - Neither `head8hex` nor `frameAscii` is mangled by `main.js` debug data sanitization.
  - The live conversation message stream completes normally and renders in the chat UI.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave & Chrome Checklist (v0.6.8 Diagnostic Limit Scanners for Connect-RPC)

### 1. RPC Request Metadata & Stream Scan Verification
- **Preconditions:** Extension loaded in Brave or Chrome. Open `https://claude.ai` with DevTools open.
- **Steps:**
  1. Enable debug mode in DevTools Console:
     ```javascript
     localStorage.setItem('cc_debug', 'true');
     ```
  2. Reload the page (`Cmd + Shift + R`).
  3. Send a message in a conversation.
  4. Click the debug clipboard icon in the panel header next to the gear.
  5. Paste into an editor and inspect copied diagnostics.
- **Expected Results:**
  - `rpc_request_meta` entry logged for `POST /claudeai-rpc/...` with `pathShape`, `bodyType`, `bodyByteLength`. No request body content is logged.
  - If connect-proto stream contains limit-related tokens, `proto_token_seen` is logged with `pathShape`, `token`, `count`, `firstOffset`.
  - `proto_scan_done` is logged with `pathShape`, `bytesRead`, and `reason` (`size_cap`, `time_cap`, `stream_end`, `error`).
  - No binary or text content leaked from the stream.
  - The live conversation message stream completes normally and renders in the chat UI.
- **Result:**
  - [ ] Pass  [ ] Fail

### 2. JSON Limit Key Diagnostic Verification
- **Preconditions:** Debug mode enabled (`localStorage.setItem('cc_debug', 'true')`).
- **Steps:**
  1. Navigate between conversations or trigger `/api/` endpoints.
  2. Click the debug clipboard icon in the panel header next to the gear.
  3. Search for `limit_key_seen` entries.
- **Expected Results:**
  - Any matching JSON keys under `/api/` log `pathShape`, `keyPath`, and `valueType` (`number`, `string`, `boolean`, `null`, `object`, `array`).
  - Zero raw data values or text content present in the logs.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave & Chrome Checklist (v0.6.7 Strict Completion URL & Diagnostic Request Filtering)

### 1. Page Load Stream End Verification (No False-Positive `stream_end`)
- **Preconditions:** Extension loaded in Brave (or Chrome). Open `https://claude.ai` with DevTools open.
- **Steps:**
  1. Enable debug mode in DevTools Console:
     ```javascript
     localStorage.setItem('cc_debug', 'true');
     ```
  2. Reload the page (`Cmd + Shift + R`) without sending any messages.
  3. Click the debug clipboard icon in the panel header next to the gear (or run `__CC_COPY_DEBUG_LOG()` in Console).
  4. Inspect the copied JSON logs.
- **Expected Results:**
  - `stream_end` does NOT appear in the log on page load.
  - `assets-proxy.anthropic.com` static assets (such as `completionGzipWorker-*.js`) do NOT trigger `cc:generation_start`, `stream_end`, or `handleEventStream`.
- **Result:**
  - [ ] Pass  [ ] Fail

### 2. Request Diagnostics Filtering Verification
- **Preconditions:** Debug mode enabled (`localStorage.setItem('cc_debug', 'true')`).
- **Steps:**
  1. Browse conversations and trigger API requests.
  2. Click the debug clipboard icon in the panel header next to the gear.
  3. Inspect `request_seen` entries in the copied JSON.
- **Expected Results:**
  - `request_seen` entries ONLY appear for requests whose paths start with `/api/`, `/claudeai-rpc/`, or `/edge-api/`.
  - Zero `request_seen` entries for host `assets-proxy.anthropic.com`.
  - Zero `request_seen` entries for static JS scripts, images, CSS, or page navigations (e.g. `/chat/...`).
  - Required fields present on all entries: `method`, `host`, `pathShape`, `status`, `content-type`, `contentType`, `inputType`, `input`.
  - Buffer capped at 200 entries max.
- **Result:**
  - [ ] Pass  [ ] Fail

### 3. Normal Completion & Message Limit Flow
- **Preconditions:** Active conversation on `https://claude.ai`.
- **Steps:**
  1. Send a chat message.
  2. Observe panel during generation and upon completion.
- **Expected Results:**
  - Completion stream is intercepted and token counts / metrics update correctly.
  - Session and Weekly usage bars update when message limits are received.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave & Chrome Checklist (v0.6.6 Context & Cache Default Off and Request Diagnostics)

### 1. Fresh Profile First-Load Verification (Context & Cache OFF by default)
- **Preconditions:** Extension loaded in Brave (or Chrome). Open `https://claude.ai` with DevTools open.
- **Steps:**
  1. In DevTools Console, clear stored extension settings:
     ```javascript
     localStorage.removeItem('cc_settings');
     ```
  2. Reload the page (`Cmd + Shift + R`).
- **Expected Results:**
  - Panel renders with **Session (5h)** and **Weekly (7d)** rows visible.
  - **Context** and **Cache** rows are hidden (`.cc-hidden`).
  - Open settings drawer: Session and Weekly checkboxes are checked; Context and Cache checkboxes are unchecked.
  - In DevTools Console, check `JSON.parse(localStorage.getItem('cc_settings'))`:
    `showContext: false`, `showCache: false`, `showSession: true`, `showWeekly: true`.
- **Result:**
  - [ ] Pass  [ ] Fail

### 2. User Manually Enabling Context / Cache Persists Across Reloads
- **Preconditions:** Extension loaded on `https://claude.ai`.
- **Steps:**
  1. Open settings drawer (gear icon).
  2. Under "Rows Visibility", check **Context** (and/or **Cache**).
  3. Verify Context row immediately becomes visible in the panel.
  4. Reload the page (`Cmd + Shift + R`).
- **Expected Results:**
  - Context row remains visible after reload.
  - Settings drawer shows Context checkbox remains checked.
  - User's manual choice is preserved without being reset.
- **Result:**
  - [ ] Pass  [ ] Fail

### 3. Request Diagnostics (`request_seen`) Verification
- **Preconditions:** Enable debug mode in DevTools Console:
  ```javascript
  localStorage.setItem('cc_debug', 'true');
  ```
- **Steps:**
  1. Reload `https://claude.ai` (`Cmd + Shift + R`).
  2. Navigate between conversations or send a message.
  3. Click the debug copy button in the settings drawer (or run `__CC_COPY_DEBUG_LOG()` in Console).
  4. Search copied logs for `request_seen`.
- **Expected Results:**
  - `request_seen` entries appear for all network requests.
  - Fields present: `method`, `host`, `pathShape` (with IDs redacted to `:id`), `status`, `content-type`, `inputType` (`'string' | 'url' | 'request'`).
  - No query strings, request/response bodies, cookies, or authorization headers are present.
  - Log buffer length is capped at 200 entries maximum.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave Checklist (v0.6.5 Context & Cache Row Visibility & Telemetry Fixes)

### 1. Existing Profile Migration (Restoring Context & Cache Rows)
- **Preconditions:** Extension loaded in Brave (or Chrome). Open `https://claude.ai` with DevTools open.
- **Steps:**
  1. In DevTools Console, seed the exact problematic settings payload:
     ```javascript
     localStorage.setItem('cc_settings', JSON.stringify({
       "preset":"default","lowColor":"#10b981","midColor":"#f59e0b","highColor":"#ef4444","accentColor":"#3b82f6","opacity":0.94,"showSession":true,"showWeekly":true,"showContext":false,"showCache":false,"v060_migrated":true,"v061_migrated":true,"contextWindow":200000
     }));
     ```
  2. Reload the page (`Cmd + Shift + R`).
- **Expected Results:**
  - Panel mounts with **Context** and **Cache** rows visible (not hidden with `.cc-hidden`).
  - Open settings drawer: both **Context** and **Cache** checkboxes are checked.
  - In DevTools Console, check `JSON.parse(localStorage.getItem('cc_settings'))`:
    `showContext: true`, `showCache: true`, `v062_migrated: true`.
- **Result:**
  - [ ] Pass  [ ] Fail

### 2. Fresh Profile First-Load Verification
- **Preconditions:** Extension loaded. Open `https://claude.ai`.
- **Steps:**
  1. In DevTools Console, clear stored extension settings:
     ```javascript
     localStorage.removeItem('cc_settings');
     ```
  2. Open any conversation chat URL (`https://claude.ai/chat/<id>`).
- **Expected Results:**
  - Panel renders with all 4 rows visible: **Session (5h)**, **Weekly (7d)**, **Context**, and **Cache**.
  - No rows are hidden.
  - Settings drawer shows all 4 row checkboxes checked.
- **Result:**
  - [ ] Pass  [ ] Fail

### 3. User Unchecking Row Stays Persisted Across Reloads
- **Preconditions:** Extension loaded on `https://claude.ai`.
- **Steps:**
  1. Open settings drawer (gear icon).
  2. In "Rows Visibility", uncheck **Context**.
  3. Verify Context row immediately disappears.
  4. Reload the page.
- **Expected Results:**
  - Context row remains hidden after page reload.
  - Cache, Session, and Weekly rows remain visible.
  - One-time migration does NOT re-enable Context because `v062_migrated` is already `true`.
- **Result:**
  - [ ] Pass  [ ] Fail

### 4. Telemetry Deduplication (No 1-Second Ring Buffer Flooding)
- **Preconditions:** Enable debug mode in localStorage (`localStorage.setItem('cc_debug', 'true')`).
- **Steps:**
  1. Reload page and wait 15 seconds on a chat page.
  2. Click the debug copy button in the settings drawer.
  3. Inspect copied log entries for `panel_render_state`.
- **Expected Results:**
  - `panel_render_state` is logged only once on startup (or when values change).
  - Ring buffer does NOT contain 15 identical `panel_render_state` entries flooding the buffer.
  - Unchecking a row in settings drawer emits `row_visibility_changed` with caller label (`chk_ctx` / `chk_cache`) followed by a single updated `panel_render_state`.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave Checklist (v0.6.3 Stream Interception & Transport Diagnostics)

### 1. Intercept Message Stream at Unknown /api/ Path
- **Preconditions:** Extension loaded in Brave (or Chrome). Open `https://claude.ai` with DevTools open.
- **Steps:**
  1. Enable debug logging in panel settings drawer.
  2. Send a message in any conversation.
  3. Click the copy-debug button in the settings drawer.
- **Expected Results:**
  - Usage panel updates percentage and countdown as soon as `message_limit` event arrives.
  - Copied debug log contains `sse_stream_seen` with `{ method, status: 200, host, pathShape, matchedBy }`.
  - If WebSockets or Workers were opened by the page, copied log contains `transport_created` entries with redacted `pathShape`.
  - No secret tokens, cookies, org IDs, or chat text appear in the debug log.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave Checklist (v0.6.2 Empty & Error State Row Visibility Verification)

### 1. Fresh Profile / Empty Usage State
- **Preconditions:** Extension loaded in Brave (or Chrome). Open `https://claude.ai`.
- **Steps:**
  1. Open DevTools Console and clear stored usage data or test fresh profile:
     ```javascript
     localStorage.clear();
     ```
  2. Perform a hard refresh: `Cmd + Shift + R` (macOS) or `Ctrl + Shift + R` (Windows/Linux).
- **Expected Results:**
  - Panel is mounted above the composer card with class `cc-state-empty`.
  - Header **Usage Limits** and gear icon render immediately.
  - Both **Session (5h)** and **Weekly (7d)** rows are **VISIBLE** (computed `display: flex`, NOT `display: none`).
  - Progress bars are at 0% width with neutral/low tier color.
  - Percentage spans (`#cc-sess-pct`, `#cc-week-pct`) display `" — "`.
  - Reset spans (`#cc-sess-reset`, `#cc-week-reset`) display `" — "` (not blank and not verbose text).
  - Centered notice beneath rows displays: `"No data yet. Updates after your next message."`.
  - Empty notice is directly in the usage container and NOT inside any `display: none` wrapper.
- **Result:**
  - [ ] Pass  [ ] Fail

### 2. Error State Handling
- **Preconditions:** Extension mounted on `https://claude.ai`.
- **Steps:**
  1. Trigger error state (e.g. simulate offline network or rate limit).
- **Expected Results:**
  - Panel has class `cc-state-error`.
  - Both **Session (5h)** and **Weekly (7d)** rows remain **VISIBLE**.
  - Percentage spans display `" — "` and reset spans display `" — "`.
  - Error notice beneath rows displays error message and Retry button.
- **Result:**
  - [ ] Pass  [ ] Fail

### 3. Active / OK Usage State
- **Preconditions:** Send a message on `https://claude.ai` to receive SSE `message_limit` or fetch `/usage`.
- **Expected Results:**
  - Panel has class `cc-state-ok` (neither `cc-state-empty` nor `cc-state-error`).
  - Both rows display `"X% used · Y% left"` and respective reset countdowns.
  - Both notice elements are hidden.
- **Result:**
  - [ ] Pass  [ ] Fail

## Brave Checklist (v0.6.1 Bug Fix Verification)

### 1. Load with Old Settings (0.5.x legacy settings / disabled rows)
- **Preconditions:** Extension loaded in Brave (or Chrome). Open `https://claude.ai`.
- **Steps:**
  1. Open DevTools Console and simulate legacy 0.5.x settings that had Session and Weekly disabled:
     ```javascript
     localStorage.setItem('cc_settings', JSON.stringify({
       preset: 'default',
       lowColor: '#10b981',
       midColor: '#f59e0b',
       highColor: '#ef4444',
       accentColor: '#d97706',
       opacity: 0.94,
       showSession: false,
       showWeekly: false,
       contextWindow: 200000
     }));
     ```
  2. Perform a hard refresh: `Cmd + Shift + R` (macOS) or `Ctrl + Shift + R` (Windows/Linux).
- **Expected Results:**
  - Panel is **NOT** an empty dark bar.
  - Header **Usage Limits** and persistent action buttons (debug icon, gear icon) are clearly visible at the top.
  - One-time migration `v061_migrated: true` runs automatically and resets `showSession: true` and `showWeekly: true`.
  - Both **Session (5h)** and **Weekly (7d)** rows are visible with progress bars and reset countdowns.
  - Inspect console debug log: `panel_render_state` confirms:
    `{ showSession: true, showWeekly: true, showContext: false, showCache: false, rowsInDom: true, keys: ['cc_settings', ...] }`.
- **Result:**
  - [ ] Pass  [ ] Fail

### 2. Load with Cleared Settings (Fresh profile state)
- **Preconditions:** Extension loaded in Brave. Open `https://claude.ai`.
- **Steps:**
  1. Open DevTools Console and clear all storage:
     ```javascript
     localStorage.clear();
     ```
  2. Perform a hard refresh (`Cmd + Shift + R`).
- **Expected Results:**
  - Panel is mounted above the composer card.
  - Header **Usage Limits** and gear icon render immediately.
  - Both Session (5h) and Weekly (7d) rows render with clean fallback states (`"—"` and `"Updates after your next message"`).
  - Progress bars are at 0% width with default emerald green color.
  - Panel is stable, non-empty, and free of render exceptions.
- **Result:**
  - [ ] Pass  [ ] Fail

### 3. Reset Defaults (Settings Drawer Accessibility)
- **Preconditions:** Extension mounted and visible on `https://claude.ai`.
- **Steps:**
  1. Click the gear icon (`#cc-gear-btn`) in the header bar.
  2. Verify the Settings Drawer opens smoothly without displacing the composer.
  3. Change the preset (e.g. select "Sunset" or "Mono"), or uncheck a row checkbox.
  4. Click the **Reset Defaults** button at the bottom of the drawer.
- **Expected Results:**
  - Settings immediately revert to defaults:
    - Preset: Default (low: `#10b981`, mid: `#f59e0b`, high: `#ef4444`).
    - Opacity: `94%`.
    - Rows Visibility: Session (5h) and Weekly (7d) checked; Context and Cache unchecked.
  - Panel reflects the restored colors immediately.
  - Header bar and gear button remain permanently accessible.
- **Result:**
  - [ ] Pass  [ ] Fail

---

## How to Reload & Test in Brave (Chromium MV3)

Before starting each test round, ensure the latest unpacked extension is loaded:
1. Open **`brave://extensions`** (or `chrome://extensions`).
2. Verify **Developer mode** toggle in the top-right corner is **ON**.
3. Under **Usage Meter for Claude**, click the **Reload** icon (circular arrow).
4. Switch to your active `https://claude.ai` tab.
5. Perform a hard refresh: press **`Cmd + Shift + R`** (macOS) or **`Ctrl + Shift + R`** (Windows/Linux).
6. Open browser DevTools (**`Cmd + Option + I`** / **`F12`**) -> **Console** to monitor diagnostics.

---

## Brave Manual Verification Matrix (v0.5.6)

### 0. Context Percentage Used & Left, Tier Colors, and Row Tooltip
- **Preconditions:** Extension reloaded, open any chat on `https://claude.ai`.
- **Steps:**
  1. **Collapsed Thin Line Format:**
     - Observe the collapsed summary line.
     - *Expected:* Displays in the format `Context  [bar]  62% used · 38% left` with a clean height of ~32px.
     - The token estimate (`~124k est. / 200k`) is hidden in the collapsed state to keep the bar and percentage uncluttered.
  2. **Expanded View Format:**
     - Click the chevron (or summary line) to expand the details drawer.
     - *Expected:* Both the estimate (`~124k est. / 200k`) and percentages (`62% used · 38% left`) are clearly visible.
  3. **Tier Colors by Percent Used:**
     - In chats of varying lengths (or adjust the context window setting in the gear drawer):
       - `< 60%` used: Progress bar uses **LOW color** (emerald green `#10b981`).
       - `60% to < 90%` used: Progress bar and percentage text use **MID warning color** (amber orange `#f59e0b`).
       - `>= 90%` used: Progress bar and percentage text use **HIGH warning color** (crimson red `#ef4444`).
       - Note: Old "long chat" label and old "exceeds by 10%" rule are completely removed.
  4. **Over 100% Context Window:**
     - In a chat exceeding the context window (e.g. 231k tokens with 200k limit, or override limit to 100000):
     - *Expected:*
       - Bar is capped at 100% width.
       - Percentage text displays: `"100%+ used · 0% left"`.
       - Color is **HIGH color** (red `#ef4444`).
       - Expanded view displays real estimate (e.g. `~231k est. / 200k`).
  5. **Empty Chat vs. Loading State:**
     - Before conversation metrics arrive: Displays loading state `"— / 200k"` and `"—"`.
     - In a genuinely empty new chat (0 tokens): Displays `"0% used · 100% left"`.
  6. **Row Tooltip:**
     - Hover over the Context row / label / bar / percentage text.
     - *Expected:* Displays tooltip: `"Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings."`
  7. **Context Window Override Setting:**
     - Open Settings drawer (gear icon), adjust Context Window (e.g. 250000).
     - *Expected:* Immediately re-computes `Percent = round(tokens / contextWindow * 100)`, updates percentage used/left and tier colors, and updates denominator to `/ 250k`.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 1. Inline Mount Directly Above Composer Card
- **Preconditions:** Extension reloaded, open any chat on `https://claude.ai`.
- **Steps:**
  1. Inspect the composer input area at the bottom of the chat.
  2. Locate `#cc-usage-meter-root`.
- **Expected Results:**
  - Panel sits **inline directly ABOVE the composer card** as its previous sibling in document flow.
  - Zero fixed positioning, zero draggable handles, zero floating overlay.
  - Same width as composer card, with an 8px gap (`margin-bottom: 8px`) above the card.
  - No overlap with composer controls or message list.
  - No layout shift or jump when scrolling the conversation history.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 2. Default View (One Thin Line) & Expand / Collapse Toggle
- **Preconditions:** Open a chat with conversation messages.
- **Steps:**
  1. Observe the default appearance of the panel.
  2. Click anywhere on the thin summary line (or click the chevron arrow).
  3. Observe the expanded panel contents.
  4. Click the thin line again to collapse.
  5. Expand the panel, reload the page (`Cmd + Shift + R`), and observe state.
- **Expected Results:**
  - **Collapsed View (Default):** Displays as a single thin line (~32px high) containing: `Context` label, 7px mini progress bar, percent (`62% used · 38% left` or `100%+ used · 0% left`), gear icon, and chevron arrow.
  - **Click to Expand:** Smoothly unfolds the details area showing Cache status, Session/Weekly usage (or single free-plan notice), and Settings drawer.
  - **State Persistence:** Remembers collapsed/expanded state across page reloads via `localStorage.cc_expanded`.
  - **Gear Icon:** Clicking the gear icon opens color & limit settings without collapsing.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 3. Composer Re-Render Survival & Fast Post-Stream Refresh
- **Preconditions:** In an active chat with the panel mounted.
- **Steps:**
  1. Send a prompt to Claude and observe the Context row during and immediately after streaming finishes.
  2. Click another chat in the left sidebar, then click back.
- **Expected Results:**
  - When the assistant completes streaming, the Context row refreshes within ~1 second without page reload.
  - **Stale-while-revalidate:** While refetching in the same chat, the old count remains displayed (no flashing "—").
  - "—" appears only when switching chats or upon initial page load before conversation data arrives.
  - If Claude's server returns the pre-stream leaf message, the extension automatically retries once after ~1500ms and stops (no loops).
  - Single `#cc-usage-meter-root` remains mounted with zero duplication.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 4. Over-Limit State (>100% Context)
- **Preconditions:** Open a long conversation thread exceeding the context window limit (or set the override limit lower in the gear drawer).
- **Steps:**
  1. Observe the progress bar and percentage display in the thin line (and expanded details).
- **Expected Results:**
  - Progress bar is colored with the **warning/high color** (red `#ef4444`).
  - Percentage text displays: `"100%+ used · 0% left"`.
  - Progress bar width is strictly capped at `100%` (fills the track completely without overflowing).
  - Expanded view displays the full estimated count (e.g. `~231k est. / 200k`).
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 5. Cache Timer: Countdown and Inactive State
- **Preconditions:** Active chat with completed assistant responses.
- **Steps:**
  1. Expand the panel to view the Cache row.
  2. When no cache is active (e.g. >5 minutes after assistant message, or on new chat): observe Cache row.
  3. Send a message to Claude: observe Cache row during generation.
  4. When assistant finishes streaming: observe Cache row immediately and over the next 60 seconds.
- **Expected Results:**
  - **Inactive Cache:** Displays `Cache: —` with an empty circular SVG ring. The cache row is **never hidden**.
  - **During Generation:** Displays `Cache: caching...`.
  - **After Completed Response:** Displays countdown `M:SS remaining` (e.g. `4:59 remaining`) and counts down each second.
  - Circular SVG progress ring animates smoothly as time elapses.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 6. Light and Dark Theme & Narrow Window (<600px)
- **Preconditions:** In an active chat.
- **Steps:**
  1. Switch Claude between Light and Dark mode (via Claude user menu -> Theme or OS dark mode).
  2. Resize browser window to narrow width (<600px).
- **Expected Results:**
  - **Dark Mode:** Dark background (`rgba(30, 29, 28, 0.95)`), light text, subtle dark-theme border.
  - **Light Mode:** Light background (`rgba(255, 255, 255, 0.95)`), dark text, subtle light-theme border.
  - **Narrow Window:** Panel shrinks proportionally with the composer card; zero horizontal overflow or clipped text down to 360px.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 7. Hard Page Reload
- **Preconditions:** On `https://claude.ai/chat/<uuid>`.
- **Steps:**
  1. Press `Cmd + Shift + R` (macOS) or `Ctrl + Shift + R` (Windows).
- **Expected Results:**
  - Panel mounts immediately above the composer card as soon as input renders.
  - Fetches and counts tokens correctly without flash of error.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

## Regression Verification Matrix

### 8. Context Row Loading State vs Real Count
- **Preconditions:** Extension loaded, in any existing chat or new chat.
- **Steps:**
  1. Open a new chat (`/new`) or switch to an existing chat from the sidebar.
  2. Observe the Context row immediately upon navigation before conversation data finishes fetching.
  3. Wait for the conversation payload to arrive.
  4. In a genuinely empty chat, observe the loaded state.
  5. In a chat with existing messages, observe the calculated count.
- **Expected Results:**
  - **Before data arrives (or on new chat before fetch):** Context row displays `— / 200k` and `—`.
  - **Genuinely empty chat after load:** Displays `0% used · 100% left` (and `~0 est. / 200k` when expanded).
  - **Multi-message chat after load:** Displays percentage used & left (e.g. `62% used · 38% left`) and accurate estimate.
  - Never flashes `~0 / 200k` before real data arrives.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 9. FREE-Plan Account Behavior (One Neutral Compact Line)
- **Preconditions:** Logged into Claude on a Free tier account (where `/usage` returns all-null values).
- **Steps:**
  1. Inspect the Usage Meter panel in expanded view.
- **Expected Results:**
  - Session 5h and Weekly 7d rows are **completely replaced** by ONE compact neutral line:
    *"Session & weekly limits not provided on this plan"*.
  - **NO Session / Weekly 0% bars** and **NO greyed-out progress bars**.
  - **NO red error banner and NO "Retry" button**.
  - Context tokens and prompt cache countdown still operate normally inside active chats.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 10. PAID-Plan Account Behavior (When Limits are Present)
- **Preconditions:** Logged into Claude on a Pro/Team account with rolling utilization windows.
- **Steps:**
  1. Inspect the Session 5h and Weekly 7d rows in expanded view.
- **Expected Results:**
  - Session 5h row shows utilization percentage (e.g. `42.5%`), reset countdown (`resets in 2h 14m`), and temporal marker.
  - Weekly 7d row shows utilization percentage and reset countdown.
  - Smooth 300ms bar transitions and color interpolation based on chosen theme palette.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 11. Settings Drawer & Color Presets
- **Preconditions:** Panel in expanded mode.
- **Steps:**
  1. Click the gear icon (`⚙`) in the header.
  2. Click different presets: **Default**, **Ocean**, **Sunset**, **Mono**, **High-contrast**.
  3. Adjust the background opacity slider and custom color pickers.
  4. If low contrast is set (e.g. black text on dark background), observe the amber contrast warning (`< 4.5:1`).
  5. Adjust the Context Window override input.
  6. Click "Reset Defaults".
- **Expected Results:**
  - CSS variables update instantly inside the Shadow DOM.
  - Reset Defaults restores default colors and 200,000 token limit.
  - Settings persist in `localStorage.cc_settings` inside `try/catch`.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 12. Org ID UUID Validation
- **Preconditions:** DevTools Console open.
- **Steps:**
  1. Enable debug logging: `localStorage.setItem('cc_debug', 'true')` and reload tab.
  2. Inspect Console logs.
- **Expected Results:**
  - Console logs `[UsageMeter:Debug] [org_id_resolved]` with `source: "cookie"` or `source: "sniffed"`.
  - Non-UUID endpoints like `/api/organizations/discoverable` are strictly rejected.
  - No HTTP 400 requests to `/api/organizations/discoverable/usage`.
  - Actual UUID values are never printed in debug logs.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 13. Request Discipline & Throttling
- **Preconditions:** DevTools Network tab open (filter: `usage`).
- **Steps:**
  1. Navigate between chats rapidly, switch tabs, and trigger route changes.
- **Expected Results:**
  - Exactly one `/usage` request runs in-flight at a time (promise deduplication).
  - Background calls are throttled to a minimum 30 seconds interval.
  - One immediate refresh is permitted right after a streaming message completes.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 14. New Chat Page (`/new`)
- **Preconditions:** Navigate to `https://claude.ai/new`.
- **Steps:**
  1. Observe the inline panel above the composer card.
- **Expected Results:**
  - Context row displays `— / 200k` and `—` loading state until messages exist.
  - Session and Weekly limits (or free plan neutral notice) remain visible.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 15. Brave Shields (UP vs. DOWN)
- **Preconditions:** Active tab in Brave.
- **Steps:**
  1. Test with Brave Shields UP (standard blocking).
  2. Test with Brave Shields DOWN.
- **Expected Results:**
  - Extension operates consistently in both modes (all requests are strictly local to `claude.ai`).
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 16. Self-Healing Verification
- **Preconditions:** DevTools Elements tab.
- **Steps:**
  1. Manually select `#cc-usage-meter-root` in the Elements panel and hit Delete.
- **Expected Results:**
  - Within ~1 second, the self-healing MutationObserver and interval detector re-mount the panel seamlessly.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 17. Explicitly Unverified Items
> [!NOTE]
> Per project constraints, live testing cannot be performed on a live logged-in paid claude.ai session. The real capture on 17 Oct 2026 (`sse_message_limit.real.json`) verified `windows["5h"]`, `windows["7d"]`, and `resolved.limit` structures. The following remain unverified:
1. **Values at high usage:** Behavior and visual treatment when `utilization >= 0.90` or exceeding `1.0` in live accounts.
2. **Severity values other than `"normal"`:** Real payload examples when Claude flags elevated usage severity (e.g. `"warning"`, `"critical"`).
3. **Contents of `notice`:** The structure and fields of the `notice` key when Anthropic sends a user-facing notice payload.
4. **Real Claude Model Context Windows:** Context limit numbers remain unverified estimates (`CONTEXT_WINDOW_TOKENS = 200000`).

---

### 18. Chat Switch & Context Input Polish (v0.5.7 Bugfixes)
- **Preconditions:** Extension reloaded on `https://claude.ai`.
- **Steps:**
  1. **Chat Switch During In-Flight Fetch (Bug 2):**
     - Rapidly click from Chat A to Chat B in the sidebar.
     - *Expected:* Chat B does not get stuck on `" — "`. A distinct fetch is issued for Chat B, and Chat B's token count renders once fetched.
  2. **Chat Switch During Tokenization (Bug 1):**
     - Switch from a long chat (Chat A) to a short/empty chat (Chat B) while tokenization is in flight.
     - *Expected:* Chat A's token count is discarded (`conversation_metrics_dropped_stale` in debug log) and never appears in Chat B.
  3. **Loading State on Chat Switch (Check 3):**
     - Switch between chats.
     - *Expected:* Context row immediately clears the old count to `"—"` while fetching the new conversation.
  4. **Settings Drawer Color Tier Labels (Polish 4):**
     - Open Settings drawer (gear icon).
     - *Expected:* Custom Colors section displays labels: `"Low (0–60%)"`, `"Mid (60–90%)"`, and `"High (90%+)"`.
  5. **Context Window Input Keystroke Debouncing (Polish 4):**
     - Clear the Context Window input box to empty mid-typing.
     - *Expected:* Field does NOT snap back to `200000` while typing; settings are not saved.
     - Type `< 1000` (e.g. `500`): ignored without saving.
     - Type `150000` and stop: saves and applies after ~600ms debounce.
     - Type `300000` and press Enter: applies immediately on `change`.
     - Clear box completely and click outside (blur): resets to `200000` default.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 19. SSE Stream & Usage Diagnostics (v0.5.8)
- **Preconditions:**
  1. Open Brave DevTools (`Cmd + Option + I` or `F12`) -> **Console**.
  2. Enable debug logging: `localStorage.setItem('cc_debug', 'true')`.
  3. Reload the tab (`Cmd + Shift + R`).
- **Steps:**
  1. **SSE Event Types Logging (`sse_event_types`):**
     - Send a prompt on Claude and observe stream completion.
     - Look for `[UsageMeter:Debug] [sse_event_types]`.
     - *Expected:* Logs `{ types: [...] }` containing the list of SSE event type names seen in the completion stream (e.g., `message_start`, `content_block_delta`, `message_stop`). Names only, no payload content or chat text.
  2. **Message Limit Not Seen Telemetry (`message_limit_not_seen`):**
     - If the completion stream contains no `message_limit` event (typical on Free accounts):
     - *Expected:* Exactly one `[UsageMeter:Debug] [message_limit_not_seen]` log is emitted at stream conclusion.
  3. **Message Limit Event Shape Telemetry (`message_limit_event_shape`):**
     - If a `message_limit` event is received in the completion stream:
     - *Expected:* Emits `[UsageMeter:Debug] [message_limit_event_shape]`.
     - Recursively logs keys up to depth 4.
     - Preserves values only if number, boolean, null, ISO-8601 date, or short string (`/^[a-z_]{1,24}$/`).
     - Any long or non-matching string value is redacted to `[STR_n_CHARS]`.
     - No chat text or user prompt content is ever emitted.
  4. **Usage Response Shape Telemetry (`usage_response_shape`):**
     - Trigger a `/usage` poll or inspect initial load.
     - Look for `[UsageMeter:Debug] [usage_response_shape]`.
     - *Expected:* Top-level and 1-level-deep key names are logged with their value type (`number`, `null`, `string`, `object`, `array`) and numeric values when numbers.
     - Obfuscated keys (e.g. `tangelo`, `iguana_necktie`) log only key names and types, never parsed values.
  5. **Ring Buffer & Clipboard Copy Export:**
     - Click the clipboard copy icon in the Usage Meter UI.
     - Paste into a text editor.
     - *Expected:* Ring buffer contains all debug lines formatted cleanly with timestamp prefixes.
     - Verify zero raw user text, tokens, or cookie secrets exist in the exported buffer.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 20. Rebuilt Plan Usage Limits Panel (v0.6.0)
- **Preconditions:**
  1. Load unpacked extension in Brave (`brave://extensions` -> Reload).
  2. Navigate to `https://claude.ai`.
  3. Ensure DevTools is open (`Cmd + Option + I` or `F12`) to Console and Network tabs.
- **Steps:**
  1. **Two Always-Visible Plan Usage Rows:**
     - Observe the panel above the composer.
     - *Expected:* Displays two primary rows: `"Session (5h)"` and `"Weekly (7d)"`.
     - Context and Cache rows are NOT visible by default.
     - Thin-line collapsed mode is removed; both rows are always shown cleanly.
  2. **Values and Formatting:**
     - After receiving a message limit event:
     - *Expected:*
       - Session row: shows `"<used>% used · <left>% left"` where `left = max(0, 100 - used)`.
       - Weekly row: shows `"<used>% used · <left>% left"`.
       - Hovering over either percentage text displays tooltip: `"Derived: 100% minus used"`.
       - Progress bars reflect the respective percentage (capped at 100%).
  3. **Reset Countdowns & Local Clock Time:**
     - *Expected:*
       - Session reset text: displays countdown (e.g., `"resets in 2h 14m"` or `"resets in <1m"`).
       - Weekly reset text: displays countdown in days and hours (e.g., `"resets in 3d 4h"`).
       - Hovering over the Weekly reset text displays tooltip with user's local clock date/time formatted via `Intl` (e.g., `"Mon, Oct 19, 5:30 AM"`).
  4. **Window Rollover Handling (`now >= resets_at`):**
     - If current time is past the window's reset time (e.g., session expired):
     - *Expected:*
       - Percentage text displays: `" — "`.
       - Reset text displays: `"Window reset, send a message to update"`.
       - Progress bar width resets to `0%`.
  5. **Empty State (Fresh Start / No Data):**
     - On an account with no message history or no cached limits:
     - *Expected:*
       - Both rows display `" — "` for percent and `"Updates after your next message"` for reset.
  6. **Persistence Across Page Reloads (`cc_last_limit:<orgId>`):**
     - Send a message so usage limits are captured.
     - Hard refresh the page (`Cmd + Shift + R`).
     - *Expected:*
       - Before sending any new message, the panel immediately renders the saved Session and Weekly bars/percentages from `cc_last_limit:<orgId>`.
       - Hovering over each row displays tooltip: `"As of your last message at HH:MM"` (or date/time if prior day).
  7. **Multi-Organization Isolation:**
     - If using multiple Claude workspaces/orgs:
     - Switch organization.
     - *Expected:* Org B immediately loads Org B's persisted data if present, or renders empty state (`" — "`). Org A's data is never displayed in Org B.
  8. **Settings Drawer Toggles & Migration:**
     - Open the gear drawer.
     - *Expected:*
       - Context Window number input is hidden by default.
       - Two new toggles exist: `"Show Context window estimate"` and `"Show prompt cache timer"`.
       - Pre-existing settings from earlier versions are automatically migrated to have both unchecked (`v060_migrated: true`) while preserving custom theme and colors.
       - Check `"Show Context window estimate"`: Context row appears above composer, and Context Window number input appears in the gear drawer.
       - Check `"Show prompt cache timer"`: Cache row appears.
       - Uncheck both: Context and Cache rows hide again.
  9. **Skipping Conversation Fetch while Hidden:**
     - With Context and Cache toggles unchecked:
     - Filter Network tab by `chat_conversations`.
     - Send a message or navigate between chats.
     - *Expected:* ZERO `/chat_conversations` requests are made by the extension.
     - Turn on Context in settings: `/chat_conversations` request is immediately dispatched.
  10. **Aesthetics, Transitions & Motion:**
      - Inspect the progress bars.
      - *Expected:* Smooth ~300ms transition on width changes.
      - In system settings or DevTools, emulate `prefers-reduced-motion: reduce`: transitions are disabled (`none`).
      - Resize browser window to under 600px width: layout wraps/adjusts cleanly with aligned columns, readable 12-13px font, and no horizontal overflow.
      - Test both Light and Dark modes: high-contrast text and border styling match the Claude theme.
  11. **Diagnostics Telemetry (`message_limit_received`):**
      - With `cc_debug` enabled, send a message.
      - *Expected:* DevTools console logs `[UsageMeter:Debug] [message_limit_received]` containing only status strings, numbers, and null/boolean fields.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 14. Connect-RPC Stream Timeline Diagnostics (0.6.9)
- **Preconditions:**
  1. `localStorage.setItem('cc_debug', 'true')` enabled on `https://claude.ai`.
  2. Open DevTools Console and Network tabs.
- **Steps:**
  1. Open or start a chat on `https://claude.ai`.
  2. Send a message to trigger `POST .../ConversationService/PerformAction` and response streaming on `POST .../ConversationService/StreamTimeline`.
  3. Observe console messages `[UsageMeter:Debug]`.
  4. Click the clipboard icon in the panel header next to the gear to copy the full diagnostic debug log.
- **Expected Results:**
  - `proto_frame_meta`: Emits for the first 40 frames of the stream containing only `{ pathShape, frameIndex, flags, length }`. Zero payload bytes logged.
  - `proto_compressed_seen`: If bit 0 of `flags` is set, emits `{ pathShape, frameIndex }`. Zero payload bytes logged.
  - `proto_token_seen`: If target token is encountered, emits `{ pathShape, token, count, firstOffset, frameIndex }`.
  - `proto_scan_done`: Emits with `reason: 'stream_end'`, `'size_cap'`, or `'time_cap'`. For `StreamTimeline`, time cap is 600s (not 15s) and byte cap is 1 MiB (1048576 bytes).
  - Original webpage chat stream remains completely unbroken and smooth.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________


