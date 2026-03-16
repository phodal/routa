#!/usr/bin/env python3
"""
Fitness Function Runner

Scans docs/fitness/*.md files, parses YAML frontmatter,
executes metrics commands, and outputs results to terminal.

Usage:
    python3 docs/fitness/scripts/fitness.py [--dry-run] [--verbose] [--help]

Options:
    --dry-run   Show what would be executed without running
    --verbose   Show command output on failure
    --help      Show this help message
"""

import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

def parse_frontmatter(content: str) -> dict | None:
    """Extract YAML frontmatter from markdown content."""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return None
    return yaml.safe_load(match.group(1))

def run_metric(metric: dict, dry_run: bool = False, verbose: bool = False) -> tuple[str, str, str]:
    """Run a single metric command and check result."""
    name = metric.get('name', 'unknown')
    command = metric.get('command', '')
    pattern = metric.get('pattern', '')
    blocked_pattern = metric.get('blocked_pattern', '')

    if dry_run:
        return name, "pass", f"[DRY-RUN] Would run: {command}"

    try:
        env = os.environ.copy()
        env.setdefault("npm_config_cache", "/tmp/routa-npm-cache")
        env.setdefault("CARGO_HOME", str(Path.home() / ".cargo"))

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=300,
            shell=True,
            executable="/bin/bash",
            env=env,
        )
        output = result.stdout + result.stderr

        if blocked_pattern and re.search(blocked_pattern, output, re.IGNORECASE):
            return name, "blocked", output[:500]

        uses_exit_override = "||" in command
        if pattern:
            matched = bool(re.search(pattern, output, re.IGNORECASE))
            passed = matched or (result.returncode == 0 and not uses_exit_override)
        else:
            passed = result.returncode == 0

        # Return more output in verbose mode
        max_len = 2000 if verbose else 500
        return name, "pass" if passed else "fail", output[:max_len]
    except subprocess.TimeoutExpired:
        return name, "fail", "TIMEOUT (300s)"
    except Exception as e:
        return name, "fail", str(e)

def print_help():
    print(__doc__)
    sys.exit(0)

def main():
    if '--help' in sys.argv:
        print_help()

    dry_run = '--dry-run' in sys.argv
    verbose = '--verbose' in sys.argv
    fitness_dir = Path(__file__).parent.parent

    print("=" * 60)
    print("FITNESS FUNCTION REPORT")
    if dry_run:
        print("(DRY-RUN MODE)")
    print("=" * 60)
    
    total_score = 0
    total_weight = 0
    hard_gate_failed = []
    
    for md_file in sorted(fitness_dir.glob('*.md')):
        if md_file.name == 'README.md':
            continue
            
        content = md_file.read_text()
        fm = parse_frontmatter(content)
        
        if not fm or 'metrics' not in fm:
            continue
            
        dimension = fm.get('dimension', 'unknown')
        weight = fm.get('weight', 0)
        
        print(f"\n## {dimension.upper()} (weight: {weight}%)")
        print(f"   Source: {md_file.name}")
        
        dim_passed = 0
        dim_total = 0
        dim_blocked = 0

        for metric in fm.get('metrics', []):
            name, outcome, output = run_metric(metric, dry_run, verbose)
            passed = outcome == "pass"
            blocked = outcome == "blocked"
            status = "✅ PASS" if passed else ("⚠️ BLOCKED" if blocked else "❌ FAIL")
            hard = " [HARD GATE]" if metric.get('hard_gate') else ""

            print(f"   - {name}: {status}{hard}")

            # Show output on failure (or in verbose mode)
            if (not passed or blocked) and (verbose or metric.get('hard_gate')):
                print(f"     Command: {metric.get('command', '')}")
                if output and output != "TIMEOUT (300s)":
                    # Indent output
                    for line in output.strip().split('\n')[:10]:
                        print(f"     > {line}")
                    if output.count('\n') > 10:
                        print(f"     > ... ({output.count(chr(10)) - 10} more lines)")

            if not passed and not blocked and metric.get('hard_gate'):
                hard_gate_failed.append(name)

            if blocked:
                dim_blocked += 1
                continue

            dim_passed += 1 if passed else 0
            dim_total += 1

        if dim_total > 0:
            dim_score = (dim_passed / dim_total) * 100
            total_score += dim_score * weight
            total_weight += weight
            print(f"   Score: {dim_score:.0f}%")
            if dim_blocked > 0:
                print(f"   Blocked: {dim_blocked}")
    
    print("\n" + "=" * 60)
    
    if hard_gate_failed:
        print(f"❌ HARD GATES FAILED: {', '.join(hard_gate_failed)}")
        print("   Cannot proceed until hard gates pass.")
        sys.exit(2)
    
    if total_weight > 0:
        final_score = total_score / total_weight
        print(f"FINAL SCORE: {final_score:.1f}%")
        
        if final_score >= 90:
            print("✅ PASS")
        elif final_score >= 80:
            print("⚠️  WARN - Consider improvements")
        else:
            print("❌ BLOCK - Score too low")
            sys.exit(1)
    
    print("=" * 60)

if __name__ == '__main__':
    main()
