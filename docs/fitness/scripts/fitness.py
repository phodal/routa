#!/usr/bin/env python3
"""
Fitness Function Runner

Scans docs/fitness/*.md files, parses YAML frontmatter,
executes metrics commands, and outputs results to terminal.

Usage:
    python3 docs/fitness/scripts/fitness.py [--dry-run]
"""

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

def run_metric(metric: dict, dry_run: bool = False) -> tuple[str, bool, str]:
    """Run a single metric command and check result."""
    name = metric.get('name', 'unknown')
    command = metric.get('command', '')
    pattern = metric.get('pattern', '')
    hard_gate = metric.get('hard_gate', False)
    
    if dry_run:
        return name, True, f"[DRY-RUN] Would run: {command}"
    
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=300
        )
        output = result.stdout + result.stderr
        
        if pattern:
            passed = bool(re.search(pattern, output, re.IGNORECASE))
        else:
            passed = result.returncode == 0
            
        return name, passed, output[:500]  # Truncate output
    except subprocess.TimeoutExpired:
        return name, False, "TIMEOUT"
    except Exception as e:
        return name, False, str(e)

def main():
    dry_run = '--dry-run' in sys.argv
    fitness_dir = Path(__file__).parent.parent
    
    print("=" * 60)
    print("FITNESS FUNCTION REPORT")
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
        
        for metric in fm.get('metrics', []):
            name, passed, output = run_metric(metric, dry_run)
            status = "✅ PASS" if passed else "❌ FAIL"
            hard = " [HARD GATE]" if metric.get('hard_gate') else ""
            
            print(f"   - {name}: {status}{hard}")
            
            if not passed and metric.get('hard_gate'):
                hard_gate_failed.append(name)
                
            dim_passed += 1 if passed else 0
            dim_total += 1
        
        if dim_total > 0:
            dim_score = (dim_passed / dim_total) * 100
            total_score += dim_score * weight
            total_weight += weight
            print(f"   Score: {dim_score:.0f}%")
    
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

