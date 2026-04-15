// ============================================================
//  Alter AI — Extension Configuration
//  Edit HERMES_WS_URL to point at your Hermes backend.
// ============================================================

/** WebSocket URL for the Hermes AlterChrome adapter. */
export const HERMES_WS_URL = "ws://localhost:8765/ws";

/**
 * How long (ms) the user must be on the same tab before a
 * task-freeze intervention is considered.  Default: 5 minutes.
 */
export const FREEZE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * How long (ms) without any keyboard/mouse input before the
 * user is considered inactive.  Default: 5 minutes.
 */
export const INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;
