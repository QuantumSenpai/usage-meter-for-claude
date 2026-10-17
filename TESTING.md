# Testing Checklist: Usage Meter for Claude (v0.5.0)

## How to Reload & Test in Brave (Chromium MV3)

Before starting each test round, ensure the latest unpacked extension is loaded:
1. Open **`brave://extensions`** (or `chrome://extensions`).
2. Verify **Developer mode** toggle in the top-right corner is **ON**.
3. Under **Usage Meter for Claude**, click the **Reload** icon (circular arrow).
4. Switch to your active `https://claude.ai` tab.
5. Perform a hard refresh: press **`Cmd + Shift + R`** (macOS) or **`Ctrl + Shift + R`** (Windows/Linux).
6. Open browser DevTools (**`Cmd + Option + I`** / **`F12`**) -> **Console** to monitor any warnings or logs.

---

## Verification Test Matrix

### 1. Initial Page Load (Existing Chat)
- **Preconditions:** Navigate directly to an existing conversation URL (`https://claude.ai/chat/<id>`).
- **Steps:**
  1. Hard refresh the tab.
  2. Wait 1–3 seconds for initial render.
- **Expected Results:**
  - Usage meter card appears directly above or below the chat input controls.
  - Context shows approximate token count (e.g. `~14,200 / 200k`) with percentage.
  - Session 5h bar shows utilization percentage and reset countdown (e.g. `resets in 3h 12m`).
  - Weekly 7d bar shows utilization percentage and reset countdown (e.g. `resets in 5d 2h`).
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 2. New Chat Page (`/new`)
- **Preconditions:** Navigate to `https://claude.ai/new` or click "Start new chat".
- **Steps:**
  1. Inspect the input box area on the empty chat screen.
- **Expected Results:**
  - Usage meter mounts inline near the prompt box (or floats cleanly in the bottom-right if input controls are deferred).
  - Context displays `~0 / 200k` (0.0%).
  - Session and Weekly usage bars remain populated with current organization limits.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 3. SPA Route Navigation (Switching Chats)
- **Preconditions:** Have multiple chats listed in the sidebar.
- **Steps:**
  1. Click from Chat A to Chat B in the sidebar (do not refresh the page).
  2. Click from Chat B to "Start new chat" (`/new`).
  3. Click from `/new` back to Chat A.
- **Expected Results:**
  - The URL changes dynamically without full page reload.
  - Token count recomputes to match the selected conversation within ~500ms.
  - The widget never duplicates or stacks multiple instances.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 4. Streaming Message & Live Cache Countdown
- **Preconditions:** Inside any active chat.
- **Steps:**
  1. Send a short prompt (e.g. "Count from 1 to 5").
  2. Observe the meter while Claude streams the answer.
  3. Observe the meter immediately after the answer finishes streaming.
- **Expected Results:**
  - When generation starts, the green "caching..." pill activates.
  - When generation completes, the cache pill displays the countdown (e.g. `cached 4:59`) with the shrinking SVG progress ring.
  - Token count updates to include the new assistant response.
  - Utilization percentage refreshes automatically within ~1–2s of stream completion.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 5. Long Conversation Performance
- **Preconditions:** Open a long conversation with 20+ messages or large code blocks.
- **Steps:**
  1. Open the conversation.
  2. Type in the input textarea and scroll the chat view.
- **Expected Results:**
  - Main thread remains smooth; no frame drops or typing lag (tokens tokenize with asynchronous micro-task yielding).
  - Accurate token count displayed with `~` prefix.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 6. Theme Switching (Light Mode vs. Dark Mode)
- **Preconditions:** Active conversation open.
- **Steps:**
  1. Open Claude user profile menu -> change theme from **Dark** to **Light**.
  2. Switch back from **Light** to **Dark** (or test System match).
- **Expected Results:**
  - The Shadow DOM card immediately updates its background, border, text colors, and marker styling to match Claude's active theme.
  - Text contrast remains sharp (>= 4.5:1) in both modes.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 7. Collapsed vs. Expanded Mode
- **Preconditions:** Meter is mounted.
- **Steps:**
  1. Click the chevron toggle button on the right side of the card header.
  2. Observe the collapsed state.
  3. Refresh the page to verify state persistence.
  4. Click the toggle again to re-expand.
- **Expected Results:**
  - In collapsed mode, progress rows collapse into a single compact line summary (e.g. `~12k ctx · 35% 5h · 12% 7d`).
  - State is saved in `localStorage.cc_collapsed` and persists across reloads.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 8. Brave Shields (Shields UP vs. Shields DOWN)
- **Preconditions:** Active conversation tab in Brave.
- **Steps:**
  1. Click the Brave Shields lion icon in the address bar with Shields **UP** (standard blocking).
  2. Test widget appearance and `/usage` requests.
  3. Toggle Shields **DOWN** and reload.
- **Expected Results:**
  - The extension operates in both states since requests are directed solely to `claude.ai` with valid session credentials.
  - Cookies and session tokens are never blocked or logged.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 9. Fallback Floating Mode Resilience
- **Preconditions:** Test layout in non-standard or experimental screens (e.g. project knowledge screen or artifact popout).
- **Steps:**
  1. If Claude UI renders a view without the standard chat input toolbar for >3 seconds:
- **Expected Results:**
  - The meter mounts smoothly into a fixed-position floating panel docked at the bottom-right.
  - As soon as a chat input box is opened, the meter transitions seamlessly back to an inline layout.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 10. Debug Logging Mode & Log Export
- **Preconditions:** DevTools Console open.
- **Steps:**
  1. Run in Console: `localStorage.setItem('cc_debug', 'true')` and reload tab.
  2. In Console, run: `window.__CC_COPY_DEBUG_LOG()`
- **Expected Results:**
  - Console prints formatted debug entries (matched selectors, parsed endpoints, timings).
  - Sanitized JSON log is copied to your clipboard.
  - All cookies, org UUIDs, emails, and user chat texts are replaced with `[REDACTED_...]` placeholders.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________
