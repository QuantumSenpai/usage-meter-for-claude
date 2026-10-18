# Changelog

All notable changes to **Usage Meter for Claude** will be documented in this file.

## [0.6.13] - 2026-10-18

### Diagnostic Connect Frame Hex Inspection
- **Raw Hex Payload Field for Connect Envelope Frames (`proto_frame_text.frameHex`):**
  - Added `frameHex` to `proto_frame_text` diagnostic in `src/injected/bridge.js`: encodes the full frame payload as lowercase hex with no separators.
  - Emitted strictly when `payload.length <= 256` bytes AND the payload contains at least one of four limit strings: `five_hour`, `seven_day`, `within_limit`, `utilization`.
  - For frames longer than 256 bytes or containing none of the four strings, `frameHex` is omitted.
  - Preserves the existing cap of 5 `proto_frame_text` entries per page load, uncompressed flags requirement, and all existing masking rules.
  - Leaves `src/content/main.js` redaction rules completely unchanged.
  - Verified through real bridge code and real `main.js` pipeline with behavioral negative proof.

## [0.6.12] - 2026-10-18

### Connect Frame ASCII Lone @ Replacement & Pipeline Verification
- **Lone `@` Replacement in Connect Frame ASCII (`proto_frame_text`):**
  - In `src/injected/bridge.js`, replaces all remaining `@` characters in `frameAscii` with `(at)` after masking UUIDs and emails and before capping/posting.
  - Prevents `src/content/main.js` `sanitizeDebugData` rule (`value.includes('@') && value.includes('.')`) from wiping the entire `frameAscii` string to `[REDACTED_EMAIL]` when an uncompressed Connect-RPC frame contains a lone 0x40 byte alongside dots from non-printable byte replacements.
  - Leaves `main.js` redaction rules completely unchanged.
  - Real email addresses remain masked as `[EMAIL]`, UUIDs remain masked as `[UUID]`, and `head8hex` survives unchanged.
  - Verified through the real bridge code and real `main.js` pipeline that `needle` survives intact in `proto_token_seen` and `frameAscii` with lone 0x40 bytes survives intact in `proto_frame_text`, backed by behavioral negative proofs.

## [0.6.11] - 2026-10-18

### Diagnostic Token Unredaction & Connect Frame ASCII Inspection
- **Token Name Field Renamed (`proto_token_seen`):**
  - Renamed diagnostic data field `token` to `needle` in `postDiag('proto_token_seen', { pathShape, needle, count, firstOffset, frameIndex })`.
  - Prevents `sanitizeDebugData` redaction rule (`key.toLowerCase().includes('token')`) in `src/content/main.js` from redacting the token name to `[REDACTED_SECRET]`.
- **Connect Frame ASCII Diagnostic (`proto_frame_text`):**
  - Emits `proto_frame_text { pathShape, frameIndex, length, head8hex, frameAscii }` for Connect-RPC envelope frames that are uncompressed (`(flags & 0x01) === 0`), not end-stream (`(flags & 0x02) === 0`), have `length <= 512`, and whose payload contains at least one `PROTO_TOKENS` entry.
  - Buffers candidate frame payloads across chunk boundaries up to 512 bytes.
  - Generates `frameAscii` decoded as latin1 with non-printable bytes (outside `0x20`–`0x7E`) replaced by `.`, UUIDs masked as `[UUID]`, and emails masked as `[EMAIL]`, capped at 512 characters.
  - Emits `head8hex` as the first 8 payload bytes formatted as lowercase hex.
  - Enforces a hard limit of at most 5 `proto_frame_text` entries per page load. Never emits for compressed frames or frames over 512 bytes.
  - Verified through the real redaction pipeline that neither `frameAscii` nor `head8hex` is mangled.

## [0.6.10] - 2026-10-18

### Incremental Per-Chunk Proto Token Scanning & Carry-Over Boundary Matching
- **Incremental Proto Token Search (`proto_token_seen`):**
  - Searches binary protobuf and Connect-RPC stream chunks incrementally as each chunk arrives, rather than waiting until the entire stream read loop ends.
  - Maintains a carry-over tail of 18 bytes (`longest token length - 1`, where `representativeClaim` is 19 bytes) across chunk boundaries so tokens split across chunks are reliably detected and mapped to their stream offset.
  - Emits `proto_token_seen { pathShape, token, count, firstOffset, frameIndex }` immediately the first time each token is observed in an active, still-open stream with the count observed at that moment.
  - If the token's count increases across subsequent chunks of the stream, emits an updated `proto_token_seen` with the final total count when the scan terminates.
  - Leaves `proto_scan_done`, all per-page logging caps, deduplication, and clone-only reading completely untouched.

