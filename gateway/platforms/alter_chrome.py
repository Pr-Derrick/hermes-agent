"""Alter AI Chrome Extension WebSocket Gateway Adapter.

Provides a WebSocket server that Chrome Extension clients connect to.
Handles two message types:
  - behavior_signal: implicit signals from background monitoring (task_freeze, etc.)
  - chat: explicit user chat messages from the Side Panel

On task_freeze, injects a proactive intervention prompt into the agent loop.
On API timeout (> AGENT_TIMEOUT_SECS), gracefully degrades to Listener Mode:
  returns a local fallback response, does NOT surface an error to the user.
"""

import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any, Dict, Optional

try:
    import aiohttp
    from aiohttp import web

    AIOHTTP_AVAILABLE = True
except ImportError:
    AIOHTTP_AVAILABLE = False
    web = None  # type: ignore[assignment]

from gateway.config import Platform, PlatformConfig
from gateway.platforms.base import (
    BasePlatformAdapter,
    MessageEvent,
    MessageType,
    SendResult,
)

logger = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"  # Bind to loopback by default; Chrome Extension is local-only
DEFAULT_PORT = 8765
AGENT_TIMEOUT_SECS = 15  # After this, degrade gracefully to Listener Mode
FREEZE_PROMPT_TEMPLATE = (
    "【行为感知】用户在 {url} 页面停留了 {minutes} 分钟且无输入。"
    "请以温和、非评判的语气，主动问候并提供一个 3 分钟微步拆解方案。"
    "如有相关的用户成功历史（RAG），请以 Socratic Draft Card 格式输出。"
    "Card 格式：{{title, steps: [str], citations: [{{source, snippet}}]}}"
)


def check_alter_chrome_requirements() -> bool:
    """Check if the alter_chrome adapter dependencies are available."""
    return AIOHTTP_AVAILABLE


