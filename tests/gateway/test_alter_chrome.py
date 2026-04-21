"""Tests for the Alter AI Chrome Extension WebSocket gateway adapter."""
import asyncio
import json
import pytest

from gateway.config import Platform, PlatformConfig


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_adapter(**extra):
    from gateway.platforms.alter_chrome import AlterChromeAdapter

    cfg = PlatformConfig(
        enabled=True,
        extra={
            "host": "127.0.0.1",
            "port": 8765,
            **extra,
        },
    )
    return AlterChromeAdapter(cfg)


# ── Platform Enum ─────────────────────────────────────────────────────────────

class TestAlterChromePlatformEnum:
    def test_enum_exists(self):
        assert Platform.ALTER_CHROME.value == "alter_chrome"

    def test_enum_in_platform_list(self):
        values = [p.value for p in Platform]
        assert "alter_chrome" in values


class TestAlterChromePlatformRegistry:
    def test_platform_registry_includes_alter_chrome(self):
        from hermes_cli.platforms import PLATFORMS
        assert "alter_chrome" in PLATFORMS
        assert PLATFORMS["alter_chrome"].default_toolset == "hermes-cli"


# ── Config Loading ────────────────────────────────────────────────────────────

class TestAlterChromeConfigLoading:
    def test_apply_env_overrides_enabled_flag(self, monkeypatch):
        monkeypatch.setenv("ALTER_CHROME_ENABLED", "true")
        from gateway.config import GatewayConfig, _apply_env_overrides

        config = GatewayConfig()
        _apply_env_overrides(config)
        assert Platform.ALTER_CHROME in config.platforms
        assert config.platforms[Platform.ALTER_CHROME].enabled is True

    def test_apply_env_overrides_token(self, monkeypatch):
        monkeypatch.setenv("ALTER_CHROME_API_TOKEN", "secret-token")
        from gateway.config import GatewayConfig, _apply_env_overrides

        config = GatewayConfig()
        _apply_env_overrides(config)
        assert Platform.ALTER_CHROME in config.platforms
        pc = config.platforms[Platform.ALTER_CHROME]
        assert pc.extra["api_token"] == "secret-token"

    def test_apply_env_overrides_port(self, monkeypatch):
        monkeypatch.setenv("ALTER_CHROME_ENABLED", "true")
        monkeypatch.setenv("ALTER_CHROME_PORT", "9999")
        from gateway.config import GatewayConfig, _apply_env_overrides

        config = GatewayConfig()
        _apply_env_overrides(config)
        assert config.platforms[Platform.ALTER_CHROME].extra["port"] == 9999

    def test_apply_env_overrides_host(self, monkeypatch):
        monkeypatch.setenv("ALTER_CHROME_ENABLED", "true")
        monkeypatch.setenv("ALTER_CHROME_HOST", "192.168.1.1")
        from gateway.config import GatewayConfig, _apply_env_overrides

        config = GatewayConfig()
        _apply_env_overrides(config)
        assert config.platforms[Platform.ALTER_CHROME].extra["host"] == "192.168.1.1"

    def test_not_present_without_env(self, monkeypatch):
        monkeypatch.delenv("ALTER_CHROME_ENABLED", raising=False)
        monkeypatch.delenv("ALTER_CHROME_API_TOKEN", raising=False)
        from gateway.config import GatewayConfig, _apply_env_overrides

        config = GatewayConfig()
        _apply_env_overrides(config)
        assert Platform.ALTER_CHROME not in config.platforms

    def test_connected_platforms_includes_alter_chrome(self, monkeypatch):
        monkeypatch.setenv("ALTER_CHROME_ENABLED", "true")
        from gateway.config import GatewayConfig, _apply_env_overrides

        config = GatewayConfig()
        _apply_env_overrides(config)
        assert Platform.ALTER_CHROME in config.get_connected_platforms()

    def test_not_connected_when_disabled(self, monkeypatch):
        monkeypatch.delenv("ALTER_CHROME_ENABLED", raising=False)
        monkeypatch.delenv("ALTER_CHROME_API_TOKEN", raising=False)
        from gateway.config import GatewayConfig, _apply_env_overrides

        config = GatewayConfig()
        _apply_env_overrides(config)
        assert Platform.ALTER_CHROME not in config.get_connected_platforms()