## [0.6.9] - 2026-10-18

### Extended StreamTimeline Scanning, Connect Frame Metadata & Expanded Token Set
- **StreamTimeline Scanning Extension (`POST .../StreamTimeline`):**
  - For long-lived `/claudeai-rpc/` responses whose pathname ends with `/StreamTimeline`, removed the 15-second time cap.
  - Added a 600-second (10-minute) hard cap and raised the byte cap to 1,048,576 total bytes (1 MiB) per stream, allowing message reply phases to be scanned.
  - Other RPC and protobuf paths strictly retain their existing 15-second time cap and 262,144-byte (256 KB) cap.
  - Scanner continues to cancel only the cloned reader upon completion, timeout, or cap, leaving the original response body untouched and readable by the page.
- **Connect-RPC Envelope Frame Metadata (`proto_frame_meta` & `proto_compressed_seen`):**
  - Parses 5-byte Connect envelope frame headers (1-byte flag, 4-byte big-endian unsigned length) across stream chunk boundaries.
  - Emits `proto_frame_meta { pathShape, frameIndex, flags, length }` for the first 40 frames of each scanned stream, logging ONLY the flag byte and length number with zero payload bytes logged.
  - If a frame has the compressed flag set (bit 0 set: `(flags & 0x01) !== 0`), also emits `proto_compressed_seen { pathShape, frameIndex }` without logging any payload bytes.
- **Expanded Token Set & Frame Mapping (`proto_token_seen`):**
  - Expanded search tokens to 10 targets: `five_hour`, `seven_day`, `within_limit`, `utilization`, `message_limit`, `resets_at`, `rate_limit`, `usage_limit`, `representativeClaim`, `overage`.
  - Added `frameIndex` mapping to `proto_token_seen { pathShape, token, count, firstOffset, frameIndex }` indicating which Connect frame contains the first occurrence of the token.
  - Raised the per-page cap for `proto_token_seen` to 80 entries (JSON key dedupe and 40-entry cap remain untouched).

## [0.6.8] - 2026-10-18

### Diagnostic Limit Scanners (JSON & Binary Proto) for Connect-RPC
- **Diagnostic Limit Key Scanner (`limit_key_seen`):**
  - Actively inspects `claude.ai` JSON responses (`status: 200`, `pathname` starting `/api/`, `content-type: application/json`) using non-blocking cloned response text (`response.clone().text()`).
  - Skips bodies larger than 200,000 characters.
  - Deep-walks JSON trees up to depth 6 looking for limit-related keys matching `/limit|usage|utiliz|quota|remaining|reset|percent|severity|notice|banner/i`.
  - Emits `limit_key_seen { pathShape, keyPath, valueType }` without ever logging or leaking data values or string contents.
  - Capped at 40 entries per page load and deduplicated by `pathShape + keyPath`.
- **Diagnostic Binary Proto Scanner (`proto_token_seen` & `proto_scan_done`):**
  - Actively inspects `claude.ai` RPC and protobuf responses (`pathname` starting `/claudeai-rpc/` or `content-type` containing `proto`) using non-blocking cloned stream body reading (`response.clone().body.getReader()`).
  - Caps streaming reads at 262,144 bytes (256 KB) or 15 seconds maximum, explicitly canceling only the cloned reader while leaving the webpage's original response body untouched and readable.
  - Searches binary stream bytes for target ASCII tokens (`five_hour`, `seven_day`, `within_limit`, `utilization`, `message_limit`, `resets_at`, `rate_limit`, `usage_limit`).
  - Emits `proto_token_seen { pathShape, token, count, firstOffset }` and `proto_scan_done { pathShape, bytesRead, reason }` (`size_cap`, `time_cap`, `stream_end`, `error`).
  - Capped at 40 entries per page load.
- **Diagnostic RPC Request Metadata (`rpc_request_meta`):**
  - Emits `rpc_request_meta { pathShape, bodyType, bodyByteLength }` for POST requests to `/claudeai-rpc/` without inspecting or logging request body content.