class AlterChromeAdapter(BasePlatformAdapter):
    """WebSocket adapter bridging Chrome Extension clients to the Hermes agent."""

    def __init__(self, config: PlatformConfig):
        super().__init__(config, Platform.ALTER_CHROME)
        self._host: str = config.extra.get("host", DEFAULT_HOST)
        self._port: int = int(config.extra.get("port", DEFAULT_PORT))
        self._api_token: str = config.extra.get("api_token", "")
        # active_sessions: session_id -> {ws, chat_id, connected_at}
        self._active_sessions: Dict[str, dict] = {}
        self._app: Optional[Any] = None
        self._runner: Optional[Any] = None
        self._site: Optional[Any] = None

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def connect(self) -> bool:
        if not AIOHTTP_AVAILABLE:
            logger.error("AlterChrome: aiohttp not installed")
            return False
        self._app = web.Application()
        self._app.router.add_get("/ws", self._ws_handler)
        self._app.router.add_get("/health", self._health_handler)
        self._runner = web.AppRunner(self._app)
        await self._runner.setup()
        self._site = web.TCPSite(self._runner, self._host, self._port)
        await self._site.start()
        logger.info(
            "AlterChrome WebSocket listening on ws://%s:%d/ws",
            self._host,
            self._port,
        )
        return True

    async def disconnect(self) -> None:
        for session in list(self._active_sessions.values()):
            try:
                await session["ws"].close()
            except Exception:
                pass
        if self._runner:
            await self._runner.cleanup()
        logger.info("AlterChrome adapter disconnected")

    # ── WebSocket Handler ────────────────────────────────────────────────────

    async def _ws_handler(self, request: "web.Request") -> "web.WebSocketResponse":
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)

        session_id = str(uuid.uuid4())
        # chat_id doubles as the Hermes session key for this WS connection
        chat_id = f"alter_chrome:{session_id}"
        self._active_sessions[session_id] = {
            "ws": ws,
            "chat_id": chat_id,
            "connected_at": time.time(),
        }
        logger.info("AlterChrome: new session %s", session_id[:8])

        # Acknowledge connection with assigned session_id
        await ws.send_json({"type": "session_ack", "session_id": session_id})

        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    await self._handle_ws_message(ws, session_id, chat_id, msg.data)
                elif msg.type in (
                    aiohttp.WSMsgType.ERROR,
                    aiohttp.WSMsgType.CLOSE,
                ):
                    break
        finally:
            self._active_sessions.pop(session_id, None)
            logger.info("AlterChrome: session %s disconnected", session_id[:8])

        return ws

    # ── Message Routing ──────────────────────────────────────────────────────

    async def _handle_ws_message(
        self,
        ws: "web.WebSocketResponse",
        session_id: str,
        chat_id: str,
        raw: str,
    ) -> None:
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            await ws.send_json({"type": "error", "message": "invalid JSON"})
            return

        msg_type = data.get("type")

        if msg_type == "handshake":
            # Already acknowledged at connection; nothing extra to do
            return
        elif msg_type == "behavior_signal":
            await self._handle_behavior_signal(ws, chat_id, data)
        elif msg_type == "chat":
            await self._handle_chat(ws, chat_id, data)
        else:
            logger.warning("AlterChrome: unknown message type '%s'", msg_type)

    # ── Behavior Signal (Task Freeze) ────────────────────────────────────────

    async def _handle_behavior_signal(
        self,
        ws: "web.WebSocketResponse",
        chat_id: str,
        data: dict,
    ) -> None:
        signal = data.get("signal")
        context = data.get("context", {})

        if signal == "task_freeze":
            minutes = round(context.get("time_on_tab_seconds", 0) / 60, 1)
            url = context.get("url", "当前页面")
            implicit_prompt = FREEZE_PROMPT_TEMPLATE.format(url=url, minutes=minutes)
            await self._run_agent_with_timeout(
                ws=ws,
                chat_id=chat_id,
                user_text=implicit_prompt,
                is_implicit=True,
                context=context,
            )
        else:
            logger.debug("AlterChrome: unhandled signal '%s'", signal)

    # ── Explicit Chat ────────────────────────────────────────────────────────

    async def _handle_chat(
        self,
        ws: "web.WebSocketResponse",
        chat_id: str,
        data: dict,
    ) -> None:
        text = data.get("text", "").strip()
        if not text:
            return
        event = MessageEvent(
            text=text,
            message_type=MessageType.TEXT,
            source=self.build_source(chat_id=chat_id, user_id=chat_id),
            raw_message=data,
        )
        await self.handle_message(event)

    # ── Agent Execution with Timeout + Graceful Degradation ─────────────────

    async def _run_agent_with_timeout(
        self,
        ws: "web.WebSocketResponse",
        chat_id: str,
        user_text: str,
        is_implicit: bool = False,
        context: Optional[dict] = None,
    ) -> None:
        """Run the Hermes agent with a hard timeout.

        Timeout Handling (Guardrail):
        ─────────────────────────────
        1. Wrap agent call in asyncio.wait_for(timeout=AGENT_TIMEOUT_SECS).
        2. On TimeoutError → enter Listener Mode:
           a. Send a soft local fallback response to the client
              (warm, non-alarming — e.g., "我在这里，先深呼吸一下…")
           b. Log the timeout internally (do NOT show error to user).
           c. The extension enters Listener Mode: alarms suspended,
              silent observation continues.
        3. On any other exception → same graceful degradation path.
        4. On success → response is delivered via send() which detects
           Socratic Card JSON and sends a structured or plain-text payload.
        """
        event = MessageEvent(
            text=user_text,
            message_type=MessageType.TEXT,
            source=self.build_source(chat_id=chat_id, user_id=chat_id),
            raw_message={"is_implicit": is_implicit, "behavior_context": context or {}},
        )
        try:
            await asyncio.wait_for(
                self.handle_message(event),
                timeout=AGENT_TIMEOUT_SECS,
            )
        except asyncio.TimeoutError:
            logger.warning(
                "AlterChrome: agent timed out (>%ds), entering Listener Mode",
                AGENT_TIMEOUT_SECS,
            )
            await self._enter_listener_mode(ws, reason="agent_timeout")
        except Exception as exc:
            logger.error("AlterChrome: unexpected agent error: %s", exc)
            await self._enter_listener_mode(ws, reason="agent_error")

    async def _enter_listener_mode(
        self, ws: "web.WebSocketResponse", reason: str
    ) -> None:
        """Send a warm fallback response; signal client to suspend alarms."""
        fallback_text = (
            "我在这里。先深呼吸一下，不用着急。"
            "（系统正在恢复连接，稍后会继续陪伴你。）"
        )
        try:
            await ws.send_json(
                {
                    "type": "listener_mode",
                    "reason": reason,
                    "fallback_text": fallback_text,
                }
            )
        except Exception:
            pass  # WS may already be closing

    # ── Send Interface (called by GatewayRunner to deliver agent replies) ────

    async def send(self, chat_id: str, text: str, **kwargs) -> SendResult:
        """Deliver agent response back to the Chrome Extension client."""
        session_id = chat_id.split(":", 1)[-1] if ":" in chat_id else chat_id
        session = self._active_sessions.get(session_id)
        if not session:
            return SendResult(success=False, error="session not found")

        ws: "web.WebSocketResponse" = session["ws"]
        payload = self._parse_agent_response(text)
        try:
            await ws.send_json(payload)
            return SendResult(success=True)
        except Exception as exc:
            logger.error("AlterChrome send error: %s", exc)
            return SendResult(success=False, error=str(exc))

    def _parse_agent_response(self, text: str) -> dict:
        """Detect if the agent returned a structured Socratic Draft Card (JSON block).

        Falls back to plain text payload if parsing fails.

        Expected agent output format for a card:
            ```json
            {"title": "...", "steps": ["..."], "citations": [...]}
            ```
        """
        match = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
        if match:
            try:
                card = json.loads(match.group(1))
                if "steps" in card:
                    return {"type": "socratic_card", **card}
            except json.JSONDecodeError:
                pass
        return {"type": "text", "text": text}

    async def send_typing(self, chat_id: str) -> None:
        session_id = chat_id.split(":", 1)[-1] if ":" in chat_id else chat_id
        session = self._active_sessions.get(session_id)
        if session:
            try:
                await session["ws"].send_json({"type": "typing"})
            except Exception:
                pass

    async def get_chat_info(self, chat_id: str) -> dict:
        return {
            "name": f"Alter AI Session ({chat_id[:8]})",
            "type": "private",
            "chat_id": chat_id,
        }

    # ── Health Check ─────────────────────────────────────────────────────────

    async def _health_handler(self, request: "web.Request") -> "web.Response":
        return web.json_response(
            {
                "status": "ok",
                "active_sessions": len(self._active_sessions),
            }
        )
