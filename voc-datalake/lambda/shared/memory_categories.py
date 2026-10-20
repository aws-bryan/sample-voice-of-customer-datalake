"""The feedback categories the memory extractor sees: names for the statement, ids for the tags.

A memory's ``categories`` are category IDS — ``memory_store.visible_to`` checks them against
a reader's category access — but its ``statement`` is read by people, so it must name a
category the way the dashboard does (``shared.display_labels``), never by its id. The
extractor's prompt therefore carries a ``<categories>`` block of ``label (id: …)`` lines, and
the model's ``categories`` answer is mapped back to ids here (an id or a label is accepted;
anything else is dropped). With no category config the answer is kept as before (names the
model saw in the text), so a deployment without a taxonomy loses nothing.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, Final

from shared import memory_policy as policy
from shared.display_labels import category_label

__all__ = ['MAX_GUIDE_CATEGORIES', 'category_guide', 'category_ids', 'config_entries']

#: Categories listed in the prompt (a taxonomy is far smaller; the cap bounds the prompt).
MAX_GUIDE_CATEGORIES: Final = 80


def config_entries(raw: object) -> tuple[Mapping[str, Any], ...]:
    """The category config's entries (stored data: checked, not trusted); () when it is not a list."""
    return tuple(entry for entry in raw if isinstance(entry, Mapping)) if isinstance(raw, list | tuple) else ()


def _names(categories: Iterable[object]) -> list[str]:
    return [c['name'] for c in categories if isinstance(c, Mapping) and isinstance(c.get('name'), str) and c['name']]


def category_guide(categories: Iterable[Mapping[str, Any]]) -> str:
    """The ``<categories>`` block for the extraction prompt, or '' when none are configured."""
    rows = list(categories)
    names = _names(rows)[:MAX_GUIDE_CATEGORIES]
    if not names:
        return ''
    lines = '\n'.join(f'- {category_label(name, rows)} (id: {name})' for name in names)
    return f'\n\n<categories>\n{lines}\n</categories>'


def category_ids(value: object, categories: Iterable[Mapping[str, Any]]) -> list[str]:
    """The model's ``categories`` answer as configured ids (an id or a label maps to its id)."""
    rows = list(categories)
    names = _names(rows)
    if not names:
        return policy.normalise_categories(value)
    if not isinstance(value, list):
        return []
    by_text = {category_label(name, rows).casefold(): name for name in names} | {name.casefold(): name for name in names}
    mapped = [by_text.get(entry.strip().casefold(), '') for entry in value if isinstance(entry, str)]
    return policy.normalise_categories(mapped, known=frozenset(names))