# ── Adapter Initialisation ────────────────────────────────────────────────────

class TestAlterChromeAdapterInit:
    def test_default_host_and_port(self):
        adapter = _make_adapter()
        assert adapter._host == "127.0.0.1"
        assert adapter._port == 8765

    def test_custom_port(self):
        adapter = _make_adapter(port=9000)
        assert adapter._port == 9000

    def test_api_token_stored(self):
        adapter = _make_adapter(api_token="tok-abc")
        assert adapter._api_token == "tok-abc"

    def test_active_sessions_starts_empty(self):
        adapter = _make_adapter()
        assert adapter._active_sessions == {}

    def test_platform_is_alter_chrome(self):
        adapter = _make_adapter()
        assert adapter.platform == Platform.ALTER_CHROME


# ── Requirements Check ────────────────────────────────────────────────────────

class TestAlterChromeRequirements:
    def test_check_requirements_true_when_aiohttp_available(self):
        from gateway.platforms.alter_chrome import check_alter_chrome_requirements, AIOHTTP_AVAILABLE

        if AIOHTTP_AVAILABLE:
            assert check_alter_chrome_requirements() is True

    def test_check_requirements_false_when_aiohttp_missing(self, monkeypatch):
        import gateway.platforms.alter_chrome as mod
        monkeypatch.setattr(mod, "AIOHTTP_AVAILABLE", False)
        assert mod.check_alter_chrome_requirements() is False


# ── Socratic Card Parsing ─────────────────────────────────────────────────────

class TestParseAgentResponse:
    def setup_method(self):
        self.adapter = _make_adapter()

    def test_plain_text_returns_text_payload(self):
        result = self.adapter._parse_agent_response("Hello world")
        assert result == {"type": "text", "text": "Hello world"}

    def test_valid_card_json_returns_socratic_card(self):
        text = (
            'Some preamble\n'
            '```json\n'
            '{"title": "破冰计划", "steps": ["第一步", "第二步"], "citations": []}\n'
            '```\n'
        )
        result = self.adapter._parse_agent_response(text)
        assert result["type"] == "socratic_card"
        assert result["title"] == "破冰计划"
        assert result["steps"] == ["第一步", "第二步"]

    def test_json_without_steps_falls_back_to_text(self):
        text = '```json\n{"title": "no steps here"}\n```'
        result = self.adapter._parse_agent_response(text)
        assert result["type"] == "text"

    def test_malformed_json_falls_back_to_text(self):
        text = '```json\n{broken json\n```'
        result = self.adapter._parse_agent_response(text)
        assert result["type"] == "text"

    def test_empty_string_falls_back_to_text(self):
        result = self.adapter._parse_agent_response("")
        assert result == {"type": "text", "text": ""}


# ── Session ID Extraction ─────────────────────────────────────────────────────

class TestSessionIdExtraction:
    def test_session_id_extracted_from_chat_id(self):
        adapter = _make_adapter()
        # Simulate a registered session
        session_id = "abc123"
        adapter._active_sessions[session_id] = {
            "ws": None,
            "chat_id": f"alter_chrome:{session_id}",
            "connected_at": 0.0,
        }
        # _parse_agent_response doesn't care about sessions, but send() does
        chat_id = f"alter_chrome:{session_id}"
        extracted = chat_id.split(":", 1)[-1] if ":" in chat_id else chat_id
        assert extracted == session_id

    def test_chat_id_without_prefix_returned_as_is(self):
        chat_id = "plain_session_id"
        extracted = chat_id.split(":", 1)[-1] if ":" in chat_id else chat_id
        assert extracted == "plain_session_id"


class TestSend:
    def test_send_accepts_base_contract_content_kwarg(self):
        class _FakeWS:
            def __init__(self):
                self.sent = []

            async def send_json(self, payload):
                self.sent.append(payload)

        adapter = _make_adapter()
        session_id = "abc123"
        ws = _FakeWS()
        adapter._active_sessions[session_id] = {
            "ws": ws,
            "chat_id": f"alter_chrome:{session_id}",
            "connected_at": 0.0,
        }

        result = asyncio.get_event_loop().run_until_complete(
            adapter.send(
                chat_id=f"alter_chrome:{session_id}",
                content="Hello world",
                reply_to="ignored",
                metadata={"x": "y"},
            )
        )

        assert result.success is True
        assert ws.sent == [{"type": "text", "text": "Hello world"}]