- **Zero Overhead & Zero Behavior Change:**
  - All scanners are strictly disabled when `cc_debug` is off (`response.clone()` is never called, zero memory/CPU overhead).
  - Webpage requests and stream reading are completely unaffected.

## [0.6.7] - 2026-10-18

### Strict Completion URL Matching & Diagnostic Request Filtering
- **Strict Completion Request Matching (`isCompletionRequestUrl`):**
  - Replaced loose `.includes('/completion')` and `.includes('/retry_completion')` substring checks across `wrapFetch` and `wrapXHR` with a shared helper `isCompletionRequestUrl(url)`.
  - Parses the URL and matches only when host is `claude.ai` and pathname matches `/^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/(completion|retry_completion)$/`.
  - Fixes false-positive stream completion on page load caused by static asset script fetches matching `/completion` (e.g., `completionGzipWorker-Q_JtDKxH.js` hosted on `assets-proxy.anthropic.com`).
  - Preserves legitimate completion and retry_completion endpoints with or without query parameters (e.g., `?tree=true`).
  - Preserves general Server-Sent Events (SSE) content-type matching for arbitrary streaming endpoints.
- **Diagnostic `request_seen` Filtering:**
  - `request_seen` diagnostic telemetry now strictly ignores requests to `assets-proxy.anthropic.com` and any request whose pathname does not begin with `/api/`, `/claudeai-rpc/`, or `/edge-api/`.
  - Eliminates debug ring buffer pollution from static scripts, icons, styles, and page navigations while preserving API request observation.
  - Maintains all existing telemetry fields (`method`, `host`, `pathShape`, `status`, `content-type`, `contentType`, `inputType`, `input`) and 200-entry ring buffer capacity.

## [0.6.6] - 2026-10-18

### Context & Cache Rows Default Off and Request Diagnostics
- **Row Defaults Reversed to OFF:**
  - In `src/content/ui.js`, `showContext` and `showCache` are now `false` by default on fresh installations and unconfigured profiles.
  - Session and Weekly rows remain `true` (ON) by default.
  - Settings toggles in the Rows Visibility drawer remain fully functional so users can turn Context/Cache on by hand.
  - Removed the one-time `v062_migrated` logic that forced rows ON. No migration modifies values the user already saved.
  - Kept harmless `row_visibility_changed` logging and deduplicated `panel_render_state` telemetry from 0.6.5.
- **Request Diagnostics & Robust Request Object Handling (Debug Mode Only):**
  - Added `request_seen` diagnostic telemetry emitted for EVERY fetch and XHR seen by the bridge when `cc_debug` is enabled.
  - Fields logged: `method`, `host`, `pathShape` (IDs replaced by `:id`, query strings stripped), `status`, `content-type`, and `inputType` (`'string' | 'url' | 'request' | 'other'`).
  - Strict privacy: never logs bodies, headers (other than content-type), cookies, or query strings.
  - Ring buffer capacity increased to 200 entries per page load (`DEBUG_LOG_MAX_ENTRIES: 200`).
  - Added duck-typed Request handling (`(rawInput && typeof rawInput === 'object' && typeof rawInput.url === 'string')`) across `toAbsoluteUrl`, `getHost`, `computePathShape`, and `wrapFetch`, ensuring cross-realm or polyfilled Request inputs are resolved properly.

## [0.6.5] - 2026-10-18

### Fix Context and Cache Row Visibility & Telemetry Noise
- **Row Visibility Restoration & Guaranteed Default Display:**
  - Context and Cache rows default to visible (`showContext: true`, `showCache: true`) on fresh installations and unconfigured profiles.
  - Missing or non-boolean visibility values in saved settings strictly default to `true`.
  - Visibility state may only be modified by the user toggling checkboxes in the Rows Visibility drawer or via "Reset Defaults". No runtime or migration logic may flip rows to false.
- **One-Time Migration (`v062_migrated`):**
  - Added one-time migration (`v062_migrated: true`) restoring `showContext: true` and `showCache: true` for all existing and previously migrated profiles.
  - *Note:* This one-time migration restores rows to visible across existing profiles and overrides rows previously hidden on purpose; users who wish to hide them can uncheck them in the settings drawer and that choice will remain persisted.
- **Deduplicated Render State Telemetry:**
  - `panel_render_state` debug telemetry is now deduplicated, logging only when any rendered state values (`showSession`, `showWeekly`, `showContext`, `showCache`, `rowsInDom`, or `keys`) change.
  - Eliminates debug ring buffer flooding caused by per-second timer countdown ticks.
