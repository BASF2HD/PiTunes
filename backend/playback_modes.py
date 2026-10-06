"""Validated MPD playback options, without changing audio output or queue order."""

from shared import ApiError


def mode_commands(body):
    if not isinstance(body, dict) or not any(key in body for key in ("repeatMode", "shuffle")):
        raise ApiError(400, "repeatMode or shuffle is required")
    mode = body.get("repeatMode")
    if "repeatMode" in body and mode not in ("off", "all", "song"):
        raise ApiError(400, "repeatMode must be off, all, or song")
    if "shuffle" in body and not isinstance(body["shuffle"], bool):
        raise ApiError(400, "shuffle must be a boolean")
    commands = []
    if "repeatMode" in body:
        commands.extend([f"repeat {int(mode != 'off')}", f"single {int(mode == 'song')}"])
        if mode != "off":
            commands.append("consume 0")
    if "shuffle" in body:
        commands.append(f"random {int(body['shuffle'])}")
    return commands
