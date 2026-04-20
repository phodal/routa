#!/usr/bin/env python3
"""
Issue Scanner - Generate a formatted table view of all issues in docs/issues/

Usage:
    python .github/scripts/issue-scanner.py              # Table view
    python .github/scripts/issue-scanner.py --json       # JSON output
    python .github/scripts/issue-scanner.py --check      # Validation only (exit 1 if errors)
"""

import sys
import re
import json
import argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

REPO_ROOT = Path(__file__).resolve().parents[2]
ISSUES_DIR = REPO_ROOT / "docs" / "issues"
REQUIRED_FIELDS = ["title", "date", "status", "area"]
VALID_STATUS = ["open", "investigating", "resolved", "wontfix"]
VALID_SEVERITY = ["info", "low", "medium", "high", "critical"]
VALID_KIND = ["issue", "analysis", "progress_note", "verification_report", "github_mirror"]
ACTIVE_ISSUE_KIND = "issue"
OPEN_REVIEW_AGE_DAYS = 7
OPEN_STALE_AGE_DAYS = 30
INVESTIGATING_STALE_AGE_DAYS = 14


def normalize_string(value):
    return str(value or "").strip()


def normalize_string_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [normalize_string(item) for item in value if normalize_string(item)]
    if isinstance(value, str):
        stripped = normalize_string(value)
        return [stripped] if stripped else []
    return [normalize_string(value)]


def infer_issue_kind(filename, data):
    explicit = normalize_string(data.get("kind"))
    if explicit:
        return explicit, False

    title = normalize_string(data.get("title")).lower()

    if re.match(r"^\d{4}-\d{2}-\d{2}-gh-\d+-", filename):
        return "github_mirror", True
    if title.startswith("[github #"):
        return "github_mirror", True
    if "verification report" in title or "验证报告" in title:
        return "verification_report", True
    if "fixes complete" in title or "fix batch completed" in title or "修复完成报告" in title:
        return "progress_note", True

    return ACTIVE_ISSUE_KIND, True


def parse_frontmatter(content):
    if not content.startswith("---"):
        return None, "Missing front-matter (no opening ---)"
    parts = content.split("---", 2)
    if len(parts) < 3:
        return None, "Malformed front-matter (no closing ---)"
    yaml_content = parts[1].strip()
    if HAS_YAML:
        try:
            return yaml.safe_load(yaml_content), None
        except yaml.YAMLError as e:
            return None, f"YAML parse error: {e}"
    data = {}
    for line in yaml_content.split("\n"):
        if ":" in line and not line.strip().startswith("#"):
            key, value = line.split(":", 1)
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if value.startswith("[") and value.endswith("]"):
                value = [v.strip().strip('"').strip("'") for v in value[1:-1].split(",") if v.strip()]
            data[key] = value
    return data, None


def validate_issue(filename, data):
    errors = []
    for field in REQUIRED_FIELDS:
        if field not in data or not data[field]:
            errors.append(f"Missing required field: {field}")
    kind = normalize_string(data.get("kind"))
    if kind and kind not in VALID_KIND:
        errors.append(f"Invalid kind: {kind}")
    if "status" in data and data["status"] not in VALID_STATUS:
        errors.append(f"Invalid status: {data['status']}")
    if "severity" in data and data["severity"] not in VALID_SEVERITY:
        errors.append(f"Invalid severity: {data['severity']}")
    if "date" in data:
        try:
            datetime.strptime(str(data["date"]), "%Y-%m-%d")
        except ValueError:
            errors.append(f"Invalid date format: {data['date']}")
    date_match = re.match(r"(\d{4}-\d{2}-\d{2})-", filename)
    if date_match and "date" in data and date_match.group(1) != str(data["date"]):
        errors.append(f"Date mismatch: filename={date_match.group(1)}, front-matter={data['date']}")
    return errors


def extract_keywords(filename):
    name = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", filename).replace(".md", "")
    return set(w.lower() for w in name.split("-") if len(w) > 2)


def calculate_age(date_str):
    try:
        return (datetime.now() - datetime.strptime(str(date_str), "%Y-%m-%d")).days
    except ValueError:
        return -1


