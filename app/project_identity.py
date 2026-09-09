from __future__ import annotations

import hashlib


def project_scope_digest(workspace_id: str, channel_id: str) -> str:
    return hashlib.sha256(f"{workspace_id}\0{channel_id}".encode()).hexdigest()


def project_id_for_channel(workspace_id: str, channel_id: str) -> str:
    return f"slack-project-{project_scope_digest(workspace_id, channel_id)[:32]}"


__all__ = ["project_id_for_channel", "project_scope_digest"]
