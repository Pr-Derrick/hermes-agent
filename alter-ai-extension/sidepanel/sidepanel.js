// ============================================================
// Alter AI V4.2 — Sidepanel Script
// ============================================================

const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// ── Message Handling ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'sidepanel') return;
  handleHermesMessage(msg.payload);
});

function sendChat(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  chrome.runtime.sendMessage({ type: 'chat_message', text: trimmed }).catch(() => {});
  appendBubble('user', trimmed);
}

function handleHermesMessage(payload) {
  hideTypingIndicator();
  if (!payload?.type) return;
  switch (payload.type) {
    case 'text':          appendBubble('ai', payload.text); break;
    case 'socratic_card': appendSocraticCard(payload); break;
    case 'typing':        showTypingIndicator(); break;
    case 'listener_mode': appendListenerBanner(payload); break;
    case 'crisis_intervention': appendCrisisBanner(payload); break;
  }
}

// ── Plain-text Bubble ─────────────────────────────────────
function appendBubble(role, text) {
  const el = document.createElement('div');
  el.className = `bubble bubble-${role}`;
  el.textContent = text;
  chatContainer.appendChild(el);
  scrollToBottom();
}

// ── Cognitive Distortion Tag (inline) ─────────────────────
function appendDistortionTag(types) {
  const el = document.createElement('div');
  el.className = 'distortion-tag';
  el.textContent = `⚠️ 检测到认知扭曲：${types.join('、')}`;
  chatContainer.appendChild(el);
  scrollToBottom();
}

// ── Socratic Draft Card V4.2 ──────────────────────────────
function appendSocraticCard(card) {
  const el = document.createElement('div');
  el.className = 'socratic-card';

  const steps = Array.isArray(card.steps) ? card.steps : [];
  const citations = Array.isArray(card.citations) ? card.citations : [];
  const parsedTimeLimit = Number(card.time_limit);
  const timeLimit = Number.isFinite(parsedTimeLimit) && parsedTimeLimit > 0 ? parsedTimeLimit : 10;

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';
  const icon = document.createElement('span');
  icon.className = 'card-icon';
  icon.textContent = '🧩';
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = card.title || '微拆解行动';
  const timer = document.createElement('span');
  timer.className = 'card-timer';
  timer.textContent = `⏱ ${timeLimit}min`;
  header.append(icon, title, timer);
  el.appendChild(header);

  // Progress bar
  const progress = document.createElement('div');
  progress.className = 'card-progress';
  const progressFill = document.createElement('div');
  progressFill.className = 'progress-fill';
  progressFill.style.width = '0%';
  progress.appendChild(progressFill);
  el.appendChild(progress);

  // Steps
  const ol = document.createElement('ol');
  ol.className = 'micro-steps';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    const stepNum = document.createElement('span');
    stepNum.className = 'step-num';
    stepNum.textContent = String(i + 1);
    li.append(stepNum, document.createTextNode(String(s)));
    ol.appendChild(li);
  });
  el.appendChild(ol);

  // Citations from local RAG
  if (citations.length > 0) {
    const citDiv = document.createElement('div');
    citDiv.className = 'citations';
    const citationsTitle = document.createElement('div');
    citationsTitle.textContent = '📚 来自你的成功经验：';
    citDiv.appendChild(citationsTitle);
    citations.forEach(c => {
      const span = document.createElement('span');
      span.className = 'citation-item';
      span.textContent = c;
      citDiv.appendChild(span);
    });
    el.appendChild(citDiv);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'btn-accept';
  acceptBtn.textContent = '✅ 开始第一步';
  const downgradeBtn = document.createElement('button');
  downgradeBtn.className = 'btn-downgrade';
  downgradeBtn.textContent = '⬇️ 太难了，降级';
  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'btn-reject';
  rejectBtn.textContent = '🔄 换个方向';
  actions.append(acceptBtn, downgradeBtn, rejectBtn);
  el.appendChild(actions);

  // Commit section
  const commit = document.createElement('div');
  commit.className = 'commit-section';
  commit.hidden = true;
  const timerDisplay = document.createElement('div');
  timerDisplay.className = 'timer-display';
  const timerCount = document.createElement('span');
  timerCount.className = 'timer-count';
  timerCount.textContent = `${timeLimit}:00`;
  timerDisplay.appendChild(timerCount);
  const commitButtons = document.createElement('div');
  commitButtons.className = 'commit-buttons';
  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn-done';
  doneBtn.textContent = '✅ 完成了！';
  const failBtn = document.createElement('button');
  failBtn.className = 'btn-fail';
  failBtn.textContent = '❌ 没做到';
  commitButtons.append(doneBtn, failBtn);
  commit.append(timerDisplay, commitButtons);
  el.appendChild(commit);

  chatContainer.appendChild(el);
  scrollToBottom();

  // Event bindings
  acceptBtn.addEventListener('click', () => startActionTimer(card, el, commit, timeLimit));
  rejectBtn.addEventListener('click', () => rejectCard(el));
  downgradeBtn.addEventListener('click', () => requestDowngrade(card, el));
  doneBtn.addEventListener('click', () => commitAction(card, 0, el));
  failBtn.addEventListener('click', () => { if (activeTimer) clearInterval(activeTimer); rejectCard(el); });
}

