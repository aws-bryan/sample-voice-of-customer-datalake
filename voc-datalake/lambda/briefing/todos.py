"""Things to do: personal, code-only cards (no model), computed when the brief is built.

- ``todo_agent_runs``     — agent runs stopped in ``needs_human`` (admins: every agent;
                            others: the agents they own).
- ``todo_memory_review``  — memories waiting for a decision: the company queue for
                            memory curators (admins and memory reviewers), and the
                            reader's own proposed / conflicting personal memories.
- ``todo_mcp_tokens``     — the reader's own active MCP tokens expiring within 7 days.

Each provider reads only what its reader may act on, and returns at most one card.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final

from boto3.dynamodb.conditions import Key

from shared import agents_store, memory_policy, memory_store
from shared import mcp_global_tokens as tokens
from shared.batch_get import batch_get_all
from shared.brief_cards import BriefCard, BriefContext, CardProvider, card_id
from shared.exceptions import ServiceError
from shared.memory_policy import parse_datetime

EXPIRY_WARNING: Final = timedelta(days=7)
MAX_LISTED: Final = 5
KIND_AGENT_RUNS: Final = 'todo_agent_runs'
KIND_MEMORY_REVIEW: Final = 'todo_memory_review'
KIND_MCP_TOKENS: Final = 'todo_mcp_tokens'
_REVIEW_STATUSES: Final = (memory_policy.STATUS_PROPOSED, memory_policy.STATUS_CONFLICT)


@dataclass(frozen=True)
class Reader:
    """Who the brief is for, as re-checked in Cognito by the worker."""

    sub: str
    username: str = ''
    name: str = ''
    is_admin: bool = False
    is_curator: bool = False


@dataclass(frozen=True)
class PersonalTables:
    agents: Any = None
    memory: Any = None
    projects: Any = None


def _reader(ctx: BriefContext) -> Reader:
    reader = ctx.extra.get('reader')
    if not isinstance(reader, Reader):
        raise TypeError('BriefContext.extra["reader"] must be a Reader')
    return reader


def _tables(ctx: BriefContext) -> PersonalTables:
    tables = ctx.extra.get('tables')
    return tables if isinstance(tables, PersonalTables) else PersonalTables()


def _day(ctx: BriefContext) -> str:
    return ctx.now.strftime('%Y-%m-%d')


def agent_run_cards(ctx: BriefContext) -> list[BriefCard]:
    reader, table = _reader(ctx), _tables(ctx).agents
    if table is None:
        return []
    waiting = [
        {'agent_id': str(a.get('agent_id')), 'name': str(a.get('name') or '')}
        for a in agents_store.list_agents(table)
        if a.get('last_run_status') == agents_store.RUN_NEEDS_HUMAN
        and a.get('status') != agents_store.AGENT_STATUS_ARCHIVED
        and (reader.is_admin or a.get('owner_sub') == reader.sub)
    ]
    if not waiting:
        return []
    return [BriefCard(
        id=card_id(KIND_AGENT_RUNS, _day(ctx)), kind=KIND_AGENT_RUNS, layer='personal', severity='warn',
        title=f'{len(waiting)} agent run(s) need a decision',
        facts={'count': len(waiting), 'agents': waiting[:MAX_LISTED]},
    )]


def memory_review_cards(ctx: BriefContext) -> list[BriefCard]:
    reader, table = _reader(ctx), _tables(ctx).memory
    if table is None:
        return []
    company = sum(memory_store.count_status(table, memory_policy.SCOPE_COMPANY, status)
                  for status in _REVIEW_STATUSES) if reader.is_curator else 0
    personal = sum(len(memory_store.list_personal(table, reader.sub, status, kind=None, q=None))
                   for status in _REVIEW_STATUSES)
    if company + personal == 0:
        return []
    return [BriefCard(
        id=card_id(KIND_MEMORY_REVIEW, _day(ctx)), kind=KIND_MEMORY_REVIEW, layer='personal', severity='info',
        title=f'{company + personal} memories wait for your review',
        facts={'company': company, 'personal': personal},
    )]


def _my_token_ids(table: Any, sub: str) -> list[str]:
    kwargs: dict[str, Any] = {
        'KeyConditionExpression': Key('pk').eq(tokens.GLOBAL_TOKEN_PK)
        & Key('sk').begins_with(tokens.creator_index_prefix(sub)),
        'ProjectionExpression': 'token_id',
    }
    ids: set[str] = set()
    while True:
        page = table.query(**kwargs)
        ids.update(str(p['token_id']) for p in page.get('Items', []) if tokens.is_path_id(p.get('token_id')))
        if not page.get('LastEvaluatedKey'):
            return sorted(ids)
        kwargs['ExclusiveStartKey'] = page['LastEvaluatedKey']


def _my_token_rows(table: Any, sub: str) -> list[dict]:
    keys = [{'pk': tokens.GLOBAL_TOKEN_PK, 'sk': tokens.token_sk(token_id)} for token_id in _my_token_ids(table, sub)]
    return batch_get_all(table, keys, failure=ServiceError('Could not read MCP tokens')) if keys else []


def _expiring(row: dict, now: datetime) -> bool:
    """Active (so ``expires_at`` is readable and in the future) and due within ``EXPIRY_WARNING``."""
    if tokens.token_status(row, now) != tokens.STATUS_ACTIVE:
        return False
    expires = parse_datetime(row.get('expires_at'))
    return expires is not None and expires - now <= EXPIRY_WARNING


def mcp_token_cards(ctx: BriefContext) -> list[BriefCard]:
    reader, table = _reader(ctx), _tables(ctx).projects
    if table is None:
        return []
    soon = [{'token_id': str(r.get('token_id')), 'name': str(r.get('name') or ''),
             'expires_at': str(r.get('expires_at'))}
            for r in _my_token_rows(table, reader.sub) if _expiring(r, ctx.now)]
    if not soon:
        return []
    return [BriefCard(
        id=card_id(KIND_MCP_TOKENS, _day(ctx)), kind=KIND_MCP_TOKENS, layer='personal', severity='info',
        title=f'{len(soon)} MCP token(s) expire within 7 days',
        facts={'count': len(soon), 'tokens': soon[:MAX_LISTED]},
    )]


TODO_PROVIDERS: Final[tuple[CardProvider, ...]] = (agent_run_cards, memory_review_cards, mcp_token_cards)
