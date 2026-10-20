"""Read and refresh one user's brief (``/settings/my-briefing/brief|refresh|cards``).

Refresh is open to everyone, with no cap, and rebuilds only the caller's own brief
(the org layer of their group only when it is stale). The free debounce: with no
review processed since the last brief AND that brief younger than 15 minutes, a
refresh answers ``up_to_date`` at once — no message, no model call. A build already
running answers ``pending`` (no second message).
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Final

from botocore.exceptions import BotoCoreError, ClientError

from shared import briefing_prefs as prefs
from shared import briefing_store as store
from shared.aws import get_sqs_client
from shared.exceptions import ConfigurationError, ServiceError
from shared.logging import logger
from shared.project_access import Caller

QUEUE_ENV: Final = 'BRIEFING_QUEUE_URL'
REASON_REFRESH: Final = 'refresh'
REASON_SCHEDULED: Final = 'scheduled'


def build_message(sub: str, username: str, reason: str) -> str:
    """The ``voc-briefing`` queue body (the worker validates it)."""
    return json.dumps({'kind': 'build', 'sub': sub, 'username': username, 'reason': reason})


def _queue_url() -> str:
    url = os.environ.get(QUEUE_ENV, '')
    if not url:
        raise ConfigurationError('The morning brief is not configured')
    return url


def _send(url: str, caller: Caller) -> None:
    try:
        get_sqs_client().send_message(QueueUrl=url, MessageBody=build_message(caller.subject, caller.username,
                                                                              REASON_REFRESH))
    except (ClientError, BotoCoreError) as exc:
        logger.exception('Brief refresh: enqueue failed')
        raise ServiceError('Could not start the brief. Please retry.') from exc


def get_brief(table: Any, sub: str, now: datetime) -> dict[str, Any]:
    return store.brief_view(store.latest_brief(table, sub), now)


def refresh(table: Any, caller: Caller, now: datetime) -> dict[str, Any]:
    """``{status: up_to_date | pending, brief}`` — the caller's brief is rebuilt unless fresh."""
    latest = store.latest_brief(table, caller.subject)
    if store.is_building(latest, now):
        return {'status': store.STATUS_PENDING, 'brief': store.brief_view(latest, now)}
    row = table.get_item(Key=prefs.preferences_key(caller.subject)).get('Item')
    settings = prefs.stored_preferences(row)
    marker = store.feedback_marker(table, now)
    if store.is_up_to_date(latest, marker, now, store.settings_marker(settings)):
        return {'status': 'up_to_date', 'brief': store.brief_view(latest, now)}
    url = _queue_url()
    day = prefs.local_day(settings['time_zone'], now)
    pending = store.mark_pending(table, caller.subject, day, now)
    try:
        _send(url, caller)
    except ServiceError:
        store.mark_failed(table, caller.subject, day, now)
        raise
    return {'status': store.STATUS_PENDING, 'brief': store.brief_view(pending, now)}
