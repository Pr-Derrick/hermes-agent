// ============================================================
// Alter AI V4.2 — Background Service Worker
// ============================================================
import {
  HERMES_WS_URL, FREEZE_THRESHOLD_MS, INACTIVITY_THRESHOLD_MS,
  DISTORTION_PATTERNS, CRISIS_KEYWORDS, MEMORY_LIMITS
} from '../config.js';
const NORMALIZED_CRISIS_KEYWORDS = CRISIS_KEYWORDS.map((k) => String(k).toLowerCase());

// ── 状态机 ──────────────────────────────────────────────────
const state = {
  ws: null,
  wsReady: false,
  sessionId: null,
  listenerModeActive: false,
  crisisModeActive: false,
  currentTabId: null,
  currentUrl: '',
  tabFocusSince: null,
  lastInputAt: null,
  offlineQueue: [],
  memory: {
    goldenActions: [],
    distortionHistory: [],
    freezeHistory: [],
  },
};

// ── WebSocket Management ────────────────────────────────────
function connectToHermes() {
  if (state.ws?.readyState === WebSocket.CONNECTING) return;
  state.ws = new WebSocket(HERMES_WS_URL);

  state.ws.onopen = () => {
    state.wsReady = true;
    sendToHermes({ type: 'handshake', client: 'chrome_extension', version: '0.2.0' });
    flushOfflineQueue();
    if (state.listenerModeActive) exitListenerMode();
  };

  state.ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch (_) { return; }
    if (msg.type === 'session_ack') state.sessionId = msg.session_id;
    chrome.runtime.sendMessage({
      target: 'sidepanel',
      payload: enrichHermesMessage(msg)
    }).catch(() => {});
  };

  state.ws.onclose = () => {
    state.wsReady = false;
    setTimeout(connectToHermes, 5000);
  };

  state.ws.onerror = () => {
    state.wsReady = false;
    enterListenerMode('ws_error');
  };
}

function sendToHermes(payload) {
  if (!state.wsReady) { queueOfflineEvent(payload); return; }
  state.ws.send(JSON.stringify({ session_id: state.sessionId, ...payload }));
}

// ── Offline Queue ─────────────────────────────────────────
function queueOfflineEvent(payload) {
  state.offlineQueue.push({ payload, ts: Date.now() });
  if (state.offlineQueue.length > 50) state.offlineQueue.shift();
}

function flushOfflineQueue() {
  while (state.offlineQueue.length > 0 && state.wsReady) {
    const { payload } = state.offlineQueue.shift();
    sendToHermes(payload);
  }
}

// ── Listener Mode (Graceful Degradation) ────────────────────
let listenerRetryInterval = null;

function enterListenerMode(reason) {
  if (state.listenerModeActive) return;
  state.listenerModeActive = true;
  chrome.alarms.clear('taskFreezeCheck');
  chrome.storage.local.set({ listenerMode: true, listenerReason: reason });
  chrome.runtime.sendMessage({
    target: 'sidepanel',
    payload: {
      type: 'listener_mode',
      fallback_text: `🔌 已降级为本地模式 (${reason})。基础功能仍可用，连接恢复后将自动同步。`
    }
  }).catch(() => {});
  listenerRetryInterval = setInterval(() => {
    if (!state.wsReady) connectToHermes();
    else exitListenerMode();
  }, 30000);
}

function exitListenerMode() {
  state.listenerModeActive = false;
  if (listenerRetryInterval) { clearInterval(listenerRetryInterval); listenerRetryInterval = null; }
  chrome.storage.local.set({ listenerMode: false });
  scheduleFreezeScan();
}

// ── Local Cognitive Routing (plugin-side) ──────────────────
function enrichHermesMessage(msg) {
  return {
    ...msg,
    _local: {
      goldenActionsCount: state.memory.goldenActions.length,
      distortionsToday: state.memory.distortionHistory.filter(
        d => d.timestamp > Date.now() - 86400000
      ).length,
    }
  };
}

// ── Crisis Detection (Tier 3 Emergency) ──────────────────────
function detectCrisis(text) {
  const lower = text.toLowerCase();
  return NORMALIZED_CRISIS_KEYWORDS.some((k) => lower.includes(k));
}

function triggerCrisisProtocol() {
  if (state.crisisModeActive) return;
  state.crisisModeActive = true;
  chrome.alarms.clear('taskFreezeCheck');
  chrome.runtime.sendMessage({
    target: 'sidepanel',
    payload: {
      type: 'crisis_intervention',
      resources: [
        { name: '北京心理危机研究与干预中心', tel: '010-82951332', url: 'https://www.crisis.org.cn' },
        { name: '全国心理援助热线', tel: '400-161-9995', url: null },
        { name: 'Crisis Text Line (EN)', tel: 'Text HOME to 741741', url: 'https://www.crisistextline.org' },
      ]
    }
  }).catch(() => {});
  chrome.notifications.create('crisis-alert', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Alter AI — 紧急支持',
    message: '请立即联系专业援助机构。你不是一个人。',
  });
}