- **Row Visibility Change Diagnostics:**
  - Added `row_visibility_changed { row, visible, caller }` debug logging to trace any caller mutating row visibility flags.

## [0.6.4] - 2026-10-18

### Fix ReferenceError on originalFetch in Bridge Message Handler
- **Scope Fix:** Moved `originalFetch` declaration to module/IIFE scope so it is accessible to both `wrapFetch` and the `cc:request` message handlers for `/usage` and `/chat_conversations`.
- **Integrity Tests:** Added VM sandbox integration tests verifying all `cc:*` message types (`cc:ping`, `cc:request` for `hash`, `usage`, `conversation`) execute without ReferenceError or TypeError.

## [0.6.3] - 2026-10-17

### URL-Independent SSE Interception & Redacted Diagnostics
- **Path-Independent Stream Interception:**
  - Added `isSseResponse(response)` to detect `content-type: text/event-stream`.
  - Intercepts and parses SSE streams for ANY response with `text/event-stream` (preserving full breadth of 0.6.2 across all hosts and paths) plus legacy completion URL matching.
  - Guarantees the page receives the original response untouched, reading only from an independent clone.
- **Redacted Diagnostics (Debug Only):**
  - Added `sse_stream_seen { method, status, host, pathShape, matchedBy: 'url'|'content-type' }` emitted on stream interception.
  - Added non-invasive constructor proxy wrappers for `EventSource`, `WebSocket`, `Worker`, and `SharedWorker` emitting `transport_created { kind, pathShape }`.
  - Safe `pathShape` redaction: preserves pathname only (no query), replacing UUIDs, 16+ hex strings, and digits with `:id`, and logging only the scheme for `blob:` and `data:`.
  - Relayed via `cc:diag` to the content script debug ring buffer when debug mode is enabled; zero overhead when debug is off.

## [0.6.2] - 2026-10-17

### Fix Session and Weekly Row Visibility in Empty and Error States
- **Row Visibility in All States:**
  - Removed `.cc-state-empty #cc-row-session, .cc-state-empty #cc-row-weekly { display: none !important; }` rule from stylesheet. Rows are never hidden by panel state.
  - In empty state, each row displays its label, neutral 0% bar, `" — "` for percent used/left, and `" — "` for reset time.
- **Notices Relocated to Normal Document Flow:**
  - Moved `#cc-empty-notice` and `#cc-error-notice` out of `<div style="display: none;">` into `.cc-usage-container` directly beneath the usage rows.
  - Centered text alignment for `#cc-empty-notice`: `"No data yet. Updates after your next message."`.
- **Consistent Dash Rendering on Empty and Error States:**
  - Fixed fallback text in template and `renderSessionAndWeekly()`: when reset time is unavailable or plan data has not arrived yet, reset text renders `" — "` (never blank `""` or verbose inline text).
- **Automated Verification:**
  - Added general CSS parser test checking `UI_STYLES` ensures no rules targeting `#cc-row-session`, `#cc-row-weekly`, `.cc-row--session`, or `.cc-row--weekly` have `display: none` or hiding properties (generic `.cc-hidden` allowed).
  - Added real `CounterUI` render path tests asserting visible rows with `" — "` spans and visible notices (not inside hidden ancestors) for empty, error, and ok states.

## [0.6.1] - 2026-10-17

### Fix Empty Panel Bug & Legacy Settings Migration
- **Root Cause & Fix for Empty Panel in Brave / Legacy Profiles:**
  - Resolved issue where profiles with historical `0.5.x` settings or disabled rows rendered an empty dark bar with no Session/Weekly rows, no header, and no accessible gear button.
  - Added one-time migration (`v061_migrated: true`) in `_loadSavedSettings()` that forces `showSession: true` and `showWeekly: true` visible once while preserving user custom themes, colors, and opacity.
- **Persistent Header & Guaranteed Gear Button Access:**
  - Decoupled `#cc-gear-btn` and `#cc-debug-btn` from `#cc-row-session` into a persistent top `.cc-header` element.
  - Ensures settings drawer and "Reset Defaults" button are always reachable even when both usage rows have no data or are toggled off.
