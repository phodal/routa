#!/usr/bin/env python3
"""
Issue Scanner - Generate a formatted table view of all issues in docs/issues/

Usage:
    python scripts/issue-scanner.py              # Table view
    python scripts/issue-scanner.py --json       # JSON output
    python scripts/issue-scanner.py --check      # Validation only (exit 1 if errors)
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

ISSUES_DIR = Path(__file__).parent.parent / "docs" / "issues"
REQUIRED_FIELDS = ["title", "date", "status", "area"]
VALID_STATUS = ["open", "investigating", "resolved", "wontfix", "duplicate"]
VALID_SEVERITY = ["low", "medium", "high", "critical"]


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
        issues.append({
            "file": filepath.name, "title": data.get("title", ""),
            "date": str(data.get("date", "")), "status": data.get("status", ""),
            "severity": data.get("severity", "medium"), "area": data.get("area", ""),
            "tags": data.get("tags", []), "reported_by": data.get("reported_by", ""),
            "age_days": calculate_age(data.get("date", "")),
            "keywords": extract_keywords(filepath.name),
        })
    return issues, errors


def find_suspects(issues):
    suspects = []
    by_area = defaultdict(list)
    for issue in issues:
        if issue["area"]:
            by_area[issue["area"]].append(issue)
    for area, area_issues in by_area.items():
        for i, a in enumerate(area_issues):
            for b in area_issues[i+1:]:
                overlap = a["keywords"] & b["keywords"]
                if len(overlap) >= 2:
                    suspects.append({
                        "file_a": a["file"], "file_b": b["file"],
                        "reason": f"Same area '{area}', keywords: {overlap}", "type": "duplicate"
                    })
    # Open issues: need completion check
    for issue in issues:
        if issue["status"] == "open":
            if issue["age_days"] > 30:
                suspects.append({
                    "file_a": issue["file"], "file_b": None,
                    "reason": f"Open for {issue['age_days']} days (>30), likely stale",
                    "type": "stale"
                })
            else:
                suspects.append({
                    "file_a": issue["file"], "file_b": None,
                    "reason": f"Open for {issue['age_days']} days, verify if resolved",
                    "type": "open_check"
                })
        elif issue["status"] == "investigating" and issue["age_days"] > 14:
            suspects.append({
                "file_a": issue["file"], "file_b": None,
                "reason": f"Investigating for {issue['age_days']} days (>14)", "type": "stale"
            })
    return suspects


def print_table(issues, errors, suspects):
    status_emoji = {"open": "🔴", "investigating": "🔍", "resolved": "✅", "wontfix": "⏭️", "duplicate": "🔗"}
    severity_emoji = {"critical": "🔥", "high": "🟠", "medium": "🟡", "low": "🟢"}

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
    print(f"{'Status':<12} {'Sev':<4} {'Date':<12} {'Area':<18} {'Title':<48}")
    print("-" * 100)

    for issue in issues:
        status = status_emoji.get(issue["status"], "❓") + " " + issue["status"][:6]
        severity = severity_emoji.get(issue["severity"], "❓")
        title = issue["title"][:46] + ".." if len(issue["title"]) > 48 else issue["title"]
        area = issue["area"][:16] + ".." if len(issue["area"]) > 18 else issue["area"]
        print(f"{status:<12} {severity:<4} {issue['date']:<12} {area:<18} {title:<48}")

    print("-" * 100)
    print(f"Total: {len(issues)} issues")

    print("\n📈 SUMMARY BY STATUS:")
    status_counts = defaultdict(int)
    for issue in issues:
        status_counts[issue["status"]] += 1
    for status, count in sorted(status_counts.items()):
        print(f"  {status_emoji.get(status, '❓')} {status}: {count}")

    if suspects:
        print("\n⚠️  SUSPECTS (need Phase 2 deep analysis):")
        print("-" * 60)
        duplicates = [s for s in suspects if s["type"] == "duplicate"]
        open_checks = [s for s in suspects if s["type"] == "open_check"]
        stales = [s for s in suspects if s["type"] == "stale"]

        if duplicates:
            print("\n  🔗 Potential Duplicates:")
            for s in duplicates:
                print(f"    - {s['file_a']}")
                print(f"      ↔ {s['file_b']}")
                print(f"      Reason: {s['reason']}")

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
            "summary": {"total": len(issues), "errors": len(errors), "suspects": len(suspects)}
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