def scan_issues():
    issues, errors = [], []
    for filepath in sorted(ISSUES_DIR.glob("*.md")):
        if filepath.name == "_template.md":
            continue
        content = filepath.read_text(encoding="utf-8")
        data, parse_error = parse_frontmatter(content)
        if parse_error:
            errors.append({"file": filepath.name, "errors": [parse_error]})
            continue
        validation_errors = validate_issue(filepath.name, data)
        if validation_errors:
            errors.append({"file": filepath.name, "errors": validation_errors})
        kind, kind_inferred = infer_issue_kind(filepath.name, data)
        related_issues = normalize_string_list(data.get("related_issues"))
        github_issue = data.get("github_issue")
        github_issue = None if github_issue in ("", "null", None) else github_issue
        issues.append({
            "file": filepath.name, "title": data.get("title", ""),
            "date": str(data.get("date", "")), "status": data.get("status", ""),
            "severity": data.get("severity", "medium"), "area": data.get("area", ""),
            "tags": data.get("tags", []), "reported_by": data.get("reported_by", ""),
            "age_days": calculate_age(data.get("date", "")),
            "keywords": extract_keywords(filepath.name),
            "kind": kind,
            "kind_inferred": kind_inferred,
            "related_issues": related_issues,
            "github_issue": github_issue,
            "github_state": normalize_string(data.get("github_state")).lower(),
            "github_url": normalize_string(data.get("github_url")),
        })
    return issues, errors


def find_suspects(issues):
    suspects = []
    active_issues = [
        issue for issue in issues
        if issue["kind"] == ACTIVE_ISSUE_KIND and issue["status"] in ("open", "investigating")
    ]
    by_area = defaultdict(list)
    by_github_issue = defaultdict(list)
    for issue in active_issues:
        if issue["area"]:
            by_area[issue["area"]].append(issue)
        if issue["github_issue"] is not None:
            by_github_issue[str(issue["github_issue"])].append(issue)
    for area, area_issues in by_area.items():
        for i, a in enumerate(area_issues):
            for b in area_issues[i+1:]:
                overlap = a["keywords"] & b["keywords"]
                if len(overlap) >= 2:
                    suspects.append({
                        "file_a": a["file"], "file_b": b["file"],
                        "reason": f"Same area '{area}', keywords: {overlap}", "type": "duplicate"
                    })
    for github_issue, grouped_issues in by_github_issue.items():
        if len(grouped_issues) > 1:
            files = sorted(issue["file"] for issue in grouped_issues)
            for index, file_a in enumerate(files):
                for file_b in files[index + 1:]:
                    suspects.append({
                        "file_a": file_a,
                        "file_b": file_b,
                        "reason": f"Multiple active local trackers reference GitHub issue #{github_issue}",
                        "type": "same_github_issue",
                    })
    for issue in issues:
        if issue["kind"] != ACTIVE_ISSUE_KIND:
            continue
        if issue["github_issue"] is not None:
            if not issue["github_state"] or not issue["github_url"]:
                suspects.append({
                    "file_a": issue["file"], "file_b": None,
                    "reason": "GitHub-linked issue is missing github_state or github_url metadata",
                    "type": "metadata",
                })
            elif issue["github_state"] == "closed" and issue["status"] in ("open", "investigating"):
                suspects.append({
                    "file_a": issue["file"], "file_b": None,
                    "reason": "Local issue is still active while linked GitHub issue is closed",
                    "type": "state_drift",
                })
            elif issue["github_state"] == "open" and issue["status"] in ("resolved", "wontfix"):
                suspects.append({
                    "file_a": issue["file"], "file_b": None,
                    "reason": "Local issue is closed while linked GitHub issue is still open",
                    "type": "state_drift",
                })
    # Open issues: need completion check
    for issue in active_issues:
        if issue["status"] == "open":
            if issue["age_days"] > OPEN_STALE_AGE_DAYS:
                suspects.append({
                    "file_a": issue["file"], "file_b": None,
                    "reason": f"Open for {issue['age_days']} days (>{OPEN_STALE_AGE_DAYS}), likely stale",
                    "type": "stale"
                })
            elif issue["age_days"] >= OPEN_REVIEW_AGE_DAYS:
                suspects.append({
                    "file_a": issue["file"], "file_b": None,
                    "reason": f"Open for {issue['age_days']} days (≥{OPEN_REVIEW_AGE_DAYS}), verify if resolved",
                    "type": "open_check"
                })
        elif issue["status"] == "investigating" and issue["age_days"] > INVESTIGATING_STALE_AGE_DAYS:
            suspects.append({
                "file_a": issue["file"], "file_b": None,
                "reason": f"Investigating for {issue['age_days']} days (>{INVESTIGATING_STALE_AGE_DAYS})", "type": "stale"
            })
    return suspects


