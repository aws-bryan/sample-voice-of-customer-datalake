"""GET/PUT /settings/my-briefing, GET .../brief, POST .../refresh, PUT .../cards (docs/briefing.md),
against moto: the aggregates table, SNS (the brief topic), Cognito (the caller's own email) and SQS."""
import json
from datetime import UTC, datetime, timedelta

import boto3
import pytest
from botocore.exceptions import ClientError
from handler_events_fixtures import call_route
from moto import mock_aws

import settings_handler
from settings_handler import lambda_handler
from shared import briefing_prefs, briefing_requests, briefing_store, briefing_subscription
from shared.test.moto_tables import create_pk_sk_table

OTHER = {'sub': 'sub-other', 'cognito:username': 'bo', 'cognito:groups': 'users'}
PATH = '/settings/my-briefing'
CARD = 'whats_new_0123456789abcdef'


class World:
    def __init__(self, table, sns, sqs, queue_url, topic_arn):
        self.table, self.sns, self.sqs, self.queue_url, self.topic_arn = table, sns, sqs, queue_url, topic_arn
        #: Cognito username -> sub (the API compares the directory's sub with the caller's claim).
        self.subs: dict[str, str] = {}

    def claims(self, username: str = 'ana') -> dict:
        return {'sub': self.subs[username], 'cognito:username': username, 'cognito:groups': 'users'}

    def messages(self) -> list[dict]:
        return self.sqs.receive_message(QueueUrl=self.queue_url, MaxNumberOfMessages=10).get('Messages', [])

    def subscriptions(self) -> list[dict]:
        return self.sns.list_subscriptions_by_topic(TopicArn=self.topic_arn)['Subscriptions']


class FakeDirectory:
    """``AdminGetUser`` over a fixed set of users (moto's Cognito needs an extra package)."""

    def __init__(self, users: dict[str, dict[str, str]]):
        self.users = users

    def admin_get_user(self, *, UserPoolId: str, Username: str) -> dict:
        del UserPoolId
        attributes = self.users[Username]
        return {'Enabled': True, 'UserAttributes': [{'Name': k, 'Value': v} for k, v in attributes.items()]}


DIRECTORY = {
    'ana': {'sub': 'sub-ana', 'email': 'ana@example.com', 'email_verified': 'true'},
    'cy': {'sub': 'sub-cy', 'email': 'cy@example.com', 'email_verified': 'false'},
}


@pytest.fixture
def world(monkeypatch):
    with mock_aws():
        table = create_pk_sk_table('test-aggregates')
        sns = boto3.client('sns', region_name='us-east-1')
        sqs = boto3.client('sqs', region_name='us-east-1')
        topic_arn = sns.create_topic(Name='voc-briefing-test')['TopicArn']
        queue_url = sqs.create_queue(QueueName='voc-briefing-test')['QueueUrl']
        monkeypatch.setenv('BRIEFING_TOPIC_ARN', topic_arn)
        monkeypatch.setenv('BRIEFING_QUEUE_URL', queue_url)
        monkeypatch.setenv('USER_POOL_ID', 'us-east-1_test')
        monkeypatch.setenv('ALLOWED_ORIGIN', 'https://voc.example.com')
        monkeypatch.setattr(briefing_subscription, '_clients', {'sns': sns, 'cognito': FakeDirectory(DIRECTORY)})
        monkeypatch.setattr(briefing_requests, 'get_sqs_client', lambda: sqs)
        monkeypatch.setattr(settings_handler, 'aggregates_table', table)
        world = World(table, sns, sqs, queue_url, topic_arn)
        world.subs = {name: user['sub'] for name, user in DIRECTORY.items()}
        yield world


def _call(world, api_gateway_event, lambda_context, method, path=PATH, body=None, claims=None):
    return call_route(lambda_handler, api_gateway_event, lambda_context,
                      method=method, path=path, body=body, claims=claims or world.claims())


