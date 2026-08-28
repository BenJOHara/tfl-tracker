#!/usr/bin/env python3
"""Collect TfL line disruptions into a tiny JSON history file.

Python 3.9+; standard library only.
"""

from __future__ import annotations

import hashlib
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STATE_PATH = ROOT / "site" / "data" / "state.json"
MODES = "tube,overground,dlr,elizabeth-line,tram"
GOOD_SEVERITIES = {"good service", "special service"}

CATEGORY_RULES = [
    ("signal failure", ("signal failure", "signalling failure", "signal fault", "signalling fault")),
    ("points failure", ("points failure", "points fault", "faulty points")),
    ("train fault", ("faulty train", "train fault", "defective train")),
    ("track fault", ("track fault", "track failure")),
    ("power failure", ("power failure", "power supply", "loss of power")),
    ("person on track", ("person on the track", "person on track", "trespasser")),
    ("passenger incident", ("passenger incident", "customer incident", "ill passenger")),
    ("police incident", ("police incident", "police investigation")),
    ("fire alert", ("fire alert", "fire alarm")),
    ("staff shortage", ("staff shortage", "shortage of staff", "staff availability")),
    ("planned engineering", ("engineering work", "planned closure", "planned works")),
    ("weather", ("adverse weather", "weather conditions", "flooding", "high winds")),
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def clean_text(value: Any) -> str:
    return " ".join(str(value or "").split())


def classify_reason(reason: str) -> str:
    lowered = reason.lower()
    for category, phrases in CATEGORY_RULES:
        if any(phrase in lowered for phrase in phrases):
            return category
    return "other"


def normalise_reason(reason: str) -> str:
    value = reason.lower()
    value = re.sub(r"\b(?:due to|because of|caused by)\b", " ", value)
    value = re.sub(r"\b(?:minor|severe) delays?\b", " ", value)
    value = re.sub(r"\bpart suspended\b|\bsuspended\b", " ", value)
    value = re.sub(r"\d+", "#", value)
    value = re.sub(r"[^a-z0-9#]+", " ", value)
    return " ".join(value.split())[:220]


def make_issue_key(line_id: str, status: dict[str, Any], reason: str) -> str:
    status_id = status.get("id")
    if status_id not in (None, "", 0, "0"):
        return f"{line_id}:status:{status_id}"
    fingerprint = hashlib.sha1(normalise_reason(reason).encode("utf-8")).hexdigest()[:16]
    return f"{line_id}:text:{fingerprint}"


def fetch_status() -> list[dict[str, Any]]:
    url = f"https://api.tfl.gov.uk/Line/Mode/{urllib.parse.quote(MODES, safe=',')}/Status"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "tfl-incident-tracker/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
    if not isinstance(payload, list):
        raise RuntimeError("Unexpected TfL response")
    return payload


def extract_incidents(lines: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    incidents: dict[str, dict[str, Any]] = {}
    for line in lines:
        line_id = clean_text(line.get("id"))
        line_name = clean_text(line.get("name")) or line_id
        for status in line.get("lineStatuses") or []:
            severity = clean_text(status.get("statusSeverityDescription")) or "Unknown"
            reason = clean_text(status.get("reason"))
            if severity.lower() in GOOD_SEVERITIES and not reason:
                continue
            if not reason:
                reason = severity
            disruption = status.get("disruption") or {}
            source_created = clean_text(status.get("created")) or clean_text(disruption.get("created")) or None
            issue_key = make_issue_key(line_id, status, reason)
            incidents[issue_key] = {
                "issue_key": issue_key,
                "line_id": line_id,
                "line_name": line_name,
                "severity": severity,
                "reason": reason,
                "category": classify_reason(reason),
                "source_created": source_created,
            }
    return incidents


def empty_state() -> dict[str, Any]:
    return {"version": 1, "active": {}, "history": [], "updated_at": None}


def load_state() -> dict[str, Any]:
    if not STATE_PATH.exists():
        return empty_state()
    with STATE_PATH.open("r", encoding="utf-8") as file:
        state = json.load(file)
    state.setdefault("active", {})
    state.setdefault("history", [])
    return state


def first_seen_for(item: dict[str, Any], now: datetime) -> str:
    source_created = parse_iso(item.get("source_created"))
    if source_created and source_created <= now:
        return isoformat(source_created)
    return isoformat(now)


def update_state(state: dict[str, Any], current: dict[str, dict[str, Any]], now: datetime) -> bool:
    active = state["active"]
    history = state["history"]
    changed = False

    for issue_key in list(active):
        if issue_key in current:
            continue
        incident = active.pop(issue_key)
        first_seen = parse_iso(incident.get("first_seen")) or now
        incident["resolved_at"] = isoformat(now)
        incident["duration_seconds"] = max(0, int((now - first_seen).total_seconds()))
        history.append(incident)
        changed = True

    for issue_key, item in current.items():
        existing = active.get(issue_key)
        if existing is None:
            active[issue_key] = {**item, "first_seen": first_seen_for(item, now)}
            changed = True
            continue

        for field in ("line_name", "severity", "reason", "category", "source_created"):
            if existing.get(field) != item.get(field):
                existing[field] = item.get(field)
                changed = True

    history.sort(key=lambda incident: incident.get("resolved_at") or "", reverse=True)
    if len(history) > 5000:
        del history[5000:]
        changed = True

    if changed:
        state["updated_at"] = isoformat(now)
    return changed


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = STATE_PATH.with_suffix(".tmp")
    with temporary_path.open("w", encoding="utf-8") as file:
        json.dump(state, file, ensure_ascii=False, indent=2, sort_keys=True)
        file.write("\n")
    temporary_path.replace(STATE_PATH)


def main() -> None:
    state = load_state()
    current = extract_incidents(fetch_status())
    if update_state(state, current, utc_now()):
        save_state(state)
        print(f"State changed: {len(current)} active, {len(state['history'])} resolved")
    else:
        print(f"No incident changes: {len(current)} active")


if __name__ == "__main__":
    main()
