# Testing Checklist: Usage Meter for Claude (v0.5.2)

## How to Reload & Test in Brave (Chromium MV3)

Before starting each test round, ensure the latest unpacked extension is loaded:
1. Open **`brave://extensions`** (or `chrome://extensions`).
2. Verify **Developer mode** toggle in the top-right corner is **ON**.
3. Under **Usage Meter for Claude**, click the **Reload** icon (circular arrow).
4. Switch to your active `https://claude.ai` tab.
5. Perform a hard refresh: press **`Cmd + Shift + R`** (macOS) or **`Ctrl + Shift + R`** (Windows/Linux).
6. Open browser DevTools (**`Cmd + Option + I`** / **`F12`**) -> **Console** to monitor diagnostics.

---

## Verification Test Matrix

### 1. Context Row Loading State vs Real Count (v0.5.2 Bug Fix)
- **Preconditions:** Extension loaded, in any existing chat or new chat.
- **Steps:**
  1. Open a new chat (`/new`) or switch to an existing chat from the sidebar.
  2. Observe the Context row immediately upon navigation before conversation data finishes fetching.
  3. Wait for the conversation payload to arrive.
  4. In a genuinely empty chat, observe the loaded state.
  5. In a chat with existing messages, observe the calculated count.
- **Expected Results:**
  - **Before data arrives (or on new chat before fetch):** Context row displays `— / 200k` and `—` (NOT `~0 / 200k` and NOT `0%`).
  - **Genuinely empty chat after load:** Displays `~0 / 200k` and `0%`.
  - **Multi-message chat after load:** Displays real number (e.g. `~14k / 200k`, `~231k / 200k`).
  - Never flashes `~0 / 200k` before real data arrives.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 2. Over-Limit (>200k Tokens) Handling (v0.5.2)
- **Preconditions:** Open a very long chat thread exceeding 200k context limit (e.g. ~231k tokens).
- **Steps:**
  1. Observe the Context row in the panel.
- **Expected Results:**
  - **Capped Bar:** Progress bar width is capped at 100% (never overflows container, no NaN).
  - **Real Value Display:** Displays the real compact number (e.g. `~231k / 200k`).
  - **Percentage:** Displays `>100%`.
  - **Warning Color:** Bar dynamically switches to high/warning utilization color (`#ef4444` / preset high).
  - No layout breaks or text clipping.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 3. Automatic Refresh & Lifecycle (v0.5.2)
- **Preconditions:** In an active chat.
- **Steps:**
  1. Send a prompt to Claude and wait for the assistant response to complete streaming.
  2. Switch to a different chat by clicking a conversation in the left sidebar.
  3. Switch back to the previous chat.
  4. Perform a hard page reload (`Cmd + Shift + R`).
- **Expected Results:**
  - **Completed Assistant Response:** Context tokens refresh automatically within ~1s after completion without manual reload.
  - **Switching Chats:** Instantly shows `—` loading state, then populates with the new chat's token count.
  - **Sidebar Navigation:** Click listener detects sidebar transitions and triggers immediate update.
  - **Hard Reload:** Resolves `orgId` and mounts panel with accurate tokens.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 4. FREE-Plan Account Behavior (One Neutral Compact Line)
- **Preconditions:** Logged into Claude on a Free tier account (where `/usage` returns all-null values).
- **Steps:**
  1. Inspect the Usage Meter panel.
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

### 4. PAID-Plan Account Behavior (When Limits are Present)
- **Preconditions:** Logged into Claude on a Pro/Team account with rolling utilization windows.
- **Steps:**
  1. Inspect the Session 5h and Weekly 7d rows.
- **Expected Results:**
  - Session 5h row shows utilization percentage (e.g. `42.5%`), reset countdown (`resets in 2h 14m`), and temporal marker.
  - Weekly 7d row shows utilization percentage and reset countdown.
  - Smooth 300ms bar transitions and color interpolation based on chosen theme palette.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 5. Settings Drawer & Color Presets