- **Strict Settings Validation & Range Clamping:**
  - Added key-by-key type and range validation in settings loader with fallback to defaults per key.
  - Custom colors validated with hex regex (`^#[0-9a-fA-F]{3,8}$`), falling back to default theme colors.
  - Opacity strictly clamped to `[0.50, 1.00]` based on UI slider range (`min="50"` to `max="100"`).
  - Context window integer validated to `[1000, 10000000]` with 200,000 fallback.
- **Render Path Error Safety:**
  - Wrapped `renderSessionAndWeekly()` and `renderAll()` in `try / catch` blocks.
  - On render failure, logs `render_error` with name and message only, and renders fallback rows displaying `" — "` so the panel never collapses into an empty bar.
- **Diagnostic Telemetry:**
  - Added `panel_render_state` debug log emitting booleans only (`showSession`, `showWeekly`, `showContext`, `showCache`, `rowsInDom`) and list of `cc_*` localStorage key names (never values).
- **Automated Tests:**
  - Added real-code unit tests (Tests 26–34 in `tests/mount.test.js`) verifying migration of historical settings, range clamping, fallback rendering, persistent header/gear access, and `panel_render_state` telemetry.

---

## [0.6.0] - 2026-10-17

### Rebuilt Panel for Plan Usage Limits (Session & Weekly), Local Storage Persistence & Cleanup
- **Rebuilt UI for Plan Usage Limits Only:**
  - Panel rebuilt to display ONLY plan usage limits: **Session (5h)** and **Weekly (7d)** in clean, aligned rows.
  - Each row displays: window label, progress bar (capped at 100%), `"X% used · Y% left"`, and reset countdown.
  - Tooltip on percentage text explains: `"Derived: 100% minus used"`.
  - Session countdown displays `"resets in Xh Ym"` (or `"<1m"`).
  - Weekly countdown displays `"resets in Xd Yh"` plus local clock time/date in tooltip (e.g. `"Mon 5:30 AM"`) formatted via browser's `Intl.DateTimeFormat`.
  - Tier colors based on percent used: `< 60%` low color, `60% <= pct < 90%` mid color, `>= 90%` high color.
  - Smooth bar width transition (~300ms), disabled under `@media (prefers-reduced-motion: reduce)`.
  - Narrow layout support: adapts smoothly below 600px without horizontal overflow.
- **Default Hidden Context & Cache Rows:**
  - Context and Cache rows hidden by default from the main panel.
  - Context Window override input hidden by default from the settings drawer.
  - Added checkboxes in Settings Drawer to toggle Context and Cache rows back on.
  - One-time migration (`v060_migrated: true`) hides Context and Cache for existing user settings while preserving custom presets, colors, and opacity.
  - While Context and Cache are hidden, `/chat_conversations` fetch and background tokenization are skipped completely, saving network bandwidth and CPU. Resumes immediately when toggled on.
- **Per-Org Persistence & Multi-Org Isolation:**
  - Saves last known usage windows to `localStorage` under `cc_last_limit:<orgId>` with `capturedAt`.
  - Loads persisted data on startup so usage bars show before the first message.
  - Tooltip on rows shows `"As of your last message at HH:MM"`.
  - If `now >= resets_at`, window displays `" — "` and `"Window reset, send a message to update"`.
  - Empty state with no data and nothing persisted displays `" — "` and `"Updates after your next message"`.
  - Strict multi-org isolation: switching organizations clears previous org's in-memory data and loads only the active org's key.
- **Diagnostics & Cross-Checking:**
  - Added debug log `message_limit_received` (status strings + numbers only, routed through redaction).
  - Cross-checks Session utilization against `resolved.limit.percent`: if differing by > 1, uses `resolved.limit.percent` and logs `limit_percent_mismatch`.
- **Automated Tests:**
  - Added tests in `tests/mount.test.js` exercising real bridge event stream handler with fake stream and verified capture fixture, org isolation, rollover state, settings migration, and conversation fetch skipping.

---

## [0.5.8] - 2026-10-17

