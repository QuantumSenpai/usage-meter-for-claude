# DIAGNOSIS: Usage Meter for Claude (claude-counter)

## 1. Architecture Map

### 1.1 Entry Points & Manifest Layout
- **Manifest (`manifest.json`):** Manifest V3.
  - Matches: `https://claude.ai/*`
  - CSS: `src/styles.css`
  - Content Scripts: `src/content/constants.js`, `src/content/bridge-client.js`, `src/vendor/o200k_base.js`, `src/content/tokens.js`, `src/content/ui.js`, `src/content/main.js`
  - Execution World: Not specified in manifest -> defaults to **`ISOLATED` world**.
  - Run Timing: Not specified -> defaults to **`document_idle`**.
  - `web_accessible_resources`: Exposes `src/injected/bridge.js` to `https://claude.ai/*`.
- **Userscript (`userscript/claude-counter.user.js`):**
  - Standalone bundled script matching `https://claude.ai/*` at `@run-at document-start` with `@grant none` (runs directly in page context/MAIN world).

### 1.2 Execution Worlds & Interception Flow
```
[claude.ai Page Context (MAIN World)]
   │
   ├─► window.fetch wrapped by bridge.js (or userscript wrapper)
   │     ├─ Intercepts POST /completion, /retry_completion -> posts "cc:generation_start"
   │     ├─ Intercepts text/event-stream -> parses SSE lines for {"type": "message_limit"} -> posts "cc:message_limit"
   │     └─ Intercepts GET /chat_conversations/... (if matching "tree=") -> posts "cc:conversation"
   │
   ├─► history.pushState / history.replaceState wrapped by bridge.js -> dispatches "cc:urlchange"
   │
   ▼ window.postMessage({ cc: "ClaudeCounter", type: ... })
   │
[Extension Content Script (ISOLATED World)]
   │
   ├─► bridge-client.js: Listens to window.onmessage, routes requests and events
   ├─► main.js:
   │     ├─ Reads document.cookie ("lastActiveOrg")
   │     ├─ Manages usage polling and conversation fetching
   │     ├─ URL change listener ("cc:urlchange" + "popstate")
   │     └─ MutationObserver watching for DOM node detachments
   ├─► tokens.js: Token counting using vendored o200k_base tokenizer + sha256 message caching
   └─► ui.js: Renders header widget and usage row directly into page DOM
```

### 1.3 DOM Selectors Used
| Selector | Location | Purpose | Failure Mode |
|---|---|---|---|
| `[data-testid="chat-menu-trigger"]` | `constants.js` | Top header anchor to locate chat title/project menu | If Claude changes or removes this testid, header never mounts |
| `.chat-project-wrapper` | `constants.js`, `ui.js` | Container around chat menu trigger | Fragile class selector. If removed, falls back to `parentElement` |
| `[data-testid="model-selector-dropdown"]` | `constants.js`, `ui.js` | Primary anchor for bottom chat input usage bars | If renamed or relocated, usage bars never mount |
| `[data-testid="chat-input-grid-container"]` | `ui.js` | Parent grid of chat input | If container layout changes, toolbar row search fails |
| `[data-testid="chat-input-grid-area"]` | `ui.js` | Parent grid area of chat input | Layout boundary |
| Heuristic in `findToolbarRow` | `ui.js` | Walks up DOM searching for flex row with >1 buttons | Extremely fragile: breaks on any button reorder, flex wrapper change, or mobile responsive view |
| `button[aria-label="Previous"]`, `button[aria-label="Next"]` | `main.js` | Branch navigation listener | Breaks if aria-labels change |
| `document.documentElement[data-mode]` | `ui.js` | Dark/light theme observer | Fails if theme is set via class (`.dark`), CSS variables, or system preference |

### 1.4 Endpoints and JSON Fields Assumed
1. **Usage Endpoint:** `GET https://claude.ai/api/organizations/${orgId}/usage`
   - Fields:
     - `five_hour.utilization` (number, 0–100)
     - `five_hour.resets_at` (ISO timestamp string)
     - `seven_day.utilization` (number, 0–100)
     - `seven_day.resets_at` (ISO timestamp string)
