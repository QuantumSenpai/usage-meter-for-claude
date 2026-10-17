# Testing Checklist: Usage Meter for Claude (v0.5.7)

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

### 17. Explicitly Unverified Items (Requires Paid Account)
> [!NOTE]
> Per project constraints, testing cannot be performed on a live logged-in paid claude.ai session. The following remain unverified against live production accounts and rely on confirmed upstream shapes / synthetic fixtures:
1. **Live Paid Plan `/usage` Payload Shape:**
   - Exact key names and nesting on active paid accounts (e.g. `five_hour.utilization`, `five_hour.resets_at` vs alternative schemas).
   - Covered via tolerant parser in `normalize.js` and verified with fixtures `paid_plan.synthetic.json` and `paid_plan_fractions.synthetic.json`.
2. **Live SSE `message_limit` Stream Event:**
   - Real-time window updates emitted during streaming completions on paid plans.
   - Interception logic and normalization covered via `sse_message_limit.synthetic.json`.
3. **Real Claude Model Context Windows:**
   - Claude web responses do not supply a context window limit or model ID field in captured conversation payloads.

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
