use crate::models::{AgentStats, DetectedAgent};
use anyhow::{Context, Result};
use std::collections::{BTreeMap, HashMap};
use std::process::Command;

const MAX_AGENTS: usize = 8;
const ACTIVE_CPU_THRESHOLD: f32 = 1.0;

pub fn scan_agents(repo_root: &str) -> Result<Vec<DetectedAgent>> {
    let output = Command::new("ps")
        .args(["-axo", "pid=,ppid=,%cpu=,rss=,etime=,comm=,args="])
        .output()
        .context("run ps for agent detection")?;
    if !output.status.success() {
        anyhow::bail!("ps agent scan failed");
    }

    let stdout = String::from_utf8(output.stdout).context("decode ps output")?;
    let mut by_key = BTreeMap::new();

    for line in stdout.lines() {
        let Some(agent) = parse_agent_line(line, repo_root) else {
            continue;
        };
        by_key.entry(agent.key.clone()).or_insert(agent);
    }

    let mut agents: Vec<_> = by_key.into_values().collect();
    agents.sort_by(|a, b| {
        agent_rank(b, repo_root)
            .cmp(&agent_rank(a, repo_root))
            .then_with(|| {
                b.cpu_percent
                    .partial_cmp(&a.cpu_percent)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| a.pid.cmp(&b.pid))
    });
    agents.truncate(MAX_AGENTS);
    Ok(agents)
}

pub fn calculate_stats(agents: &[DetectedAgent]) -> AgentStats {
    let mut by_vendor = HashMap::new();
    let mut total_cpu = 0.0f32;
    let mut total_mem_mb = 0.0f32;
    let mut active = 0usize;

    for agent in agents {
        *by_vendor.entry(agent.vendor.clone()).or_insert(0) += 1;
        total_cpu += agent.cpu_percent;
        total_mem_mb += agent.mem_mb;
        if agent.cpu_percent >= ACTIVE_CPU_THRESHOLD {
            active += 1;
        }
    }

    AgentStats {
        total: agents.len(),
        active,
        idle: agents.len().saturating_sub(active),
        total_cpu,
        total_mem_mb,
        by_vendor,
    }
}

fn parse_agent_line(line: &str, _repo_root: &str) -> Option<DetectedAgent> {
    let mut parts = line.split_whitespace();
    let pid = parts.next()?.parse::<u32>().ok()?;
    let _ppid = parts.next()?;
    let cpu_percent = parts.next()?.parse::<f32>().ok()?;
    let rss_kb = parts.next()?.parse::<f32>().ok()?;
    let etime = parts.next()?;
    let comm = parts.next()?;
    let args_joined = parts.collect::<Vec<_>>().join(" ");
    let args = if args_joined.is_empty() {
        comm
    } else {
        args_joined.as_str()
    };
    let command = args.to_string();
    let (name, vendor, icon) = classify_vendor(comm, args)?;

    let cwd = detect_cwd(pid).or_else(|| detect_cwd_from_command(&command));

    let project = cwd
        .as_deref()
        .map(extract_project)
        .unwrap_or_else(|| "-".to_string());

    Some(DetectedAgent {
        key: format!("{vendor}:{pid}"),
        name: name.to_string(),
        vendor: vendor.to_string(),
        icon: icon.to_string(),
        pid,
        cwd,
        cpu_percent,
        mem_mb: rss_kb / 1024.0,
        uptime_seconds: parse_etime_seconds(etime)?,
        status: if cpu_percent >= ACTIVE_CPU_THRESHOLD {
            "ACTIVE".to_string()
        } else {
            "IDLE".to_string()
        },
        confidence: 80,
        project,
        command,
    })
}

fn agent_rank(agent: &DetectedAgent, repo_root: &str) -> (u8, u8) {
    let local = agent
        .cwd
        .as_deref()
        .is_some_and(|cwd| cwd == repo_root || cwd.starts_with(&format!("{repo_root}/")));
    let same_project = agent.project == extract_project(repo_root);
    (u8::from(local), u8::from(same_project))
}

fn classify_vendor(
    comm: &str,
    command: &str,
) -> Option<(&'static str, &'static str, &'static str)> {
    let lower = format!("{comm} {command}").to_ascii_lowercase();
    if lower.contains("codex") {
        Some(("Codex", "OpenAI", "◈"))
    } else if lower.contains("claude") {
        Some(("Claude", "Anthropic", "◆"))
    } else if lower.contains("cursor") {
        Some(("Cursor", "Cursor", "⌘"))
    } else if lower.contains("copilot") {
        Some(("Copilot", "GitHub", "⬡"))
    } else if lower.contains("gemini") {
        Some(("Gemini", "Google", "✦"))
    } else if lower.contains("aider") {
        Some(("Aider", "Aider", "⚡"))
    } else {
        None
    }
}

pub fn extract_project(cwd: &str) -> String {
    cwd.split('/')
        .rfind(|segment| !segment.is_empty())
        .unwrap_or("-")
        .to_string()
}

pub fn format_uptime(secs: u64) -> String {
    let days = secs / 86_400;
    let hours = (secs % 86_400) / 3600;
    let minutes = (secs % 3600) / 60;
    let seconds = secs % 60;

    if days > 0 {
        format!("{days}d {hours:02}:{minutes:02}:{seconds:02}")
    } else if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

fn detect_cwd(pid: u32) -> Option<String> {
    let output = Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    stdout
        .lines()
        .find_map(|line| line.strip_prefix('n').map(|value| value.to_string()))
}

fn detect_cwd_from_command(command: &str) -> Option<String> {
    let tokens: Vec<_> = command.split_whitespace().collect();
    for window in tokens.windows(2) {
        match window {
            ["--cwd", path] | ["-C", path] => return Some(path.trim_matches('"').to_string()),
            _ => {}
        }
    }
    None
}

fn parse_etime_seconds(value: &str) -> Option<u64> {
    let mut rest = value.trim();
    let mut days = 0u64;
    if let Some((prefix, suffix)) = rest.split_once('-') {
        days = prefix.parse::<u64>().ok()?;
        rest = suffix;
    }

    let parts: Vec<_> = rest.split(':').collect();
    let seconds = match parts.as_slice() {
        [mm, ss] => mm.parse::<u64>().ok()? * 60 + ss.parse::<u64>().ok()?,
        [hh, mm, ss] => {
            hh.parse::<u64>().ok()? * 3600
                + mm.parse::<u64>().ok()? * 60
                + ss.parse::<u64>().ok()?
        }
        _ => return None,
    };
    Some(days * 86_400 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_known_agent_vendor() {
        assert_eq!(
            parse_agent_line(
                "123 1 12.5 204800 01:23 codex-aarch64-apple-darwin /usr/local/bin/codex-aarch64-apple-darwin --cwd /Users/phodal/ai/routa-js",
                "/Users/phodal/ai/routa-js"
            )
            .map(|agent| (
                agent.name,
                agent.vendor,
                agent.project,
                agent.cpu_percent,
                agent.mem_mb as u32,
                agent.uptime_seconds,
                agent.status
            )),
            Some((
                "Codex".to_string(),
                "OpenAI".to_string(),
                "routa-js".to_string(),
                12.5,
                200,
                83,
                "ACTIVE".to_string()
            ))
        );
    }

    #[test]
    fn classify_binary_name_variants_as_codex() {
        assert_eq!(
            parse_agent_line(
                "321 1 0.0 1024 00:03 codex-aarch64-apple-darwin codex-aarch64-apple-darwin",
                "/tmp/project"
            )
            .map(|agent| (agent.name, agent.vendor)),
            Some(("Codex".to_string(), "OpenAI".to_string()))
        );
    }

    #[test]
    fn ignore_non_agent_processes() {
        assert!(
            parse_agent_line("222 1 0.0 100 00:03 /usr/bin/vim foo.rs", "/tmp/project").is_none()
        );
    }

    #[test]
    fn parse_elapsed_time_with_days() {
        assert_eq!(parse_etime_seconds("2-03:04:05"), Some(183_845));
    }

    #[test]
    fn calculate_agent_stats_sums_process_metrics() {
        let stats = calculate_stats(&[
            DetectedAgent {
                key: "codex:1".to_string(),
                name: "Codex".to_string(),
                vendor: "OpenAI".to_string(),
                icon: "◈".to_string(),
                pid: 1,
                cwd: None,
                cpu_percent: 3.5,
                mem_mb: 120.0,
                uptime_seconds: 10,
                status: "ACTIVE".to_string(),
                confidence: 80,
                project: "-".to_string(),
                command: "codex".to_string(),
            },
            DetectedAgent {
                key: "claude:2".to_string(),
                name: "Claude".to_string(),
                vendor: "Anthropic".to_string(),
                icon: "◆".to_string(),
                pid: 2,
                cwd: None,
                cpu_percent: 0.2,
                mem_mb: 80.0,
                uptime_seconds: 20,
                status: "IDLE".to_string(),
                confidence: 80,
                project: "-".to_string(),
                command: "claude".to_string(),
            },
        ]);

        assert_eq!(stats.total, 2);
        assert_eq!(stats.active, 1);
        assert_eq!(stats.idle, 1);
        assert!((stats.total_cpu - 3.7).abs() < f32::EPSILON);
        assert!((stats.total_mem_mb - 200.0).abs() < f32::EPSILON);
        assert_eq!(stats.by_vendor.get("OpenAI"), Some(&1));
    }

    #[test]
    fn format_uptime_matches_agentwatch_style() {
        assert_eq!(format_uptime(30), "00:30");
        assert_eq!(format_uptime(3661), "01:01:01");
        assert_eq!(format_uptime(90_061), "1d 01:01:01");
    }
}
