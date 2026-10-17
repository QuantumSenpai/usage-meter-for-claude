# Testing Checklist: Usage Meter for Claude (v0.5.4)

## How to Reload & Test in Brave (Chromium MV3)

Before starting each test round, ensure the latest unpacked extension is loaded:
1. Open **`brave://extensions`** (or `chrome://extensions`).
2. Verify **Developer mode** toggle in the top-right corner is **ON**.
3. Under **Usage Meter for Claude**, click the **Reload** icon (circular arrow).
4. Switch to your active `https://claude.ai` tab.
5. Perform a hard refresh: press **`Cmd + Shift + R`** (macOS) or **`Ctrl + Shift + R`** (Windows/Linux).
6. Open browser DevTools (**`Cmd + Option + I`** / **`F12`**) -> **Console** to monitor diagnostics.

---

## Brave Manual Verification Matrix (v0.5.4)

### 0. Context Window Override, Estimate Label & Over-Limit States (v0.5.4)
- **Preconditions:** Extension reloaded, open any chat on `https://claude.ai`.
- **Steps:**
  1. **Estimate Label:** Observe token count in the summary line.
     - *Expected:* Displays with estimate format, e.g. `~218k est. / 200k` or `~50k est. / 200k` (never plain `~218k / 200k`).
  2. **Context Label Tooltip:** Hover the cursor over the "Context" label.
     - *Expected:* Displays tooltip: `"Size of this chat vs. context window. Not your usage limit."`.
  3. **Context Window Override Setting:**
     - Click the gear icon to open the Settings Drawer.
     - Locate the **"Context Window"** number input (defaults to `200000`).
     - Change value to `250000`.
     - *Expected:* Immediately re-renders the context meter with `/ 250k` denominator. Saved to `localStorage.cc_settings` within `try/catch`.
     - Click "Reset Defaults".
     - *Expected:* Reverts to `200000` (denominator `/ 200k`).
  4. **Over-Limit Behavior (<= 10% Excess):**
     - In a chat with ~205k-219k tokens (or lower the override input so tokens are 1-10% above limit):
     - *Expected:* Text shows **"long chat"** (never `>100%`).
     - Progress bar is full (100% width) in **MID/warning orange** color (`#f59e0b`), NOT red.
     - Hovering over "long chat" or the bar shows tooltip: `"Estimated size; limit may differ by model. This is not your plan usage limit."`.
  5. **Over-Limit Behavior (> 10% Excess):**
     - In a chat exceeding the limit by >10% (e.g. 231k tokens with 200k default, or set override below 90% of chat tokens):
     - *Expected:* Text shows **"long chat"**.
     - Progress bar is full in **RED warning** color (`#ef4444`).
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
  - **Collapsed View (Default):** Displays as a single thin line (~26px high) containing: `Context` label, mini progress bar, token count (e.g. `~231k / 200k`), percent (`>100%`), gear icon, and chevron arrow.
  - **Click to Expand:** Smoothly unfolds the details area showing Cache status, Session/Weekly usage (or single free-plan notice), and Settings drawer.
  - **State Persistence:** Remembers collapsed/expanded state across page reloads via `localStorage.cc_expanded`.
  - **Gear Icon:** Clicking the gear icon opens color settings (and automatically expands panel if currently collapsed) without collapsing.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 3. Composer Re-Render Survival (Chat Switch & New Chat)
- **Preconditions:** In an active chat with the panel mounted.
- **Steps:**
  1. Click another chat in the left sidebar.
  2. Click the Claude logo or "Start new chat" button (`/new`).
  3. Navigate back to an existing chat.
  4. Send a message and wait for streaming completion.
- **Expected Results:**
  - When Claude re-renders or replaces the composer card, the panel host re-mounts immediately above the new card.
  - Exactly one `#cc-usage-meter-root` exists in DOM (no duplicate hosts).
  - Context tokens reset to `— / 200k` while loading, then display the new conversation's count.
  - Panel preserves current expanded/collapsed state and color settings.
- **Result:**
  - [ ] Pass  [ ] Fail
  - *Notes:* _____________________________

---

### 4. Over-Limit Color Bug Fix (>100% Context)
- **Preconditions:** Open a long conversation thread exceeding 200k tokens (e.g. ~231k / 200k).
- **Steps:**
  1. Observe the progress bar and percentage display in the thin line (and expanded details).
- **Expected Results:**
  - Progress bar is colored with the **warning/high color** (red `#ef4444` on default preset; NOT grey).
  - Percentage text displays `>100%` in warning color.
  - Progress bar width is strictly capped at `100%` (fills the mini track completely without visual overflow).
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

### 6. Light and Dark Theme & Narrow Window
- **Preconditions:** In an active chat.
- **Steps:**
  1. Switch Claude between Light and Dark mode (via Claude user menu -> Theme or OS dark mode).
  2. Resize browser window to narrow width (<600px).
- **Expected Results:**
  - **Dark Mode:** Dark background (`rgba(30, 29, 28, 0.95)`), light text, subtle dark-theme border.
  - **Light Mode:** Light background (`rgba(255, 255, 255, 0.95)`), dark text, subtle light-theme border.
  - **Narrow Window:** Panel shrinks proportionally with the composer card; no horizontal overflow or clipped text.
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

## Regression Verification Matrix (v0.5.2 & earlier)

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