2. **Conversation Endpoint:** `GET https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`
   - Interception condition: `url.includes('/chat_conversations/') && url.includes('tree=')`
   - Fields:
     - `chat_messages` (array of message objects)
     - `current_leaf_message_uuid` (string)
     - Message object: `uuid`, `parent_message_uuid`, `sender`, `created_at`, `content` (array of blocks: `type: "text" | "tool_use" | "tool_result" | ...`), `attachments[].extracted_content`
3. **SSE Stream Interception:**
   - Content-type: `text/event-stream`
   - SSE data lines: `data: {"type": "message_limit", "message_limit": { "windows": { "5h": { "utilization": float, "resets_at": unix_sec }, "7d": { "utilization": float, "resets_at": unix_sec } } } }`
4. **Cookie:** `document.cookie` containing `lastActiveOrg=<uuid>`

---

## 2. Ranked Root Causes: What Broke and Why

### Rank 0: Context Row Showing "~0 / 200k" Bug (Resolved in v0.5.2)
- **Severity: Critical (Direct Cause of Incorrect Token Display)**
- **Live Evidence (from Brave debug log):**
  - Sequence: `[fetch_conversation_start] -> [conversation_metrics_computed {tokens: 0}] -> [conversation_metrics_computed {tokens: 231255}]`.
  - The first `tokens: 0` event was computed *before* conversation data arrived.
  - Token counting logic itself works accurately (`231255` tokens computed on a multi-message conversation).
  - Confirmed real conversation shape:
    - `chat_messages[].text` is `""` (empty string).
    - Real text resides in `chat_messages[].content[].text`.
    - Attachments reside in `chat_messages[].attachments[].extracted_content`.
    - Root message parent ID is `00000000-0000-4000-8000-000000000000`.
    - Active leaf is `conversation.current_leaf_message_uuid`.
- **Root Cause Breakdown (with File & Line Citations):**
  1. **Indiscriminate Shallow Interception (`src/injected/bridge.js:137-142`):**
     - `bridge.js` intercepted any URL matching `url.includes('/chat_conversations/')` without requiring HTTP method `GET` and without verifying whether the request was an actual message tree request (`tree=true`).
     - On page load / chat open, Claude makes preliminary shallow metadata calls or settings updates with `chat_messages: []` or missing `chat_messages`.
     - `bridge.js` cloned and forwarded this shallow response to `cc:conversation`.
  2. **Empty Message Array Yields 0 Tokens (`src/content/tokens.js:51-52`):**
     - `buildTrunk(conversation)` sees `messages.length === 0` and returns `[]`.
     - `computeConversationMetrics` calculates `totalTokens = 0`.
  3. **Direct Emission & Overwrite (`src/content/main.js:301-303`):**
     - `CC.bridge.on('cc:conversation')` received this shallow response, logged `conversation_metrics_computed { tokens: 0 }`, and called `ui.setConversationMetrics({ totalTokens: 0 })`.
     - Any subsequent shallow PATCH/GET also actively overwrote real token counts back to 0.
  4. **False Zero Rendered as Real Number & Missing Loading State (`src/content/ui.js:583, 718-719, 1182-1206`):**
     - Initial state and HTML template hardcoded `~0 / 200k` and `0%` instead of a loading state (`— / 200k`, `—`).
     - `setConversationMetrics` defaulted `tokens = typeof totalTokens === 'number' ? totalTokens : 0` and rendered `~0 / 200k` and `0%` whenever called before data arrived.
  5. **Panel Mount Race Condition (`src/content/ui.js:847, 1182-1206`):**
     - If `setConversationMetrics` was called before `ui.initialize()` created DOM elements, `this.dom.ctxMain` was undefined, so visual elements were not updated, and `initialize()` never rendered cached state into the new DOM.
  6. **Missing Refresh Triggers (`src/content/main.js:251-259, 266-273`):**
     - `refreshConversation()` was never invoked on `cc:stream_completed` (when assistant finished streaming) or when `orgId` was resolved by `cc:detected_org`.
