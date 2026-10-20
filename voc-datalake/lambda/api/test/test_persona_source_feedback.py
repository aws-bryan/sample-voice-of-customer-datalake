"""
GET  /projects/<id>/personas/<persona_id>/feedback   — the feedback a persona came from
POST /projects/<id>/personas/preview-feedback         — how much feedback a request matches
"""
import json
from unittest.mock import MagicMock, patch


PERSONA_ROW = {
    'persona_id': 'p1',
    'evidence_feedback_ids': ['fb2', 'fb5'],
    'input_feedback_ids': [f'fb{i}' for i in range(1, 11)],
    'feedback_provenance': {
        'items_used': 10, 'items_matched': 900,
        'matched_is_lower_bound': False, 'sample_limit': 145,
    },
}


def _get(api_gateway_event, lambda_context, *, row, query=None, found=None, missing=None):
    """Call the GET route with ``row`` as the stored persona (None = absent)."""
    from projects_handler import lambda_handler

    table = MagicMock()
    table.get_item.return_value = {'Item': row} if row is not None else {}
    lookup = MagicMock(side_effect=lambda _table, ids: (
        [{'feedback_id': i} for i in ids if i not in (missing or [])],
        [i for i in ids if i in (missing or [])],
    ))
    event = api_gateway_event(
        method='GET',
        path='/projects/proj-1/personas/p1/feedback',
        path_params={'project_id': 'proj-1', 'persona_id': 'p1'},
        query_params=query or {},
    )
    with patch('projects.projects_table', table), \
         patch('projects._get_feedback_by_ids', lookup):
        response = lambda_handler(event, lambda_context)
    return response, json.loads(response['body']), table, lookup


class TestPersonaSourceFeedbackRoute:
    def test_cited_scope_returns_the_reviews_this_persona_cites(self, api_gateway_event, lambda_context):
        response, body, table, _ = _get(api_gateway_event, lambda_context,
                                        row=PERSONA_ROW, query={'scope': 'cited'})

        assert response['statusCode'] == 200
        assert body['available'] is True
        assert [i['feedback_id'] for i in body['items']] == ['fb2', 'fb5']
        assert body['total'] == 2
        assert body['provenance']['items_matched'] == 900
        # Only the requested list is read off the row, not the whole persona.
        assert table.get_item.call_args.kwargs['ExpressionAttributeNames'] == {
            '#ids': 'evidence_feedback_ids',
        }

    def test_cited_is_the_default_scope(self, api_gateway_event, lambda_context):
        _, body, _, _ = _get(api_gateway_event, lambda_context, row=PERSONA_ROW)
        assert body['scope'] == 'cited'

    def test_used_scope_pages_through_the_whole_batch_input(self, api_gateway_event, lambda_context):
        _, body, _, lookup = _get(api_gateway_event, lambda_context, row=PERSONA_ROW,
                                  query={'scope': 'used', 'offset': '4', 'limit': '3'})

        assert [i['feedback_id'] for i in body['items']] == ['fb5', 'fb6', 'fb7']
        assert body['total'] == 10
        assert body['offset'] == 4
        lookup.assert_called_once()

    def test_reports_feedback_deleted_since_generation(self, api_gateway_event, lambda_context):
        _, body, _, _ = _get(api_gateway_event, lambda_context, row=PERSONA_ROW,
                             query={'scope': 'cited'}, missing=['fb5'])

        assert [i['feedback_id'] for i in body['items']] == ['fb2']
        assert body['missing'] == 1

    def test_a_persona_from_before_tracking_is_unavailable_not_empty(
        self, api_gateway_event, lambda_context,
    ):
        """Its "Review #N" citations point into a list nothing kept."""
        _, body, _, lookup = _get(api_gateway_event, lambda_context,
                                  row={'persona_id': 'p1'}, query={'scope': 'cited'})

        assert body['available'] is False
        assert body['items'] == []
        lookup.assert_not_called()

    def test_an_unknown_scope_is_a_400(self, api_gateway_event, lambda_context):
        response, body, _, _ = _get(api_gateway_event, lambda_context,
                                    row=PERSONA_ROW, query={'scope': 'everything'})
        assert response['statusCode'] == 400
        assert 'scope' in body['error']

    def test_a_missing_persona_is_a_404(self, api_gateway_event, lambda_context):
        response, _, _, _ = _get(api_gateway_event, lambda_context, row=None)
        assert response['statusCode'] == 404

    def test_the_page_size_is_capped(self, api_gateway_event, lambda_context):
        """Each id is one lookup, so a huge limit must not reach the table."""
        from projects_handler import PERSONA_FEEDBACK_PAGE_MAX

        row = {**PERSONA_ROW, 'input_feedback_ids': [f'fb{i}' for i in range(500)]}
        _, body, _, _ = _get(api_gateway_event, lambda_context, row=row,
                             query={'scope': 'used', 'limit': '10000'})
        assert len(body['items']) == PERSONA_FEEDBACK_PAGE_MAX


class TestPersonaFeedbackPreviewRoute:
    @staticmethod
    def _post(api_gateway_event, lambda_context, body, pool):
        from projects_handler import lambda_handler

        event = api_gateway_event(
            method='POST',
            path='/projects/proj-1/personas/preview-feedback',
            path_params={'project_id': 'proj-1'},
            body=body,
        )
        with patch('projects._read_feedback_pool', return_value=pool) as read:
            response = lambda_handler(event, lambda_context)
        return response, json.loads(response['body']), read

    def test_returns_the_match_count_and_the_sample_limit(self, api_gateway_event, lambda_context):
        import projects

        response, body, _ = self._post(api_gateway_event, lambda_context,
                                       {'days': 30}, ([{}] * 900, False))

        assert response['statusCode'] == 200
        assert body == {
            'matched': 900,
            'matched_is_lower_bound': False,
            'sample_limit': projects.persona_context_budget()[1],
        }

    def test_counts_with_the_same_scope_generation_uses(self, api_gateway_event, lambda_context):
        """The shared-model filters reach the count exactly as they reach a job."""
        _, _, read = self._post(api_gateway_event, lambda_context, {
            'days': 14,
            'sentiments': ['negative'],
            'custom_fields': {'tier_status': ['Gold']},
            'urgent': True,
        }, ([], False))

        filters = read.call_args.args[1]
        assert filters['days'] == 14
        assert filters['sentiments'] == ['negative']
        assert filters['feedback_filters'] == {
            'urgent': True, 'custom_fields': {'tier_status': ['Gold']},
        }

    def test_reports_a_lower_bound_count(self, api_gateway_event, lambda_context):
        _, body, _ = self._post(api_gateway_event, lambda_context, {}, ([{}] * 3, True))
        assert body['matched_is_lower_bound'] is True

    def test_the_count_is_bounded_to_answer_inside_the_request_timeout(
        self, api_gateway_event, lambda_context,
    ):
        """The projects Lambda times out at 30s, so the read must stop well before."""
        import time

        import projects

        before = time.monotonic()
        _, _, read = self._post(api_gateway_event, lambda_context, {}, ([], False))

        deadline = read.call_args.kwargs['deadline']
        assert before < deadline <= time.monotonic() + projects.PERSONA_PREVIEW_READ_SECONDS
        assert projects.PERSONA_PREVIEW_READ_SECONDS < 29