// ── Action Timer ──────────────────────────────────────────
let activeTimer = null;

function startActionTimer(card, cardEl, commitEl, minutes) {
  disableCardActions(cardEl);
  commitEl.hidden = false;
  let seconds = minutes * 60;
  const timerSpan = commitEl.querySelector('.timer-count');
  activeTimer = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(activeTimer);
      timerSpan.textContent = '时间到';
      return;
    }
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    timerSpan.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    const fill = cardEl.querySelector('.progress-fill');
    const pct = ((minutes * 60 - seconds) / (minutes * 60)) * 100;
    fill.style.width = `${pct}%`;
  }, 1000);
  commitEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function commitAction(card, stepIndex, cardEl) {
  if (activeTimer) clearInterval(activeTimer);
  const action = {
    title: card.title,
    step: card.steps?.[stepIndex] || '未命名动作',
    completed_at: Date.now(),
  };
  chrome.runtime.sendMessage({ type: 'action_completed', action }, (res) => {
    if (res?.success) {
      const commitEl = cardEl.querySelector('.commit-section');
      commitEl.replaceChildren();
      const success = document.createElement('div');
      success.className = 'commit-success';
      success.textContent = `🏆 已记录！黄金动作 #${res.goldenCount}`;
      const note = document.createElement('div');
      note.className = 'commit-note';
      note.textContent = '知行合一 · 王阳明';
      success.appendChild(note);
      commitEl.appendChild(success);
    }
  });
}

function requestDowngrade(card, cardEl) {
  if (activeTimer) clearInterval(activeTimer);
  sendChat('这个动作还是太大了，请帮我降级到更小的粒度。');
  disableCardActions(cardEl);
}

// ── Helpers ───────────────────────────────────────────────
function disableCardActions(cardEl) {
  cardEl.querySelectorAll('.card-actions button').forEach(b => b.disabled = true);
}

function rejectCard(cardEl) {
  sendChat('请给我换一个方向的建议。');
  disableCardActions(cardEl);
}

// ── Banners ───────────────────────────────────────────────
function appendListenerBanner(payload) {
  const el = document.createElement('div');
  el.className = 'listener-banner';
  el.textContent = payload.fallback_text || '🔌 已切换至本地模式';
  chatContainer.appendChild(el);
  scrollToBottom();
}

function appendCrisisBanner(payload) {
  const el = document.createElement('div');
  el.className = 'crisis-banner';
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  const title = document.createElement('div');
  title.className = 'crisis-title';
  title.textContent = '🚨 紧急支持资源';
  const message = document.createElement('div');
  message.className = 'crisis-message';
  message.textContent = '你现在不安全吗？以下是可以立即联系的专业援助：';
  const resourcesEl = document.createElement('div');
  resourcesEl.className = 'crisis-resources';
  resources.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'crisis-resource';
    const name = document.createElement('strong');
    name.textContent = String(r?.name || '');
    item.append(name, document.createElement('br'), document.createTextNode(String(r?.tel || '')));
    resourcesEl.appendChild(item);
  });
  el.append(title, message, resourcesEl);
  chatContainer.appendChild(el);
  scrollToBottom();
}

// ── Typing & Scroll ───────────────────────────────────────
function showTypingIndicator() { typingIndicator.hidden = false; scrollToBottom(); }
function hideTypingIndicator() { typingIndicator.hidden = true; }
function scrollToBottom() { chatContainer.scrollTop = chatContainer.scrollHeight; }

// ── Form ──────────────────────────────────────────────────
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value;
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendChat(text);
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm.dispatchEvent(new Event('submit')); }
});

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
});