class TestPreferences:
    def test_everything_is_off_by_default(self, world, api_gateway_event, lambda_context):
        response, body = _call(world, api_gateway_event, lambda_context, 'GET')
        assert response['statusCode'] == 200
        assert (body['enabled'], body['email'], body['email_status']) == (False, False, 'off')
        assert world.subscriptions() == []

    def test_subscribing_indexes_the_user_for_the_dispatcher(self, world, api_gateway_event, lambda_context):
        _, body = _call(world, api_gateway_event, lambda_context, 'PUT',
                        body={'enabled': True, 'hour': 7, 'time_zone': 'Europe/Paris'})
        assert (body['enabled'], body['hour'], body['time_zone']) == (True, 7, 'Europe/Paris')
        row = world.table.get_item(Key=briefing_store.subscriber_key(world.subs['ana']))['Item']
        assert (row['hour'], row['time_zone'], row['username'], row['site_url']) == (
            7, 'Europe/Paris', 'ana', 'https://voc.example.com')

    def test_turning_it_off_removes_the_index_row(self, world, api_gateway_event, lambda_context):
        _call(world, api_gateway_event, lambda_context, 'PUT', body={'enabled': True})
        _call(world, api_gateway_event, lambda_context, 'PUT', body={'enabled': False})
        assert 'Item' not in world.table.get_item(Key=briefing_store.subscriber_key(world.subs['ana']))

    def test_email_subscribes_the_callers_own_cognito_address(self, world, api_gateway_event, lambda_context):
        _, body = _call(world, api_gateway_event, lambda_context, 'PUT', body={'enabled': True, 'email': True})
        assert body['email_status'] in ('pending', 'confirmed')
        [subscription] = world.subscriptions()
        assert (subscription['Protocol'], subscription['Endpoint']) == ('email', 'ana@example.com')
        policy = world.sns.get_subscription_attributes(SubscriptionArn=subscription['SubscriptionArn'])
        assert policy['Attributes']['FilterPolicy'] == json.dumps({'sub': [world.subs['ana']]})

    def test_the_address_is_never_stored(self, world, api_gateway_event, lambda_context):
        _call(world, api_gateway_event, lambda_context, 'PUT', body={'enabled': True, 'email': True})
        row = world.table.get_item(Key={'pk': f"USERCTX#{world.subs['ana']}", 'sk': 'briefing'})['Item']
        assert 'ana@example.com' not in str(row)

    def test_email_off_unsubscribes(self, world, api_gateway_event, lambda_context):
        _call(world, api_gateway_event, lambda_context, 'PUT', body={'enabled': True, 'email': True})
        _, body = _call(world, api_gateway_event, lambda_context, 'PUT', body={'email': False})
        assert body['email_status'] == 'off'
        assert world.subscriptions() == []

    @pytest.mark.parametrize(('code', 'level'), [('InvalidParameter', 'INFO'), ('NotFound', 'INFO'),
                                                 ('AuthorizationError', 'WARNING')])
    def test_a_pending_subscription_logs_info_and_a_real_failure_warns(self, monkeypatch, caplog, code, level):
        class RefusingSns:
            def unsubscribe(self, *, SubscriptionArn: str) -> None:
                del SubscriptionArn
                raise ClientError({'Error': {'Code': code, 'Message': 'no'}}, 'Unsubscribe')

        monkeypatch.setattr(briefing_subscription, '_sns', RefusingSns)
        caplog.set_level('INFO')
        briefing_subscription.unsubscribe('arn:aws:sns:us-east-1:111111111111:voc-briefing:abc')
        [record] = [r for r in caplog.records if r.getMessage().startswith('Brief email')]
        assert (record.levelname, getattr(record, 'error_code', None)) == (level, code)

    def test_an_unverified_email_is_refused(self, world, api_gateway_event, lambda_context):
        response, body = _call(world, api_gateway_event, lambda_context, 'PUT', body={'enabled': True, 'email': True},
                               claims=world.claims('cy'))
        assert response['statusCode'] == 400
        assert 'Verify your email' in body['error']
        assert world.subscriptions() == []

    def test_an_address_in_the_body_is_refused(self, world, api_gateway_event, lambda_context):
        response, _ = _call(world, api_gateway_event, lambda_context, 'PUT',
                            body={'email': True, 'endpoint': 'someone@example.com'})
        assert response['statusCode'] == 400
        assert world.subscriptions() == []

    def test_preferences_are_per_user(self, world, api_gateway_event, lambda_context):
        _call(world, api_gateway_event, lambda_context, 'PUT', body={'language': 'de'})
        _, theirs = _call(world, api_gateway_event, lambda_context, 'GET', claims=OTHER)
        assert theirs['language'] == 'en'


def _ready_brief(world, sub: str, generated: datetime, marker: str) -> None:
    row = world.table.get_item(Key=briefing_prefs.preferences_key(sub)).get('Item')
    world.table.put_item(Item={
        **briefing_store.brief_key(sub, generated.strftime('%Y-%m-%d')), 'status': 'ready',
        'generated_at': generated.isoformat(), 'feedback_marker': marker, 'card_state': {},
        'settings_marker': briefing_store.settings_marker(briefing_prefs.stored_preferences(row)),
        'cards': [{'id': CARD, 'kind': 'whats_new', 'title': '12 reviews', 'facts': {'current': 12}}],
    })


