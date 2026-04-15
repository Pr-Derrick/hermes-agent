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

// ── Socratic Draft Card ───────────────────────────────────
// Renders a structured micro-step breakdown card with optional
// RAG citations from the user's past success history.

function appendSocraticCard(card) {
  const el = document.createElement('div');
  el.className = 'socratic-card';

  const steps = Array.isArray(card.steps) ? card.steps : [];
  const citations = Array.isArray(card.citations) ? card.citations : [];

  const citationsHtml = citations.length
    ? `<div class="citations">
        <span class="citation-label">📚 来自你的成功经验：</span>
        ${citations.map((c) => `
          <div class="citation-item">
            <span class="citation-source">${escapeHtml(c.source || '')}</span>
            <span class="citation-snippet">"${escapeHtml(c.snippet || '')}"</span>
          </div>`).join('')}
      </div>`
    : '';

  el.innerHTML = `
    <div class="card-header">
      <span class="card-icon">🧩</span>
      <span class="card-title">${escapeHtml(card.title || '微步拆解')}</span>
    </div>
    <ol class="micro-steps">
      ${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
    </ol>
    ${citationsHtml}
    <div class="card-actions">
      <button id="btn-accept-card">✅ 开始第一步</button>
      <button id="btn-reject-card">🔄 换个方向</button>
    </div>`;

  chatContainer.appendChild(el);
  scrollToBottom();

  el.querySelector('#btn-accept-card').addEventListener('click', () => acceptCard(card, el));
  el.querySelector('#btn-reject-card').addEventListener('click', () => rejectCard(el));
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
