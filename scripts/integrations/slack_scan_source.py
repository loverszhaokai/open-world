"""Source labeling for the local Slack scan producer.

Deploy next to wake.py and apply slack-watch-source-label.patch. This module
performs no requests at import time; it reuses the producer's authenticated curl.
Only housekeeping scans get this label, never the real tasks discovered by them.
"""
import json
import uuid

SCAN_LABEL = "automation:scan"


def ensure_scan_label(curl, base, company_id):
    endpoint = "%s/api/companies/%s/labels" % (base.rstrip("/"), company_id)
    rows = json.loads(curl([endpoint]))
    if not isinstance(rows, list):
        raise ValueError("Cannot read scan labels; refusing to create an unmarked scan")
    for row in rows:
        if row.get("name") == SCAN_LABEL:
            label_id = str(uuid.UUID(row["id"]))
            if row.get("companyId") != company_id:
                raise ValueError("Scan label belongs to another company")
            return label_id
    created = json.loads(curl(
        ["-X", "POST", endpoint],
        json.dumps({"name": SCAN_LABEL, "color": "#808080"}),
    ))
    if created.get("name") != SCAN_LABEL or created.get("companyId") != company_id:
        raise ValueError("Could not create scan label; refusing to create an unmarked scan")
    return str(uuid.UUID(created["id"]))


def plan_scan_backfill(wake_records, issues, company_id, label_id):
    """Build reviewable PATCH payloads from the producer's successful wake log.

    Never infer scan identity from a task title. Callers fetch only the recorded
    IDs from wakes.jsonl; missing/foreign issues abort instead of silently
    generating a partial or cross-company plan. This function performs no writes.
    """
    label_id = str(uuid.UUID(label_id))
    ids = {str(uuid.UUID(row["issue_id"])) for row in wake_records if row.get("issue_id")}
    by_id = {row["id"]: row for row in issues}
    plan = []
    for issue_id in sorted(ids):
        issue = by_id.get(issue_id)
        if not issue or issue.get("companyId") != company_id:
            raise ValueError("Recorded scan is missing or belongs to another company")
        existing = list(issue.get("labelIds") or [])
        if label_id not in existing:
            plan.append({"issueId": issue_id, "patch": {"labelIds": [*existing, label_id]}})
    return plan