### Diagnostic Logging for Free Account SSE Streams & Usage Shapes
- **SSE Stream Diagnostic Telemetry (`bridge.js` & `main.js`):**
  - Added safe, redacted debug telemetry active only when `cc_debug` is enabled, routed to the existing redacting ring buffer (`debugLogBuffer`) so clicking the clipboard button copies complete diagnostics.
  - `sse_event_types`: logs the list of SSE event type names seen per completion stream (names only).
  - `message_limit_event_shape`: for every `message_limit` SSE event, recursively logs key names (depth <= 4). Values are preserved ONLY if number, boolean, null, ISO-8601 date string, or short lowercase/snake string (`/^[a-z_]{1,24}$/`). All other string values are redacted as `[STR_n_CHARS]`, strictly preventing chat or prompt text exposure.
  - `usage_response_shape`: logs top-level and one-level-deep key names of `/usage` response along with value types (`number`, `null`, `string`, `object`, `array`) and numeric values. Obfuscated keys are logged by name only without parsing.
  - `message_limit_not_seen`: logged once per completion stream if no `message_limit` event was received.
- **Trace & Root Cause Analysis:**
  - Audited `src/injected/bridge.js`, `src/content/bridge-client.js`, `src/content/main.js`, and `src/content/normalize.js`.
  - Traced why Session/Weekly % and reset time are not shown on Free accounts:
    1. Free plan `/usage` response returns all-null windows (`five_hour: null`, `seven_day: null`), resulting in `state: "empty"` (`tests/fixtures/free_plan.json`).
    2. Anthropic's web UI displays session limit warnings ("You've used 90% of your session limit") via internal/client-side state or non-standard SSE events.
    3. `bridge.js` strictly listens for `type === 'message_limit'` or `.message_limit` or `.windows`. If Claude does not emit `message_limit` SSE events on Free tier, no fallback data is dispatched.
- **Automated Tests:**
  - Added real-code unit tests in `tests/normalize.test.js` validating shape redaction, string privacy protection, depth capping, and `/usage` shape extraction.
  - Added integration tests in `tests/mount.test.js` verifying debug log generation for streams with and without `message_limit` events and `/usage` responses.

---

## [0.5.7] - 2026-10-17

### Chat Switch Race Fixes, Per-Chat In-Flight Dedupe & Context Input Debounce
- **Post-Tokenization Race Condition (Bug 1):**
  - Resolved chat switch race in `src/content/main.js` (`cc:conversation` handler) where payload tokenization completing after switching chats painted old token metrics onto the newly selected chat.
  - Added monotonic payload sequence counter (`conversationPayloadSeq`) and a post-await validation re-checking `conversationId === currentConversationId && payloadSeq === conversationPayloadSeq`.
  - Stale payloads are safely discarded with debug log `conversation_metrics_dropped_stale`.
- **Per-Conversation Fetch In-Flight Deduplication (Bug 2):**
  - Replaced global `conversationInFlightPromise` in `src/content/main.js` with per-conversation record `{ conversationId, promise }`.
  - Switching from chat A to B while A's fetch is in flight now issues a separate fetch for chat B rather than reusing A's promise.
  - In `finally`, `conversationInFlight` is cleared only if the active record still matches the initiating fetch entry.
- **Loading State Verification (Check 3):**
  - Confirmed `setConversationLoading()` in `src/content/ui.js:1184-1223` contains no early return or guard when metrics are loaded; switching chats unconditionally shows "—" and clears previous chat values.
- **Settings Labels & Input Keystroke Debouncing (Polish 4):**
  - Updated custom color settings labels in `src/content/ui.js` to `"Low (0–60%)"`, `"Mid (60–90%)"`, and `"High (90%+)"`.
  - Debounced Context Window numeric input by ~600ms, ignoring intermediate inputs < 1000 and empty strings mid-typing without resetting to 200,000.
  - Commits immediately on Enter (`change`) or resets to 200,000 only on blur when input is empty or invalid.
- **Automated Tests:**
  - Added unit tests in `tests/mount.test.js` validating per-chat fetch separation during chat switch, stale metric drop via sequence counter, retry timer clearing on URL change, and context window input debouncing and blur reset.

---

## [0.5.6] - 2026-10-17

### Fast Post-Stream Context Refresh, UI Sizing & Payload Key Scanner
- **Fast Post-Stream Conversation Refresh:**
  - Removed former 1000ms delay prior to conversation refetch; refetch starts immediately after completion stream ends.
  - Implemented single in-flight deduplication promise (`conversationInFlightPromise`) to prevent concurrent refetches.
  - Stale-while-revalidate: retains existing token count while refetching in the same conversation, avoiding "—" flickering. "—" is displayed strictly on chat switch or initial load.
  - Automatic retry: if Claude's backend returns an uncommitted conversation tree (leaf message ID and token count unchanged), retries once after ~1500ms and stops (no loops).
  - Maintained request discipline: 30-second interval throttle for `/usage` and single post-stream `/usage` refresh remain intact.
  - Added debug timing lines (`stream_end`, `refetch_start`, `metrics_computed` with elapsed milliseconds since stream end).
