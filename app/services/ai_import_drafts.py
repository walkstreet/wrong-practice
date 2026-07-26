"""内存草稿：AI 识别结果人工审核前暂存。进程重启后失效，适合 MVP。"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


DRAFT_TTL_SECONDS = 60 * 60  # 1 hour


@dataclass
class AiImportDraft:
    draft_id: str
    items: list[dict[str, Any]]
    image_urls: list[str] = field(default_factory=list)
    raw_text: str | None = None
    model: str | None = None
    created_at: float = field(default_factory=time.time)


_lock = threading.Lock()
_drafts: dict[str, AiImportDraft] = {}


def _purge_expired_locked() -> None:
    now = time.time()
    expired = [k for k, v in _drafts.items() if now - v.created_at > DRAFT_TTL_SECONDS]
    for key in expired:
        _drafts.pop(key, None)


def create_draft(
    *,
    items: list[dict[str, Any]],
    image_urls: list[str] | None = None,
    raw_text: str | None = None,
    model: str | None = None,
) -> AiImportDraft:
    draft = AiImportDraft(
        draft_id=str(uuid.uuid4()),
        items=items,
        image_urls=image_urls or [],
        raw_text=raw_text,
        model=model,
    )
    with _lock:
        _purge_expired_locked()
        _drafts[draft.draft_id] = draft
    return draft


def get_draft(draft_id: str) -> AiImportDraft | None:
    with _lock:
        _purge_expired_locked()
        draft = _drafts.get(draft_id)
        if draft is None:
            return None
        if time.time() - draft.created_at > DRAFT_TTL_SECONDS:
            _drafts.pop(draft_id, None)
            return None
        return draft


def update_draft_items(draft_id: str, items: list[dict[str, Any]]) -> AiImportDraft | None:
    with _lock:
        _purge_expired_locked()
        draft = _drafts.get(draft_id)
        if draft is None:
            return None
        draft.items = items
        return draft


def delete_draft(draft_id: str) -> None:
    with _lock:
        _drafts.pop(draft_id, None)
