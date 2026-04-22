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
  showTypingIndicator();
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
  const timeLimit = card.time_limit || 10;

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';
  header.innerHTML = `<span class="card-icon">🧩</span> <span class="card-title">${card.title || '微拆解行动'}</span><span class="card-timer">⏱ ${timeLimit}min</span>`;
  el.appendChild(header);

  // Progress bar
  const progress = document.createElement('div');
  progress.className = 'card-progress';
  progress.innerHTML = '<div class="progress-fill" style="width:0%"></div>';
  el.appendChild(progress);

  // Steps
  const ol = document.createElement('ol');
  ol.className = 'micro-steps';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="step-num">${i + 1}</span>${s}`;
    ol.appendChild(li);
  });
  el.appendChild(ol);

  // Citations from local RAG
  if (citations.length > 0) {
    const citDiv = document.createElement('div');
    citDiv.className = 'citations';
    citDiv.innerHTML = '📚 来自你的成功经验：';
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
  actions.innerHTML = `
    <button class="btn-accept">✅ 开始第一步</button>
    <button class="btn-downgrade">⬇️ 太难了，降级</button>
    <button class="btn-reject">🔄 换个方向</button>
  `;
  el.appendChild(actions);

  // Commit section
  const commit = document.createElement('div');
  commit.className = 'commit-section';
  commit.hidden = true;
  commit.innerHTML = `
    <div class="timer-display"><span class="timer-count">${timeLimit}:00</span></div>
    <div class="commit-buttons">
      <button class="btn-done">✅ 完成了！</button>
      <button class="btn-fail">❌ 没做到</button>
    </div>
  `;
  el.appendChild(commit);

  chatContainer.appendChild(el);
  scrollToBottom();

  // Event bindings
  const acceptBtn = actions.querySelector('.btn-accept');
  const rejectBtn = actions.querySelector('.btn-reject');
  const downgradeBtn = actions.querySelector('.btn-downgrade');
  const doneBtn = commit.querySelector('.btn-done');
  const failBtn = commit.querySelector('.btn-fail');

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
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    timerSpan.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    const fill = cardEl.querySelector('.progress-fill');
    const pct = ((minutes * 60 - seconds) / (minutes * 60)) * 100;
    fill.style.width = `${pct}%`;
    if (seconds <= 0) { clearInterval(activeTimer); timerSpan.textContent = '时间到'; }
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
      commitEl.innerHTML = `<div class="commit-success">🏆 已记录！黄金动作 #${res.goldenCount}<div class="commit-note">知行合一 · 王阳明</div></div>`;
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
  el.innerHTML = `
    <div class="crisis-title">🚨 紧急支持资源</div>
    <div class="crisis-message">你现在不安全吗？以下是可以立即联系的专业援助：</div>
    <div class="crisis-resources">
      ${resources.map(r => `<div class="crisis-resource"><strong>${r.name}</strong><br>${r.tel}</div>`).join('')}
    </div>
  `;
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