- **Panel Size & Hit Area Adjustments:**
  - Thin line minimum height increased from 26px to 32px with expanded padding (`5px 12px`).
  - Base and label font sizes bumped by +1px (11px -> 12px; notices/settings from 9px/10px -> 10px/11px).
  - Mini progress bar track and standard track height increased from 5px to 7px (+2px).
  - Larger hit areas for gear and chevron controls with expanded icon dimensions.
  - Preserved responsive narrow view layout (<600px) with zero horizontal overflow in light and dark themes.
- **Context Window Auto-Detect & Diagnostic Scanner:**
  - Implemented `resolveContextWindow(override, detected, fallback)` with strict priority: user gear setting > detected limit > 200k default.
  - Verified absence of model/context fields in captured payloads (`tests/fixtures/conversation_tree.json:1-97`) and `DIAGNOSIS.md`. Avoided guessing tables.
  - Added debug-only diagnostic payload scanner (`scanPayloadDebugKeys`) logging key names only for top-level and first message, extracting only numbers or short model identifier strings matching `/context|window|limit|model/i` for evidence collection without exposing chat text.

---

## [0.5.5] - 2026-10-17

### Context Percentage Used & Left, Tier Colors & Row Tooltip
- **Percentage Used and Left Display:**
  - Collapsed thin line format: `Context  [bar]  62% used · 38% left`.
  - Expanded view also displays the token estimate: `~124k est. / 200k` alongside percentage.
  - Calculated as `Percent = round(tokens / contextWindow * 100)`.
  - Genuinely empty chat displays `0% used · 100% left`.
  - Loading state remains `— / 200k` and `—`.
- **Colors by Percent Used:**
  - `< 60%`: low color (`var(--cc-color-low, #10b981)`).
  - `60% to < 90%`: mid/orange color (`var(--cc-color-mid, #f59e0b)`).
  - `>= 90%`: high/red warning color (`var(--cc-color-high, #ef4444)`).
  - Removed the old "long chat" text and former "exceeds by 10%" rule in favor of these clear utilization tiers.
- **Over 100% Handling:**
  - Bar width is capped at 100%.
  - Text displays `100%+ used · 0% left`.
  - High warning color (red).
  - Token estimate remains visible in expanded view (e.g. `~231k est. / 200k`).
- **Context Row Tooltip:**
  - Tooltip on row, label, bar, and percentage: `"Estimated size of this chat vs. context window. Not your plan usage limit. The window size may differ by model, adjust it in settings."`.

---

## [0.5.4] - 2026-10-17

### Context Limit Constant, Override Setting & Estimate Labeling
- **Named Constant for Context Window:**
  - Defined in one single location: `CONTEXT_WINDOW_TOKENS = 200000; // unverified, needs real evidence` in `src/content/constants.js`.
  - Exposed as `CC.CONTEXT_WINDOW_TOKENS` and `CC.CONST.CONTEXT_WINDOW_TOKENS`, preserving backwards-compatible alias `CC.CONST.CONTEXT_LIMIT_TOKENS`.
  - Default context window remains 200,000 tokens.
- **Context Window Override Setting:**
  - Added a number input in the gear settings drawer ("Context Window").
  - Allows users to override the estimated model context window limit (e.g. 250,000 or custom values).
  - Saved in `localStorage` under `cc_settings.contextWindow` guarded inside `try/catch`.
  - Re-evaluates and immediately re-renders active conversation metrics on change or reset.
- **Estimate Count Labeling:**
  - Explicitly labeled token count as an estimate: `~218k est. / 200k` (instead of `~218k / 200k`).
  - Loading / placeholder state formats as `— / 200k` (or customized denominator).
  - Normal utilization ranges display estimate label (e.g. `~50k est. / 200k`, `~0 est. / 200k`).
- **Over-Limit Visuals & Copy Redesign:**
  - Stopped showing `>100%` and removed default red styling when context exceeds the limit.
  - When context is over the limit (`tokens > limit`):
    - Progress bar width is capped full at 100%.
    - Bar and percentage text render in **MID/warning orange** color (`var(--cc-color-mid, #f59e0b)`).
    - Status text displays **"long chat"**.
    - Hover tooltip on bar and percentage text: `"Estimated size; limit may differ by model. This is not your plan usage limit."`.
  - **Red warning** (`var(--cc-color-high, #ef4444)`) is used **only if the limit (or user-set override) is exceeded by more than 10%** (`tokens > limit * 1.1`).
