"""Things to do cards: each reader sees only what they may act on."""
from datetime import timedelta

from briefing import todos
from briefing.test.conftest import NOW
from shared.brief_cards import BriefContext
from shared.category_access import UNRESTRICTED

ANA = todos.Reader(sub='sub-ana', username='ana')
ADMIN = todos.Reader(sub='sub-admin', username='admin', is_admin=True, is_curator=True)


def _ctx(world, reader) -> BriefContext:
    tables = todos.PersonalTables(world.tables.agents, world.tables.memory, world.tables.projects)
    return BriefContext(feedback_table=world.tables.feedback, aggregates_table=world.tables.aggregates,
                        scope=UNRESTRICTED, now=NOW, extra={'reader': reader, 'tables': tables})


def _agent(world, agent_id: str, owner: str, status: str = 'needs_human') -> None:
    world.tables.agents.put_item(Item={'pk': f'AGENT#{agent_id}', 'sk': 'META', 'gsi1pk': 'AGENTS',
                                       'gsi1sk': agent_id, 'agent_id': agent_id, 'name': agent_id,
                                       'owner_sub': owner, 'status': 'active', 'last_run_status': status})


class TestAgentRuns:
    def test_an_admin_sees_every_waiting_run(self, world):
        _agent(world, 'scout', 'sub-ana')
        _agent(world, 'other', 'sub-bo')
        _agent(world, 'done', 'sub-bo', status='completed')
        [card] = todos.agent_run_cards(_ctx(world, ADMIN))
        assert card.facts['count'] == 2

    def test_a_user_sees_only_their_own_agents(self, world):
        _agent(world, 'scout', 'sub-ana')
        _agent(world, 'other', 'sub-bo')
        [card] = todos.agent_run_cards(_ctx(world, ANA))
        assert card.facts['agents'] == [{'agent_id': 'scout', 'name': 'scout'}]


def _memory(world, pk: str, memory_id: str, scope: str, status: str) -> None:
    world.tables.memory.put_item(Item={'pk': pk, 'sk': f'MEM#{memory_id}', 'memory_id': memory_id, 'scope': scope,
                                       'status': status, 'gsi1pk': f'MEMSTATUS#{scope}#{status}', 'gsi1sk': 'x'})


class TestMemoryReview:
    def test_curators_see_the_company_queue_others_only_their_own(self, world):
        _memory(world, 'MEM#company', 'm1', 'company', 'proposed')
        _memory(world, 'MEM#company', 'm2', 'company', 'conflict')
        _memory(world, 'MEM#user#sub-ana', 'm3', 'personal', 'proposed')
        [mine] = todos.memory_review_cards(_ctx(world, ANA))
        [curator] = todos.memory_review_cards(_ctx(world, ADMIN))
        assert mine.facts == {'company': 0, 'personal': 1}
        assert curator.facts == {'company': 2, 'personal': 0}


def _token(world, token_id: str, owner: str, expires_in: timedelta, revoked: bool = False) -> None:
    world.tables.projects.put_item(Item={'pk': 'MCPGTOKEN', 'sk': f'CREATOR#{owner}#TOKEN#{token_id}',
                                         'token_id': token_id})
    row = {'pk': 'MCPGTOKEN', 'sk': f'TOKEN#{token_id}', 'token_id': token_id, 'name': token_id,
           'created_by': owner, 'expires_at': (NOW + expires_in).isoformat()}
    world.tables.projects.put_item(Item={**row, 'revoked_at': NOW.isoformat()} if revoked else row)


def test_only_my_active_tokens_expiring_within_a_week(world):
    _token(world, 'soon', 'sub-ana', timedelta(days=2))
    _token(world, 'later', 'sub-ana', timedelta(days=30))
    _token(world, 'revoked', 'sub-ana', timedelta(days=1), revoked=True)
    _token(world, 'theirs', 'sub-bo', timedelta(days=1))
    [card] = todos.mcp_token_cards(_ctx(world, ANA))
    assert [t['token_id'] for t in card.facts['tokens']] == ['soon']


def test_nothing_to_do_means_no_card(world):
    assert [p(_ctx(world, ANA)) for p in todos.TODO_PROVIDERS] == [[], [], []]
