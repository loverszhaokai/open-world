import json
import unittest
from unittest.mock import Mock
from slack_scan_source import ensure_scan_label, plan_scan_backfill, SCAN_LABEL

COMPANY = "company"
LABEL = {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "companyId": COMPANY, "name": SCAN_LABEL}


class ScanSourceTest(unittest.TestCase):
    def test_reuses_existing_label_without_writes(self):
        curl = Mock(return_value=json.dumps([LABEL]))
        self.assertEqual(ensure_scan_label(curl, "http://local", COMPANY), LABEL["id"])
        self.assertEqual(curl.call_count, 1)

    def test_creates_missing_label(self):
        curl = Mock(side_effect=["[]", json.dumps(LABEL)])
        self.assertEqual(ensure_scan_label(curl, "http://local", COMPANY), LABEL["id"])
        self.assertEqual(curl.call_args.args[0][0:2], ["-X", "POST"])
        self.assertEqual(json.loads(curl.call_args.args[1])["name"], SCAN_LABEL)

    def test_refuses_unlabeled_scans_on_api_error(self):
        for responses in [[json.dumps({"error": "unauthorized"})], ["[]", json.dumps({"error": "forbidden"})]]:
            with self.subTest(responses=responses):
                with self.assertRaises(ValueError):
                    ensure_scan_label(Mock(side_effect=responses), "http://local", COMPANY)

    def test_rejects_foreign_label(self):
        curl = Mock(return_value=json.dumps([{**LABEL, "companyId": "other"}]))
        with self.assertRaises(ValueError):
            ensure_scan_label(curl, "http://local", COMPANY)

    def test_backfill_uses_recorded_ids_and_preserves_existing_labels(self):
        scan_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        manual_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        rows = [{"issue_id": scan_id}, {"issue_id": scan_id}]
        issues = [
            {"id": scan_id, "companyId": COMPANY, "labelIds": ["keep"]},
            {"id": manual_id, "companyId": COMPANY, "title": "扫描 Slack 新消息"},
        ]
        self.assertEqual(plan_scan_backfill(rows, issues, COMPANY, LABEL["id"]), [
            {"issueId": scan_id, "patch": {"labelIds": ["keep", LABEL["id"]]}}
        ])
        self.assertEqual(issues[0]["labelIds"], ["keep"])

    def test_backfill_rejects_missing_or_foreign_issues(self):
        scan_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        for issues in [[], [{"id": scan_id, "companyId": "other"}]]:
            with self.assertRaises(ValueError):
                plan_scan_backfill([{"issue_id": scan_id}], issues, COMPANY, LABEL["id"])

    def test_backfill_is_idempotent(self):
        scan_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        self.assertEqual(plan_scan_backfill(
            [{"issue_id": scan_id}],
            [{"id": scan_id, "companyId": COMPANY, "labelIds": [LABEL["id"]]}],
            COMPANY, LABEL["id"],
        ), [])


if __name__ == "__main__":
    unittest.main()