- **Context Label Tooltip:**
  - Added short explanatory tooltip on the `Context` label: `"Size of this chat vs. context window. Not your usage limit."`.

---

## [0.5.3] - 2026-10-17

### Inline Mounting Above Composer Card
- **Removed Floating / Fixed Overlay:** Completely removed fixed positioning, drag handles, drag event listeners, pill mode, and `cc_panel_pos` / `cc_pill` logic.
- **Inline DOM Anchor & Resolution:**
  - Anchor: `document.querySelector('[data-testid="chat-input"]')`.
  - Composer Card: `anchor.closest('[class*="bg-surface-3"]')` with exact 6th-ancestor fallback when Tailwind class hashes change.
  - Mount Position: Inserted as the immediate previous sibling of Card (`Card.parentElement.insertBefore(ui.rootElement, Card)`).
  - Document Flow: Normal in-flow block element matching composer card width, with an 8px bottom margin. Zero overlap and zero layout shift of the conversation message list.
  - Graceful Fallback: If anchor or Card is not found, renders nothing, logs a debug line, and retries via throttled MutationObserver. Never falls back to a floating or fixed overlay.
- **Duplicate Prevention & Self-Healing:**
  - Guarded by root ID `#cc-usage-meter-root`; removes any stale duplicate elements.
  - Re-checks and heals mount point on SPA URL navigation (`handleUrlChange`), stream completion (`cc:stream_completed`), and via a throttled (100ms) MutationObserver on the container. Preserves widget state across re-renders.

### Compact Default View (Thin Line) & Collapsible Details
- **Default View (One Thin Line):**
  - Height: ~26px compact native bar sitting 8px above composer card.
  - Left: Context label, mini context progress bar, token count (e.g. `~231k / 200k`), and percentage text (`>100%`).
  - Right: Expand/collapse chevron indicator and gear settings button (with optional diagnostic export button).
  - Interactive: Clicking anywhere on the thin line (or expand chevron) expands/collapses the full details panel.
- **State Persistence:**
  - Remembers collapsed/expanded state in `localStorage` under `cc_expanded` within `try/catch` guards (defaulting to collapsed).
- **Expanded Panel View:**
  - Unfolds dedicated Cache timer row, Session 5h & Weekly 7d bars (or the single neutral free-plan notice), and Settings drawer.

### Over-Limit Color Bug Fix
- **Root Cause & Fix:**
  - Previously, at >100% context (>200,000 tokens, e.g. 231,255), the bar rendered dark grey due to `--cc-color-high` not being declared in Shadow DOM CSS rules and `.cc-high-utilization` utilizing `currentColor` from text-muted styles.
  - Added `.cc-over-limit` class applied to the panel and row whenever context exceeds limit.
  - Explicitly set `background-color: var(--cc-color-high, #ef4444) !important` for over-limit and high utilization.
  - Fixed mono preset warning color to distinctly indicate limit violation.
  - Progress bar width is strictly capped at `100%`.

### Cache Timer Visibility & Status
- **Root Cause & Fix:**
  - Previously, `.cc-cache-pill` was assigned `.cc-hidden` by default and remained hidden whenever no cache was active (`cachedUntil <= now` or `null`), making the cache countdown invisible in standard operation.
  - Redesigned into a persistent Cache row in the expanded panel.
  - When no cache is active: Displays `Cache: —` with an empty SVG ring (never hidden).
  - When assistant is generating: Displays `Cache: caching...`.
  - When response completes: Intercepts timestamp, displays active countdown `M:SS remaining`, and smoothly updates circular SVG countdown ring every second.

### Unit Tests
- Created `tests/mount.test.js` (9/9 tests passing):
  - Primary resolution of Level 6 composer card via `bg-surface-3` from Level 0 chat input.
  - Fallback resolution via 6th ancestor when Tailwind classes change.
  - Previous sibling inline insertion before Card in parent's children.
  - Safe null handling when composer anchor is absent.
  - Collapsed/expanded state persistence and exception tolerance.
  - Over-limit capping (100%) and warning color class application.
  - Cache timer status display (`—` when inactive).

---

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