- **Preconditions:** Panel in expanded mode.
- **Steps:**
  1. Click the gear icon (`⚙`) in the header.
  2. Click different presets: **Default**, **Ocean**, **Sunset**, **Mono**, **High-contrast**.
  3. Adjust the background opacity slider and custom color pickers.
  4. If low contrast is set (e.g. black text on dark background), observe the amber contrast warning (`< 4.5:1`).
  5. Toggle row visibility checkboxes (Context / Session / Weekly).
  6. Click "Reset Position" and "Reset Defaults".
- **Expected Results:**
  - CSS variables update instantly inside the Shadow DOM.
  - Row toggles show/hide corresponding metrics.
  - "Reset Position" returns the panel to bottom-right.
  - Settings persist in `localStorage.cc_settings`.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 6. Org ID UUID Validation (Confirmed Fact 1)
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

### 7. Request Discipline & Throttling (Confirmed Fact 3)
- **Preconditions:** DevTools Network tab open (filter: `usage`).
- **Steps:**
  1. Navigate between chats rapidly, switch tabs, and trigger route changes.
- **Expected Results:**
  - Exactly one `/usage` request runs in-flight at a time (promise deduplication).
  - Background calls are throttled to a minimum 30 seconds interval.
  - No rapid bursts of 10–14 requests within seconds.
  - One immediate refresh is permitted right after a streaming message completes.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 8. New Chat Page (`/new`)
- **Preconditions:** Navigate to `https://claude.ai/new`.
- **Steps:**
  1. Observe the fixed panel.
- **Expected Results:**
  - Context (token) row is cleanly hidden on empty/new chat pages (only shows when inside a conversation).
  - Session and Weekly limits (or free plan notice) remain visible.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 9. SPA Route Navigation (Switching Chats in Sidebar)
- **Preconditions:** Multiple conversations in sidebar.
- **Steps:**
  1. Click Chat A $\rightarrow$ Chat B $\rightarrow$ Chat C.
- **Expected Results:**
  - Panel never flickers or re-attaches abruptly.
  - Context tokens update within ~500ms to reflect the active chat trunk.
  - Single panel instance remains mounted throughout.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 10. Streaming Message & Live Cache Countdown
- **Preconditions:** Active conversation.
- **Steps:**
  1. Send a short prompt.
  2. Observe the cache pill during and immediately after streaming.
- **Expected Results:**
  - While generating, pill displays green "caching...".
  - When generation completes, pill displays `cached 4:59` with circular SVG shrinking progress ring.
  - `/usage` refreshes ~1 second after stream completion.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 11. Theme Switching (Light vs. Dark Mode)
- **Preconditions:** Active conversation.
- **Steps:**
  1. Switch Claude user profile theme: Dark $\rightarrow$ Light $\rightarrow$ Dark.
- **Expected Results:**
  - Panel immediately updates background, border, text color, and progress bar hues to match.
  - High contrast (>= 4.5:1) maintained.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 12. Brave Shields (UP vs. DOWN)
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

### 13. Self-Healing Verification
- **Preconditions:** DevTools Elements tab.
- **Steps:**
  1. Manually select `#cc-usage-meter-root` in the Elements panel and hit Delete.
- **Expected Results:**
  - Within ~1 second, the self-healing MutationObserver and interval detector re-mount the panel seamlessly.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 14. Debug Log Export
- **Preconditions:** DevTools Console.
- **Steps:**
  1. Run: `window.__CC_COPY_DEBUG_LOG()`
- **Expected Results:**
  - Redacted JSON log copied to clipboard.
  - Verifiable that all UUIDs, emails, tokens, and chat messages are replaced with `[REDACTED_...]` placeholders.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 15. Explicitly Unverified Items (Requires Paid Account)
> [!NOTE]
> Per project constraints, testing cannot be performed on a live logged-in paid claude.ai session. The following remain unverified against live production accounts and rely on confirmed upstream shapes / synthetic fixtures:
1. **Live Paid Plan `/usage` Payload Shape:**
   - Exact key names and nesting on active paid accounts (e.g. `five_hour.utilization`, `five_hour.resets_at` vs alternative schemas).
   - Covered via tolerant parser in `normalize.js` and verified with fixtures `paid_plan.synthetic.json` and `paid_plan_fractions.synthetic.json`.
2. **Live SSE `message_limit` Stream Event:**
   - Real-time window updates emitted during streaming completions on paid plans.
   - Interception logic and normalization covered via `sse_message_limit.synthetic.json`.
