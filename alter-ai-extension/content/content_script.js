// ============================================================
//  Alter AI — Content Script
//  职责：检测页面内用户活跃信号，通知 Service Worker 重置计时器
// ============================================================

let inputThrottle = null;

/**
 * Report user activity to the Service Worker.
 * Throttled to at most once per 3 seconds to avoid message flooding.
 */
function reportInput() {
  if (inputThrottle) return;
  inputThrottle = setTimeout(() => { inputThrottle = null; }, 3000);
  chrome.runtime.sendMessage({ type: 'user_input_detected' }).catch(() => {});
}

document.addEventListener('keydown', reportInput, { passive: true });
document.addEventListener('mousemove', reportInput, { passive: true });
document.addEventListener('click', reportInput, { passive: true });
document.addEventListener('scroll', reportInput, { passive: true });
