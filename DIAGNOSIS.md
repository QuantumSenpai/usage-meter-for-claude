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

### Rank 1: DOM Anchors & Selectors Changed in Claude's Redesigned UI
- **Severity: High (Direct Cause of "Shows Nothing")**
- **Mechanism:**
  - `attachUsageLine()` relies on finding `[data-testid="model-selector-dropdown"]` and then searching upward for a flex row container with >1 buttons (`findToolbarRow`).
  - In recent Claude UI updates, the prompt input area and toolbar were restructured (e.g. style changes, icon buttons wrapped differently, model selector moved to popovers or header, different testids).
  - When `findToolbarRow` or `modelSelector` returns null, `attachUsageLine` silently exits without mounting anything.
  - Furthermore, `main.js` and `ui.js` use `CC.waitForElement(..., 60000)` with a boolean lock `usageReattachPending = true` and `headerReattachPending = true`. If the selector never appears, the lock remains true for up to 60 seconds, suppressing any further attachment attempts.
  - The top header selector `.chat-project-wrapper` is a plain CSS class that has likely been renamed or removed by Tailwind/styled-jsx updates.

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