- **Resolution Implemented:**
  - `src/injected/bridge.js`: Restricts conversation interception to `method === 'GET'`, requires `Array.isArray(data.chat_messages)`, and ignores empty messages unless `tree=` or leaf UUID is present.
  - `src/content/tokens.js`: Distinguishes loading (`isLoaded: false`, `totalTokens: null`) from real empty chat (`isLoaded: true`, `totalTokens: 0`). Added `formatTokens` and `formatContextUtilization`.
  - `src/content/ui.js`: Displays `"— / 200k"` and `"—"` until loaded; caps over-limit counts (>200k) at 100% width, displays `~231k / 200k` and `>100%`, and switches bar to warning color. Added `renderAll()` to `initialize()`.
  - `src/content/main.js`: Added loading state resets on chat navigation, shallow payload guard, and refreshed conversation on stream completion.

### Rank 1: DOM Anchors & Selectors Changed in Claude's Redesigned UI
- **Severity: High (Direct Cause of "Shows Nothing" in v0.4 era)**
- **Mechanism:**
  - `attachUsageLine()` relied on finding in-page containers (`[data-testid="model-selector-dropdown"]`, toolbar row).
  - Resolved in v0.5.1 by transitioning to an isolated, fixed, draggable ShadowRoot panel.

### Rank 2: MV3 Timing & Script Injection in Isolated World
- **Severity: High (Causes Intermittent / Incomplete Data)**
- **Mechanism:**
  - In `manifest.json`, content scripts default to `run_at: "document_idle"` and `world: "ISOLATED"`.
  - `bridge.js` is injected dynamically into the page via `<script src="chrome-extension://...">` only *after* the content script wakes up at `document_idle`.
  - By that time:
    1. The page's initial bundle has already loaded and executed.
    2. Any fetch calls made during initial page render have completed unintercepted.
    3. Next.js / React Router has already bound `history.pushState`. The delayed patch of `history.pushState` in `bridge.js` is ignored by Next.js's internal router references.
  - **Modern MV3 Fix:** Manifest V3 supports `"world": "MAIN"` and `"run_at": "document_start"` in `manifest.json`. Injecting the interception script natively at `document_start` guarantees wrapping `window.fetch` and `history.pushState` before any application code executes.

### Rank 3: SPA Route Changes & MutationObserver Lockup
- **Severity: High (Causes Intermittent Visibility on Navigation)**
- **Mechanism:**
  - Claude is a single-page application (SPA). Navigating between `/new` (new chat) and `/chat/<id>` (existing chat) or switching chats changes the URL and re-renders the DOM tree.
  - If `pushState` is missed due to late injection, `cc:urlchange` never fires on route changes.
  - The MutationObserver in `_observeDom()` triggers on every DOM mutation without debouncing. When `usageLine` is detached during React DOM reconciliation, it calls `waitForElement` with a 60s timeout while setting `usageReattachPending = true`. If the element is not immediately ready, re-attachment freezes.
  - There is zero fallback rendering: if the designated anchor is absent, the extension renders nothing instead of showing a floating fallback panel.

### Rank 4: Conversation Interception Condition (`tree=`)
- **Severity: Medium**
- **Mechanism:**
  - `bridge.js` only captures conversation responses if `url.includes('/chat_conversations/') && url.includes('tree=')`.
  - If Anthropic updated the web client to omit `tree=` or use GraphQL/different query parameters, conversation responses pass through unhandled.
  - When switching chats, if `refreshConversation()` fails or is blocked, token counts remain blank or stale.

### Rank 5: Missing or HttpOnly `lastActiveOrg` Cookie / Endpoint Errors
- **Severity: Medium**
- **Mechanism:**
  - `getOrgIdFromCookie()` reads `document.cookie`. If the cookie is missing, partitioned, or not yet set, `refreshUsage()` exits silently.
  - If `/usage` returns 401, 403, or 429, the error is swallowed and the widget remains hidden (`cc-hidden`).