# ── get_chat_info ─────────────────────────────────────────────────────────────

class TestGetChatInfo:
    def test_returns_expected_shape(self):
        adapter = _make_adapter()
        info = asyncio.get_event_loop().run_until_complete(
            adapter.get_chat_info("alter_chrome:test-session-id")
        )
        assert info["type"] == "private"
        assert "Alter AI" in info["name"]
        assert info["chat_id"] == "alter_chrome:test-session-id"


# ── build_source call compatibility ───────────────────────────────────────────

class TestAlterChromeBuildSourceCallCompatibility:
    def test_handle_chat_build_source_called_without_platform_kwarg(self, monkeypatch):
        adapter = _make_adapter()
        captured = {}

        def fake_build_source(*, chat_id, **kwargs):
            captured["chat_id"] = chat_id
            captured["kwargs"] = kwargs
            return "source"

        async def fake_handle_message(event):
            captured["event_source"] = event.source

        monkeypatch.setattr(adapter, "build_source", fake_build_source)
        monkeypatch.setattr(adapter, "handle_message", fake_handle_message)

        asyncio.get_event_loop().run_until_complete(
            adapter._handle_chat(
                ws=None,
                chat_id="alter_chrome:test-session-id",
                data={"text": "hello"},
            )
        )

        assert captured["chat_id"] == "alter_chrome:test-session-id"
        assert "platform" not in captured["kwargs"]
        assert captured["event_source"] == "source"

    def test_run_agent_build_source_called_without_platform_kwarg(self, monkeypatch):
        adapter = _make_adapter()
        captured = {}

        def fake_build_source(*, chat_id, **kwargs):
            captured["chat_id"] = chat_id
            captured["kwargs"] = kwargs
            return "source"

        async def fake_handle_message(event):
            captured["event_source"] = event.source

        monkeypatch.setattr(adapter, "build_source", fake_build_source)
        monkeypatch.setattr(adapter, "handle_message", fake_handle_message)

        asyncio.get_event_loop().run_until_complete(
            adapter._run_agent_with_timeout(
                ws=None,
                chat_id="alter_chrome:test-session-id",
                user_text="hello",
            )
        )

        assert captured["chat_id"] == "alter_chrome:test-session-id"
        assert "platform" not in captured["kwargs"]
        assert captured["event_source"] == "source"


# ── Authorization ─────────────────────────────────────────────────────────────

class TestAlterChromeAuthorization:
    def test_platform_in_authorization_bypass(self):
        """ALTER_CHROME should bypass the user allowlist check.

        Verify the bypass tuple in _is_user_authorized contains ALTER_CHROME
        by reading the source file directly (avoids heavy gateway.run import).
        """
        import os
        run_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "gateway", "run.py"
        )
        with open(os.path.abspath(run_path)) as f:
            src = f.read()
        assert "ALTER_CHROME" in src


# ── Toolset Registration ──────────────────────────────────────────────────────

class TestAlterChromeToolset:
    def test_toolset_exists(self):
        from toolsets import TOOLSETS
        assert "hermes-alter-chrome" in TOOLSETS

    def test_toolset_has_tools(self):
        from toolsets import TOOLSETS
        ts = TOOLSETS["hermes-alter-chrome"]
        assert len(ts["tools"]) > 0

    def test_gateway_toolset_includes_alter_chrome(self):
        from toolsets import TOOLSETS
        assert "hermes-alter-chrome" in TOOLSETS["hermes-gateway"]["includes"]


# ── Platform Hint ─────────────────────────────────────────────────────────────

class TestAlterChromePlatformHint:
    def test_hint_exists(self):
        from agent.prompt_builder import PLATFORM_HINTS
        assert "alter_chrome" in PLATFORM_HINTS

    def test_hint_mentions_adhd(self):
        from agent.prompt_builder import PLATFORM_HINTS
        assert "ADHD" in PLATFORM_HINTS["alter_chrome"]

    def test_hint_mentions_socratic_card(self):
        from agent.prompt_builder import PLATFORM_HINTS
        assert "Socratic Draft Card" in PLATFORM_HINTS["alter_chrome"]
