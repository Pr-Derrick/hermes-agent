// ============================================================
//  Alter AI — Background Service Worker
//  职责：检测"任务瘫痪"信号，向 Hermes 发送隐式 payload
// ============================================================

import { HERMES_WS_URL, FREEZE_THRESHOLD_MS, INACTIVITY_THRESHOLD_MS } from '../config.js';

// ── 状态机 ────────────────────────────────────────────────────
const state = {
  currentTabId: null,
  currentUrl: null,
  tabFocusSince: null,   // Timestamp when current tab gained focus
  lastInputAt: null,     // Timestamp of last keyboard/mouse input
  ws: null,              // WebSocket connection to Hermes
  wsReady: false,
  sessionId: null,       // Session ID assigned by Hermes on handshake
};

// ── WebSocket Management ──────────────────────────────────────

function connectToHermes() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) return;

  state.ws = new WebSocket(HERMES_WS_URL);

  state.ws.onopen = () => {
    console.log('[AlterAI] WebSocket connected to Hermes');
    state.wsReady = true;
    // Register as a Chrome Extension client
    sendToHermes({ type: 'handshake', client: 'chrome_extension' });
    flushOfflineQueue();
    // Resume active monitoring if we had previously degraded
    if (listenerModeActive) {
      exitListenerMode();
    }
  };

  state.ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (_) {
      return;
    }
    if (msg.type === 'session_ack') {
      state.sessionId = msg.session_id;
    }
    // Forward all Hermes messages to the Side Panel
    chrome.runtime.sendMessage({ target: 'sidepanel', payload: msg }).catch(() => {});
  };

  state.ws.onclose = () => {
    state.wsReady = false;
    console.warn('[AlterAI] WS closed, retry in 5 s');
    setTimeout(connectToHermes, 5000);
  };

  state.ws.onerror = () => {
    // Graceful degradation: switch to Listener Mode (observe only, no interruptions)
    state.wsReady = false;
    enterListenerMode('ws_error');
  };
}

function sendToHermes(payload) {
  if (!state.wsReady || !state.ws) {
    // Graceful degradation: queue locally, flush on reconnect
    queueOfflineEvent(payload);
    return;
  }
  state.ws.send(JSON.stringify({
    session_id: state.sessionId,
    ...payload,
  }));
}

// ── Offline Event Queue (fallback when WebSocket is unavailable) ──

const offlineQueue = [];

function queueOfflineEvent(payload) {
  offlineQueue.push({ ts: Date.now(), payload });
  // Cap at 20 entries to avoid unbounded growth
  if (offlineQueue.length > 20) offlineQueue.shift();
}

function flushOfflineQueue() {
  while (offlineQueue.length > 0 && state.wsReady) {
    const { payload } = offlineQueue.shift();
    sendToHermes(payload);
  }
}

// ── Listener Mode (graceful degradation) ─────────────────────
//
// Entered when the WebSocket is unavailable (error, timeout, server down).
// In Listener Mode:
//   - All proactive alarms are suspended (no interruptions to the user)
//   - Behavioral data is still recorded to chrome.storage.local
//   - Reconnection is retried every 30 s
//   - On successful reconnect, Listener Mode exits automatically

let listenerModeActive = false;
let listenerRetryInterval = null;

function enterListenerMode(reason) {
  if (listenerModeActive) return;
  listenerModeActive = true;
  console.warn(`[AlterAI] Entering Listener Mode (reason: ${reason})`);

  chrome.alarms.clear('taskFreezeCheck');
  chrome.storage.local.set({ listenerMode: true, listenerReason: reason });

  // Retry reconnect every 30 s
  listenerRetryInterval = setInterval(() => {
    if (!state.wsReady) {
      connectToHermes();
    } else {
      exitListenerMode();
    }
  }, 30000);
}

function exitListenerMode() {
  listenerModeActive = false;
  if (listenerRetryInterval) {
    clearInterval(listenerRetryInterval);
    listenerRetryInterval = null;
  }
  chrome.storage.local.set({ listenerMode: false });
  scheduleFreezeScan();
  console.log('[AlterAI] Exited Listener Mode, resuming active monitoring');
}

// ── Task-Freeze Detection (core logic) ───────────────────────

function scheduleFreezeScan() {
  if (listenerModeActive) return;
  chrome.alarms.create('taskFreezeCheck', { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'taskFreezeCheck') return;

  const now = Date.now();
  const timeOnTab = state.tabFocusSince ? now - state.tabFocusSince : 0;
  const timeSinceInput = state.lastInputAt ? now - state.lastInputAt : timeOnTab;

  // Core detection: on same tab longer than threshold AND no input for threshold
  if (timeOnTab >= FREEZE_THRESHOLD_MS && timeSinceInput >= INACTIVITY_THRESHOLD_MS) {
    triggerFreezeIntervention({
      url: state.currentUrl,
      timeOnTabMs: timeOnTab,
      inactivityMs: timeSinceInput,
    });
  }
});

function triggerFreezeIntervention(context) {
  // 1. Open the Side Panel so the user sees the intervention
  if (state.currentTabId !== null) {
    chrome.sidePanel.open({ tabId: state.currentTabId }).catch(() => {});
  }

  // 2. Send implicit behavior signal to Hermes
  sendToHermes({
    type: 'behavior_signal',
    signal: 'task_freeze',
    context: {
      url: context.url,
      page_title: context.pageTitle || '',
      time_on_tab_seconds: Math.round(context.timeOnTabMs / 1000),
      inactivity_seconds: Math.round(context.inactivityMs / 1000),
      timestamp: new Date().toISOString(),
    },
  });

  console.log('[AlterAI] Task Freeze detected, intervention triggered');
}

// ── Tab Focus Monitoring ──────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  state.currentTabId = tabId;
  state.tabFocusSince = Date.now();
  state.lastInputAt = Date.now();
  try {
    const tab = await chrome.tabs.get(tabId);
    state.currentUrl = tab.url || null;
  } catch (_) {
    state.currentUrl = null;
  }
});

// ── Runtime Message Listener ──────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  // Input activity signal from Content Script — resets the inactivity timer
  if (msg.type === 'user_input_detected') {
    state.lastInputAt = Date.now();
  }
  // Chat message from Side Panel — forward to Hermes
  if (msg.type === 'chat_message') {
    sendToHermes({
      type: 'chat',
      text: msg.text,
    });
  }
});

// ── Initialise ────────────────────────────────────────────────

connectToHermes();
scheduleFreezeScan();
