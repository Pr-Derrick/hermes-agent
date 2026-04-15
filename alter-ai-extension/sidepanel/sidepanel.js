// ============================================================
//  Alter AI — Side Panel Script
//  职责：与 Background Service Worker 通信，渲染 AI 响应和
//  Socratic Draft Card（结构化微步拆解卡片）
// ============================================================

const chatContainer = document.getElementById('chat-container');
const typingIndicator = document.getElementById('typing-indicator');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// ── Communication with Background Service Worker ──────────

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

// ── Message Rendering ─────────────────────────────────────

function handleHermesMessage(payload) {
  hideTypingIndicator();
  if (!payload || !payload.type) return;

  if (payload.type === 'text') {
    appendBubble('ai', payload.text);
  } else if (payload.type === 'socratic_card') {
    appendSocraticCard(payload);
  } else if (payload.type === 'typing') {
    showTypingIndicator();
  } else if (payload.type === 'listener_mode') {
    appendListenerBanner(payload.fallback_text);
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

// Socratic Draft Card ───────────────────────────────────
// Renders a structured micro-step breakdown card with optional
// RAG citations from the user's past success history.

function appendSocraticCard(card) {
  const el = document.createElement('div');
  el.className = 'socratic-card';

  const steps = Array.isArray(card.steps) ? card.steps : [];
  const citations = Array.isArray(card.citations) ? card.citations : [];

  // Header
  const header = document.createElement('div');
  header.className = 'card-header';
  const icon = document.createElement('span');
  icon.className = 'card-icon';
  icon.textContent = '🧩';
  const title = document.createElement('span');
  title.className = 'card-title';
  title.textContent = card.title || '微步拆解';
  header.appendChild(icon);
  header.appendChild(title);
  el.appendChild(header);

  // Micro-steps
  const ol = document.createElement('ol');
  ol.className = 'micro-steps';
  steps.forEach((s) => {
    const li = document.createElement('li');
    li.textContent = s;
    ol.appendChild(li);
  });
  el.appendChild(ol);

  // Citations
  if (citations.length > 0) {
    const citDiv = document.createElement('div');
    citDiv.className = 'citations';
    const label = document.createElement('span');
    label.className = 'citation-label';
    label.textContent = '📚 来自你的成功经验：';
    citDiv.appendChild(label);
    citations.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'citation-item';
      const src = document.createElement('span');
      src.className = 'citation-source';
      src.textContent = c.source || '';
      const snip = document.createElement('span');
      snip.className = 'citation-snippet';
      snip.textContent = `"${c.snippet || ''}"`;
      item.appendChild(src);
      item.appendChild(snip);
      citDiv.appendChild(item);
    });
    el.appendChild(citDiv);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const acceptBtn = document.createElement('button');
  acceptBtn.textContent = '✅ 开始第一步';
  const rejectBtn = document.createElement('button');
  rejectBtn.textContent = '🔄 换个方向';
  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);
  el.appendChild(actions);

  chatContainer.appendChild(el);
  scrollToBottom();

  acceptBtn.addEventListener('click', () => acceptCard(card, el));
  rejectBtn.addEventListener('click', () => rejectCard(el));
}

function acceptCard(card, cardEl) {
  const firstStep = Array.isArray(card.steps) && card.steps[0];
  if (firstStep) {
    sendChat(`好的，我现在开始：${firstStep}`);
  }
  disableCardActions(cardEl);
}

function rejectCard(cardEl) {
  sendChat('请给我换一个方向的建议。');
  disableCardActions(cardEl);
}

function disableCardActions(cardEl) {
  cardEl.querySelectorAll('.card-actions button').forEach((btn) => {
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.style.cursor = 'default';
  });
}

// ── Listener Mode Banner ──────────────────────────────────

function appendListenerBanner(text) {
  const el = document.createElement('div');
  el.className = 'listener-banner';
  el.textContent = text || '正在恢复连接，请稍候…';
  chatContainer.appendChild(el);
  scrollToBottom();
}

// ── Typing Indicator ──────────────────────────────────────

function showTypingIndicator() {
  typingIndicator.hidden = false;
  scrollToBottom();
}

function hideTypingIndicator() {
  typingIndicator.hidden = true;
}

// ── Helpers ───────────────────────────────────────────────

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ── Form Submission ───────────────────────────────────────

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value;
  if (!text.trim()) return;
  sendChat(text);
  chatInput.value = '';
  chatInput.style.height = 'auto';
});

// Allow Shift+Enter for newlines, Enter to send
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event('submit'));
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
});