### Rank 6: Theme Detection Fragility
- **Severity: Low**
- **Mechanism:**
  - Checking only `document.documentElement.dataset.mode` fails if Claude toggles themes via class (`dark`), `prefers-color-scheme`, or CSS variables.

---

## 3. /debug Evidence Verification & Capture Instructions

> **Notice:** The `/debug` directory was not present in this workspace at the start of analysis. Per instructions, sub-tasks requiring specific live payload verification are stopped until captures are provided. Below are the exact capture instructions needed from DevTools.

### Evidence Checklist & Capture Instructions for User

Please capture the following and save each into the `/debug/` directory (ensure `/debug/` remains in `.gitignore`; never commit private data):

1. **Usage Endpoint Sample (`/debug/usage_response.json`):**
   - **DevTools Tab:** `Network` -> Filter: `usage`
   - **Action:** Open Claude, find request to `https://claude.ai/api/organizations/<org_id>/usage`.
   - **Save:** Copy response JSON.
   - **Redact:** Replace org IDs, account emails, or personal identifiers with `REDACTED`.

2. **SSE Message Limit Sample (`/debug/sse_message_limit.txt`):**
   - **DevTools Tab:** `Network` -> Filter: `completion` or EventStream (check `Fetch/XHR`).
   - **Action:** Send a short prompt in any chat. Click the streaming completion request -> `EventStream` sub-tab.
   - **Save:** Look for the event containing `message_limit` or usage limits. Copy the raw event text.

3. **Conversation Payload Sample (`/debug/conversation_response.json`):**
   - **DevTools Tab:** `Network` -> Filter: `chat_conversations`
   - **Action:** Click an existing chat in the sidebar. Note the exact URL (does it contain `tree=`, `rendering_mode=`, etc.?) and the response JSON structure.
   - **Redact:** Remove actual chat message text and replace with generic placeholders.

4. **DOM OuterHTML of Input Toolbar (`/debug/chat_input_dom.html`):**
   - **DevTools Tab:** `Elements`
   - **Action:** Inspect the model selector button (e.g. "Claude 3.7 Sonnet" or similar dropdown) and the prompt input box. Right-click the enclosing container (the whole prompt box with the buttons row) -> `Copy` -> `Copy outerHTML`.

5. **DOM OuterHTML of Top Header (`/debug/header_dom.html`):**
   - **DevTools Tab:** `Elements`
   - **Action:** Inspect the top header area where the chat title and chat menu dropdown appear. Right-click the header bar -> `Copy` -> `Copy outerHTML`.

6. **Console Errors (`/debug/console_errors.log`):**
   - **DevTools Tab:** `Console`
   - **Action:** Filter by warnings/errors or search for `ClaudeCounter` / `cc-`. Copy any relevant error stack traces.

---

## 4. What Remains Unconfirmed & Safe Engineering Assumptions

1. **Unconfirmed:** Whether the `/api/organizations/{orgId}/usage` JSON keys (`five_hour`, `seven_day`, `utilization`, `resets_at`) have changed names or nesting.
   - **Assumption / Action:** The parser must support both legacy keys (`five_hour`, `seven_day`) and common variations (e.g. `5h`, `7d`, `stats`, `message_limit.windows`), with fallback checks. If fields are missing or request fails (401/403/429), display an informative "unavailable" state instead of disappearing.
2. **Unconfirmed:** Exact new DOM hierarchy around the model selector.
   - **Assumption / Action:**
     - Centralize selectors with resilient fallbacks (testids, aria-labels, role selectors, form anchors).
     - Add a **floating fallback panel** (docked bottom-right) if no DOM anchor is found within ~3 seconds, guaranteeing the meter is NEVER invisible.
     - Debounce MutationObserver to prevent thrashing and remove single-shot boolean lockouts.
3. **Unconfirmed:** Whether Claude CSP restricts `<script>` injection.
   - **Assumption / Action:** In MV3, move the MAIN-world bridge interception directly into `manifest.json` under `"content_scripts"` with `"world": "MAIN"` and `"run_at": "document_start"`. This completely eliminates dynamic `<script>` tag injection and executes prior to page frameworks.