def print_table(issues, errors, suspects):
    status_emoji = {"open": "🔴", "investigating": "🔍", "resolved": "✅", "wontfix": "⏭️", "duplicate": "🔗"}
    severity_emoji = {"critical": "🔥", "high": "🟠", "medium": "🟡", "low": "🟢", "info": "🔹"}
    kind_emoji = {
        "issue": "🧩",
        "analysis": "📐",
        "progress_note": "📝",
        "verification_report": "🧪",
        "github_mirror": "🪞",
    }

    print("\n" + "=" * 100)
    print("📋 ISSUE SCANNER REPORT")
    print("=" * 100)

    if errors:
        print("\n❌ VALIDATION ERRORS (need AI fix):")
        print("-" * 60)
        for err in errors:
            print(f"  {err['file']}:")
            for e in err["errors"]:
                print(f"    - {e}")

    print("\n📊 ISSUE TABLE:")
    print("-" * 100)
    print(f"{'Status':<12} {'Kind':<10} {'Sev':<4} {'Date':<12} {'Area':<18} {'Title':<36}")
    print("-" * 100)

    for issue in issues:
        status = status_emoji.get(issue["status"], "❓") + " " + issue["status"][:6]
        kind = kind_emoji.get(issue["kind"], "❓") + " " + issue["kind"][:8]
        severity = severity_emoji.get(issue["severity"], "❓")
        title = issue["title"][:34] + ".." if len(issue["title"]) > 36 else issue["title"]
        area = issue["area"][:16] + ".." if len(issue["area"]) > 18 else issue["area"]
        print(f"{status:<12} {kind:<10} {severity:<4} {issue['date']:<12} {area:<18} {title:<36}")

    print("-" * 100)
    print(f"Total: {len(issues)} issues")

    print("\n📈 SUMMARY BY STATUS:")
    status_counts = defaultdict(int)
    for issue in issues:
        status_counts[issue["status"]] += 1
    for status, count in sorted(status_counts.items()):
        print(f"  {status_emoji.get(status, '❓')} {status}: {count}")

    print("\n📚 SUMMARY BY KIND:")
    kind_counts = defaultdict(int)
    for issue in issues:
        kind_counts[issue["kind"]] += 1
    for kind, count in sorted(kind_counts.items()):
        print(f"  {kind_emoji.get(kind, '❓')} {kind}: {count}")

    active_local_count = sum(
        1 for issue in issues if issue["kind"] == ACTIVE_ISSUE_KIND and issue["status"] in ("open", "investigating")
    )
    print(f"\n🎯 Active Local Trackers: {active_local_count}")

    if suspects:
        print("\n⚠️  SUSPECTS (need Phase 2 deep analysis):")
        print("-" * 60)
        duplicates = [s for s in suspects if s["type"] == "duplicate"]
        same_github_issue = [s for s in suspects if s["type"] == "same_github_issue"]
        metadata = [s for s in suspects if s["type"] == "metadata"]
        state_drifts = [s for s in suspects if s["type"] == "state_drift"]
        open_checks = [s for s in suspects if s["type"] == "open_check"]
        stales = [s for s in suspects if s["type"] == "stale"]

        if duplicates:
            print("\n  🔗 Potential Duplicates:")
            for s in duplicates:
                print(f"    - {s['file_a']}")
                print(f"      ↔ {s['file_b']}")
                print(f"      Reason: {s['reason']}")

        if same_github_issue:
            print("\n  🪢 Same GitHub Issue Referenced By Multiple Active Trackers:")
            for s in same_github_issue:
                print(f"    - {s['file_a']}")
                print(f"      ↔ {s['file_b']}")
                print(f"      Reason: {s['reason']}")

        if metadata:
            print("\n  🏷️  Metadata Gaps:")
            for s in metadata:
                print(f"    - {s['file_a']}: {s['reason']}")

        if state_drifts:
            print("\n  🔄 GitHub / Local State Drift:")
            for s in state_drifts:
                print(f"    - {s['file_a']}: {s['reason']}")

        if open_checks:
            print("\n  🔴 Open Issues (verify if resolved):")
            for s in open_checks:
                print(f"    - {s['file_a']}: {s['reason']}")

        if stales:
            print("\n  ⏰ Stale Issues (needs triage):")
            for s in stales:
                print(f"    - {s['file_a']}: {s['reason']}")

    print("\n" + "=" * 100)


