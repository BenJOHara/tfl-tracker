#!/usr/bin/env python3

import unittest
from datetime import datetime, timedelta, timezone

import collector


class CollectorTests(unittest.TestCase):
    def test_good_service_is_ignored(self):
        lines = [{
            "id": "northern",
            "name": "Northern",
            "lineStatuses": [{"id": 1, "statusSeverityDescription": "Good Service"}],
        }]
        self.assertEqual(collector.extract_incidents(lines), {})

    def test_incident_resolves_when_missing(self):
        now = datetime(2026, 8, 28, 16, 0, tzinfo=timezone.utc)
        state = collector.empty_state()
        state["active"] = {
            "northern:status:1": {
                "issue_key": "northern:status:1",
                "line_id": "northern",
                "line_name": "Northern",
                "severity": "Severe Delays",
                "reason": "Signal failure",
                "category": "signal failure",
                "source_created": None,
                "first_seen": collector.isoformat(now - timedelta(minutes=40)),
            }
        }
        changed = collector.update_state(state, {}, now)
        self.assertTrue(changed)
        self.assertEqual(state["active"], {})
        self.assertEqual(state["history"][0]["duration_seconds"], 2400)

    def test_existing_incident_does_not_change_without_message_update(self):
        now = datetime(2026, 8, 28, 16, 0, tzinfo=timezone.utc)
        item = {
            "issue_key": "northern:status:1",
            "line_id": "northern",
            "line_name": "Northern",
            "severity": "Severe Delays",
            "reason": "Signal failure",
            "category": "signal failure",
            "source_created": None,
        }
        state = collector.empty_state()
        collector.update_state(state, {item["issue_key"]: item}, now)
        state["updated_at"] = None
        self.assertFalse(collector.update_state(state, {item["issue_key"]: item}, now + timedelta(minutes=5)))


if __name__ == "__main__":
    unittest.main()
