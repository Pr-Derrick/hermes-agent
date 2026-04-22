// ============================================================
// Alter AI V4.2 — Extension Configuration
// ============================================================

/** WebSocket URL for the Hermes backend. */
export const HERMES_WS_URL = "ws://localhost:8765/ws";

/** Task-freeze detection thresholds */
export const FREEZE_THRESHOLD_MS = 5 * 60 * 1000;
export const INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

/** Cognitive Distortion Detection (local, keyword-based) */
export const DISTORTION_PATTERNS = {
  灾难化: ['一切都完了', '彻底毁了', '全完了', '不可能'],
  全或无: ['永远', '从不', '绝对', '一定失败', '没救了'],
  读心术: ['他们肯定觉得', '大家都认为我', '没人在乎'],
  情绪推理: ['我感觉很糟所以一定很糟', '我就知道会这样'],
};

/** Crisis Intervention Keywords (Tier 3) */
export const CRISIS_KEYWORDS = [
  '自杀', '想死', '自残', '不想活了', '消失', '结束一切',
  'self-harm', 'suicide', 'kill myself',
];

/** ADHD Micro-step Constraints */
export const ADHD_MAX_STEPS = 3;
export const ADHD_MAX_STEP_MINUTES = 15;

/** Memory Tiers */
export const MEMORY_LIMITS = {
  golden_actions: 100,   // 成功克服困难的黄金动作
  distortion_log: 50,    // 认知扭曲记录
  freeze_events: 20,     // 任务瘫痪事件
};