def update_issue(filepath, field, value):
    """Update a field in issue front-matter."""
    content = filepath.read_text(encoding="utf-8")
    if not content.startswith("---"):
        print(f"❌ {filepath.name}: No front-matter found")
        return False

    parts = content.split("---", 2)
    if len(parts) < 3:
        print(f"❌ {filepath.name}: Malformed front-matter")
        return False

    yaml_lines = parts[1].strip().split("\n")
    updated = False
    new_lines = []

    for line in yaml_lines:
        if line.startswith(f"{field}:"):
            old_value = line.split(":", 1)[1].strip()
            new_lines.append(f"{field}: {value}")
            print(f"✅ {filepath.name}: {field}: {old_value} → {value}")
            updated = True
        else:
            new_lines.append(line)

    if not updated:
        # Field doesn't exist, add it
        new_lines.append(f"{field}: {value}")
        print(f"✅ {filepath.name}: +{field}: {value}")
        updated = True

    new_content = "---\n" + "\n".join(new_lines) + "\n---" + parts[2]
    filepath.write_text(new_content, encoding="utf-8")
    return True


def batch_update(files, field, value):
    """Update multiple issues at once."""
    success = 0
    for filename in files:
        filepath = ISSUES_DIR / filename
        if not filepath.exists():
            print(f"❌ {filename}: File not found")
            continue
        if update_issue(filepath, field, value):
            success += 1
    print(f"\n📊 Updated {success}/{len(files)} files")
    return success


def main():
    parser = argparse.ArgumentParser(description="Scan and validate issues in docs/issues/")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--check", action="store_true", help="Validation only, exit 1 if errors")
    parser.add_argument("--suspects-only", action="store_true", help="Only show suspects")

    # Update commands
    parser.add_argument("--set", nargs=2, metavar=("FIELD", "VALUE"),
                        help="Set a field value, e.g., --set status resolved")
    parser.add_argument("--files", nargs="+", metavar="FILE",
                        help="Files to update (use with --set)")
    parser.add_argument("--resolve", nargs="+", metavar="FILE",
                        help="Quick resolve: set status=resolved for files")
    parser.add_argument("--close", nargs="+", metavar="FILE",
                        help="Quick close: set status=wontfix for files")

    args = parser.parse_args()

    # Handle update commands
    if args.resolve:
        batch_update(args.resolve, "status", "resolved")
        return

    if args.close:
        batch_update(args.close, "status", "wontfix")
        return

    if args.set:
        if not args.files:
            print("❌ --set requires --files")
            sys.exit(1)
        batch_update(args.files, args.set[0], args.set[1])
        return

    # Scan mode
    issues, errors = scan_issues()
    suspects = find_suspects(issues)

    if args.json:
        output = {
            "issues": [{k: list(v) if k == "keywords" else v for k, v in i.items()} for i in issues],
            "errors": errors, "suspects": suspects,
            "summary": {
                "total": len(issues),
                "active_local_trackers": sum(
                    1 for issue in issues if issue["kind"] == ACTIVE_ISSUE_KIND and issue["status"] in ("open", "investigating")
                ),
                "errors": len(errors),
                "suspects": len(suspects),
            }
        }
        print(json.dumps(output, indent=2, ensure_ascii=False))
    elif args.suspects_only:
        print(json.dumps(suspects, indent=2, ensure_ascii=False) if suspects else "No suspects found.")
    else:
        print_table(issues, errors, suspects)

    if args.check and errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