// ── Cognitive Distortion Detection (local) ─────────────────
function detectDistortion(text) {
  const found = [];
  for (const [type, patterns] of Object.entries(DISTORTION_PATTERNS)) {
    if (patterns.some(p => text.includes(p))) found.push(type);
  }
  return found;
}

function logDistortion(types, context) {
  const entry = { types, context, timestamp: Date.now() };
  state.memory.distortionHistory.unshift(entry);
  if (state.memory.distortionHistory.length > MEMORY_LIMITS.distortion_log) {
    state.memory.distortionHistory.pop();
  }
  chrome.storage.local.set({ distortionHistory: state.memory.distortionHistory });
}

// ── Task-Freeze Detection ──────────────────────────────────
function scheduleFreezeScan() {
  if (state.listenerModeActive) return;
  chrome.alarms.create('taskFreezeCheck', { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'taskFreezeCheck') return;
  const now = Date.now();
  const timeOnTab = state.tabFocusSince ? now - state.tabFocusSince : 0;
  const timeSinceInput = state.lastInputAt ? now - state.lastInputAt : timeOnTab;
  if (timeOnTab >= FREEZE_THRESHOLD_MS && timeSinceInput >= INACTIVITY_THRESHOLD_MS) {
    triggerFreezeIntervention({
      url: state.currentUrl,
      timeOnTabMs: timeOnTab,
      inactivityMs: timeSinceInput,
    });
  }
});

function triggerFreezeIntervention(context) {
  if (state.crisisModeActive) return;
  if (state.currentTabId !== null) {
    chrome.sidePanel.open({ tabId: state.currentTabId }).catch(() => {});
  }
  const freezeEntry = { url: context.url, duration: context.timeOnTabMs, timestamp: Date.now() };
  state.memory.freezeHistory.unshift(freezeEntry);
  if (state.memory.freezeHistory.length > MEMORY_LIMITS.freeze_events) state.memory.freezeHistory.pop();
  chrome.storage.local.set({ freezeHistory: state.memory.freezeHistory });
  sendToHermes({
    type: 'behavior_signal',
    signal: 'task_freeze',
    context: {
      url: context.url,
      time_on_tab_seconds: Math.round(context.timeOnTabMs / 1000),
      inactivity_seconds: Math.round(context.inactivityMs / 1000),
    }
  });
  // Reset timer
  state.tabFocusSince = Date.now();
  state.lastInputAt = Date.now();
}

// ── Tab & Input Monitoring ─────────────────────────────────
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  state.currentTabId = tabId;
  state.tabFocusSince = Date.now();
  state.lastInputAt = Date.now();
  try {
    const tab = await chrome.tabs.get(tabId);
    state.currentUrl = tab.url || '';
  } catch (_) {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.currentTabId && changeInfo.url) {
    state.currentUrl = changeInfo.url;
    state.tabFocusSince = Date.now();
    state.lastInputAt = Date.now();
  }
});

// ── Message Router ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'user_input_detected') {
    state.lastInputAt = Date.now();
    return;
  }

  if (msg.type === 'chat_message') {
    const distortions = detectDistortion(msg.text);
    if (distortions.length > 0) logDistortion(distortions, { text: msg.text.substring(0, 100) });
    if (detectCrisis(msg.text)) {
      sendToHermes({ type: 'chat', text: msg.text, distortions, crisis_detected: true });
      triggerCrisisProtocol();
      return;
    }
    sendToHermes({ type: 'chat', text: msg.text, distortions });
    return;
  }

  if (msg.type === 'action_completed') {
    const action = { ...msg.action, timestamp: Date.now() };
    state.memory.goldenActions.unshift(action);
    if (state.memory.goldenActions.length > MEMORY_LIMITS.golden_actions) state.memory.goldenActions.pop();
    chrome.storage.local.set({ goldenActions: state.memory.goldenActions });
    sendResponse({ success: true, goldenCount: state.memory.goldenActions.length });
    return true;
  }

  if (msg.type === 'get_distortion_history') {
    sendResponse({ history: state.memory.distortionHistory });
    return true;
  }

  if (msg.type === 'get_golden_actions') {
    sendResponse({ actions: state.memory.goldenActions.slice(0, 5) });
    return true;
  }
});

// ── Memory Bootstrap ──────────────────────────────────────
async function bootstrapMemory() {
  const data = await chrome.storage.local.get(['goldenActions', 'distortionHistory', 'freezeHistory']);
  state.memory.goldenActions = data.goldenActions || [];
  state.memory.distortionHistory = data.distortionHistory || [];
  state.memory.freezeHistory = data.freezeHistory || [];
}

// ── Initialise ────────────────────────────────────────────
bootstrapMemory();
connectToHermes();
scheduleFreezeScan();
