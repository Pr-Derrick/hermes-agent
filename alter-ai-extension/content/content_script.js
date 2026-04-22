// ============================================================
//  Alter AI — Content Script
//  职责：检测页面内用户活跃信号，通知 Service Worker 重置计时器
// ============================================================

let lastInputReportedAt = 0;

/**
 * Report user activity to the Service Worker.
 * Throttled to at most once per 3 seconds to avoid message flooding.
 */
function reportInput() {
  const now = Date.now();
  if (now - lastInputReportedAt < 3000) return;
  lastInputReportedAt = now;
  chrome.runtime.sendMessage({ type: 'user_input_detected' }).catch(() => {});
}

document.addEventListener('keydown', reportInput, { passive: true });
document.addEventListener('mousemove', reportInput, { passive: true });
document.addEventListener('click', reportInput, { passive: true });
document.addEventListener('scroll', reportInput, { passive: true });