class TestBriefAndRefresh:
    def test_no_brief_yet(self, world, api_gateway_event, lambda_context):
        _, body = _call(world, api_gateway_event, lambda_context, 'GET', path=f'{PATH}/brief')
        assert (body['status'], body['cards']) == ('none', [])

    def test_refresh_queues_only_the_callers_build(self, world, api_gateway_event, lambda_context):
        response, body = _call(world, api_gateway_event, lambda_context, 'POST', path=f'{PATH}/refresh')
        assert (response['statusCode'], body['status']) == (200, 'pending')
        [message] = world.messages()
        assert json.loads(message['Body'])['sub'] == world.subs['ana']
        assert '"reason": "refresh"' in message['Body']

    def test_a_second_refresh_while_building_sends_nothing(self, world, api_gateway_event, lambda_context):
        _call(world, api_gateway_event, lambda_context, 'POST', path=f'{PATH}/refresh')
        _, body = _call(world, api_gateway_event, lambda_context, 'POST', path=f'{PATH}/refresh')
        assert body['status'] == 'pending'
        assert len(world.messages()) == 1

    @pytest.mark.parametrize(('new_reviews', 'status', 'queued'), [(False, 'up_to_date', 0), (True, 'pending', 1)])
    def test_a_fresh_brief_is_rebuilt_only_after_new_reviews(self, world, api_gateway_event, lambda_context,
                                                            new_reviews, status, queued):
        now = datetime.now(UTC)
        marker = 'stale-marker' if new_reviews else briefing_store.feedback_marker(world.table, now)
        _ready_brief(world, world.subs['ana'], now - timedelta(minutes=5), marker)
        _, body = _call(world, api_gateway_event, lambda_context, 'POST', path=f'{PATH}/refresh')
        assert body['status'] == status
        assert len(world.messages()) == queued

    @pytest.mark.parametrize('change', [{'language': 'de'}, {'instructions': 'Only payments, please.'}])
    def test_a_fresh_brief_is_rebuilt_after_its_language_or_instructions_change(
            self, world, api_gateway_event, lambda_context, change):
        now = datetime.now(UTC)
        _ready_brief(world, world.subs['ana'], now - timedelta(minutes=5), briefing_store.feedback_marker(world.table, now))
        _call(world, api_gateway_event, lambda_context, 'PUT', body=change)
        _, body = _call(world, api_gateway_event, lambda_context, 'POST', path=f'{PATH}/refresh')
        assert body['status'] == 'pending'
        assert len(world.messages()) == 1

    def test_card_states_are_stored_on_the_callers_brief(self, world, api_gateway_event, lambda_context):
        now = datetime.now(UTC)
        _ready_brief(world, world.subs['ana'], now, 'm')
        day = now.strftime('%Y-%m-%d')
        _, body = _call(world, api_gateway_event, lambda_context, 'PUT', path=f'{PATH}/cards',
                        body={'day': day, 'states': {CARD: 'dismissed'}})
        assert body == {'day': day, 'card_state': {CARD: 'dismissed'}}
        _, brief = _call(world, api_gateway_event, lambda_context, 'GET', path=f'{PATH}/brief')
        assert brief['card_state'] == {CARD: 'dismissed'}

    def test_card_states_cannot_reach_another_users_brief(self, world, api_gateway_event, lambda_context):
        now = datetime.now(UTC)
        _ready_brief(world, world.subs['ana'], now, 'm')
        response, _ = _call(world, api_gateway_event, lambda_context, 'PUT', path=f'{PATH}/cards', claims=OTHER,
                            body={'day': now.strftime('%Y-%m-%d'), 'states': {CARD: 'acted'}})
        assert response['statusCode'] == 404

    @pytest.mark.parametrize('body', [
        {'day': '2026-10-17', 'states': {'bad id': 'seen'}},
        {'day': '2026-10-17', 'states': {CARD: 'loved'}},
        {'day': 'today', 'states': {CARD: 'seen'}},
        {'day': '2026-10-17', 'states': {}},
    ])
    def test_bad_card_state_bodies_are_400(self, world, api_gateway_event, lambda_context, body):
        response, _ = _call(world, api_gateway_event, lambda_context, 'PUT', path=f'{PATH}/cards', body=body)
        assert response['statusCode'] == 400
