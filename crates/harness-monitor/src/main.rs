mod application;
mod cli_operator;
mod db;
mod detect;
#[allow(dead_code)]
mod domain;
mod hooks;
mod ipc;
mod models;
mod observe;
mod operator_guardrails;
mod repo;
mod state;
mod tui;

use crate::db::Db;
use crate::ipc::{RuntimeSocket, RuntimeTcp};
use crate::models::RuntimeServiceInfo;
use crate::observe::Snapshot;
use crate::repo::{resolve, resolve_runtime};
use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::thread::sleep;
use std::time::Duration;

#[derive(Parser)]
#[command(
    name = "harness-monitor",
    version,
    about = "Harness Monitor - local multi-agent file attribution and fitness monitor"
)]
struct Cli {
    /// Optional repository root/path used for non-hook commands.
    #[arg(long, short, global = true)]
    repo: Option<String>,

    /// Inference window in milliseconds when choosing a fallback session.
    #[arg(long, default_value_t = models::DEFAULT_INFERENCE_WINDOW_MS)]
    infer_window_ms: i64,

    /// SQLite database path override (fallback location used when .git is not writable)
    #[arg(long, env = "HARNESS_MONITOR_DB_PATH")]
    db: Option<String>,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Launch the realtime Harness Monitor terminal UI.
    Tui {
        /// Poll interval in milliseconds for git status refresh.
        #[arg(long, default_value_t = models::DEFAULT_TUI_POLL_MS)]
        interval_ms: u64,
    },
    /// Show current active sessions in this repo.
    Sessions,
    /// Show detected coding agent processes and aggregate stats.
    Agents,
    /// List changed files (default output grouped by file), use --by-session to group by session.
    Files {
        #[arg(long, default_value_t = false)]
        by_session: bool,
    },
    /// Show who touched a file last.
    Who {
        /// Absolute or relative file path in current repo.
        path: String,
    },
    /// Poll filesystem and git status continuously.
    Watch {
        /// Poll interval in milliseconds.
        #[arg(long, default_value_t = 800)]
        interval_ms: u64,
    },
    /// Run a local runtime service that receives hook events and appends them to the repo feed.
    Serve,
    /// Record hook event payload. Reads JSON from stdin.
    Hook {
        /// Hook client, e.g. codex.
        client: String,
        /// Event name, e.g. SessionStart / PreToolUse / PostToolUse / Edit / Write / UserPromptSubmit / Stop.
        event: String,
    },
    #[command(hide = true)]
    GitHook {
        /// Git event name, e.g. post-commit post-checkout post-merge.
        event: String,
        /// Raw args from git hook.
        args: Vec<String>,
    },

    // ── Domain commands (Phase 0 stubs) ────────────────────────────────────
    /// Task management commands.
    Task {
        #[command(subcommand)]
        action: TaskCommand,
    },
    /// Run management commands.
    Run {
        #[command(subcommand)]
        action: RunCommand,
    },
    /// Workspace management commands.
    Workspace {
        #[command(subcommand)]
        action: WorkspaceCommand,
    },
    /// Evaluation commands.
    Eval {
        #[command(subcommand)]
        action: EvalCommand,
    },
    /// Policy introspection commands.
    Policy {
        #[command(subcommand)]
        action: PolicyCommand,
    },
}

#[derive(Subcommand)]
enum TaskCommand {
    /// List all tasks tracked in this repo.
    List,
    /// Show details of a task by ID.
    Show {
        /// Task ID to inspect.
        id: String,
    },
}

#[derive(Subcommand)]
enum RunCommand {
    /// List recent runs.
    List,
    /// Show details of a run by ID.
    Show {
        /// Run ID to inspect.
        id: String,
    },
    /// Attach to an already-running unmanaged agent session.
    Attach {
        /// Session or process identifier to attach to.
        session: String,
    },
    /// Stop / interrupt a managed run.
    Stop {
        /// Run ID to stop.
        id: String,
    },
}

#[derive(Subcommand)]
enum WorkspaceCommand {
    /// List all workspaces (worktrees) in this repo.
    List,
    /// Show details of a workspace by ID.
    Show {
        /// Workspace ID to inspect.
        id: String,
    },
}

#[derive(Subcommand)]
enum EvalCommand {
    /// Trigger an evaluation run against current dirty files.
    Run {
        /// Evaluation mode: fast or full.
        #[arg(long, default_value = "fast")]
        mode: String,
    },
}

#[derive(Subcommand)]
enum PolicyCommand {
    /// Explain the policy that would apply to a given effect class.
    Explain {
        /// Effect class to evaluate (e.g. merge, deploy, network_write).
        effect: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let db_hint = resolve_db_hint(cli.db.as_deref());
    match cli.command.unwrap_or(Command::Tui {
        interval_ms: models::DEFAULT_TUI_POLL_MS,
    }) {
        Command::Tui { interval_ms } => {
            let ctx = resolve_runtime(cli.repo.as_deref())?;
            tui::run(ctx, interval_ms)?;
        }
        Command::Hook { client, event } => {
            let payload = hooks::parse_stdin_payload()?;
            hooks::handle_hook(
                &client,
                &event,
                cli.repo.as_deref(),
                db_hint.as_deref(),
                &payload,
            )?;
        }
        Command::GitHook { event, args } => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            hooks::handle_git_event(&ctx, &event, &args)?;
        }
        Command::Sessions => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            let db = Db::open(&ctx.db_path)?;
            print_sessions(&db, &ctx.repo_root.to_string_lossy())?;
        }
        Command::Agents => {
            let ctx = resolve_runtime(cli.repo.as_deref())?;
            print_agents(&ctx.repo_root.to_string_lossy())?;
        }
        Command::Files { by_session } => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            let db = Db::open(&ctx.db_path)?;
            print_files(&db, &ctx.repo_root.to_string_lossy(), by_session)?;
        }
        Command::Who { path } => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            let db = Db::open(&ctx.db_path)?;
            print_file_owner(&db, &ctx.repo_root.to_string_lossy(), &ctx.repo_root, &path)?;
        }
        Command::Watch { interval_ms } => {
            run_watch(
                cli.repo.as_deref(),
                db_hint.as_deref(),
                cli.infer_window_ms,
                interval_ms,
            )?;
        }
        Command::Serve => {
            let ctx = resolve_runtime(cli.repo.as_deref())?;
            run_serve(&ctx)?;
        }

        // ── Domain commands ───────────────────────────────────────────────
        Command::Task { action } => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            let db = Db::open(&ctx.db_path)?;
            handle_task_command(action, &db, &ctx.repo_root.to_string_lossy())?;
        }
        Command::Run { action } => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            let db = Db::open(&ctx.db_path)?;
            cli_operator::handle_run_command(action, &db, &ctx.repo_root.to_string_lossy())?;
        }
        Command::Workspace { action } => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            let db = Db::open(&ctx.db_path).ok();
            cli_operator::handle_workspace_command(
                action,
                &ctx.repo_root.to_string_lossy(),
                db.as_ref(),
            )?;
        }
        Command::Eval { action } => {
            let ctx = resolve(cli.repo.as_deref(), db_hint.as_deref())?;
            let db = Db::open(&ctx.db_path)?;
            handle_eval_command(action, &db, &ctx.repo_root.to_string_lossy())?;
        }
        Command::Policy { action } => {
            handle_policy_command(action)?;
        }
    }
    Ok(())
}

fn resolve_db_hint(cli_db: Option<&str>) -> Option<String> {
    cli_db
        .map(ToString::to_string)
        .or_else(|| std::env::var("HARNESS_MONITOR_DB_PATH").ok())
        .or_else(|| std::env::var("AGENTWATCH_DB_PATH").ok())
        .filter(|value| !value.trim().is_empty())
}

fn run_watch(
    repo_hint: Option<&str>,
    db_hint: Option<&str>,
    infer_window_ms: i64,
    interval_ms: u64,
) -> Result<()> {
    let ctx = resolve(repo_hint, db_hint)?;
    let db = Db::open(&ctx.db_path)?;
    let repo_root = ctx.repo_root.to_string_lossy().to_string();
    let mut last_poll = 0i64;
    loop {
        let snapshot = observe::poll_repo(&ctx, &db, "watch", infer_window_ms)?;
        print_watch_once(&db, &repo_root, &snapshot, last_poll)?;
        last_poll = chrono::Utc::now().timestamp_millis();
        sleep(Duration::from_millis(interval_ms.max(200)));
    }
}

fn run_serve(ctx: &crate::repo::RepoContext) -> Result<()> {
    let socket_server = RuntimeSocket::bind(&ctx.runtime_socket_path).ok();
    let tcp_server = if socket_server.is_none() {
        RuntimeTcp::bind(&ctx.runtime_tcp_addr).ok()
    } else {
        None
    };
    let transport = if socket_server.is_some() {
        "socket"
    } else if tcp_server.is_some() {
        "tcp"
    } else {
        "feed"
    };

    if socket_server.is_none() && tcp_server.is_none() {
        anyhow::bail!(
            "could not bind local runtime service on {:?} or {}",
            ctx.runtime_socket_path,
            ctx.runtime_tcp_addr
        );
    }

    let started_at_ms = chrono::Utc::now().timestamp_millis();
    loop {
        crate::ipc::write_service_info(
            &ctx.runtime_info_path,
            &RuntimeServiceInfo {
                pid: std::process::id(),
                transport: transport.to_string(),
                started_at_ms,
                last_seen_at_ms: chrono::Utc::now().timestamp_millis(),
            },
        )?;

        if let Some(server) = &socket_server {
            for message in server.read_pending()? {
                crate::ipc::send_message(&ctx.runtime_event_path, &message)?;
            }
        }

        if let Some(server) = &tcp_server {
            for message in server.read_pending()? {
                crate::ipc::send_message(&ctx.runtime_event_path, &message)?;
            }
        }

        sleep(Duration::from_millis(50));
    }
}

fn print_sessions(db: &Db, repo_root: &str) -> Result<()> {
    let sessions = db.list_active_sessions(repo_root)?;
    let now_ms = chrono::Utc::now().timestamp_millis();
    let active_since_ms = now_ms - models::DEFAULT_INFERENCE_WINDOW_MS;
    let mut has_active = false;

    println!("session_id | cwd | model | client | status");
    for (session_id, cwd, model, _started_at_ms, last_seen_ms, client, db_status, ended_at_ms) in
        sessions
    {
        let status = if ended_at_ms.is_some() || db_status == "ended" {
            "ended"
        } else if last_seen_ms >= active_since_ms {
            "active"
        } else {
            "stale"
        };

        if status == "active" {
            println!("{session_id} | {cwd} | {model} | {client} | {status}");
            has_active = true;
        }
    }

    if !has_active {
        println!("no active sessions");
    }

    Ok(())
}

fn print_agents(repo_root: &str) -> Result<()> {
    let agents = crate::detect::scan_agents(repo_root)?;
    let stats = crate::detect::calculate_stats(&agents);
    println!(
        "total={} active={} idle={} cpu={:.1}% mem={:.0}MB",
        stats.total, stats.active, stats.idle, stats.total_cpu, stats.total_mem_mb
    );
    if agents.is_empty() {
        println!("no detected agents");
        return Ok(());
    }
    println!("pid | agent | cpu | mem | uptime | status | project | cwd");
    for agent in agents {
        println!(
            "{} | {} | {:.1}% | {:.0}MB | {} | {} | {} | {}",
            agent.pid,
            agent.name,
            agent.cpu_percent,
            agent.mem_mb,
            crate::detect::format_uptime(agent.uptime_seconds),
            agent.status,
            agent.project,
            agent.cwd.unwrap_or_else(|| "-".to_string())
        );
    }
    Ok(())
}

fn print_files(db: &Db, repo_root: &str, by_session: bool) -> Result<()> {
    let files = db.file_state_all_dirty(repo_root)?;
    if files.is_empty() {
        println!("no dirty files");
        return Ok(());
    }

    if by_session {
        let mut grouped: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for file in files {
            let session_key = file
                .session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            grouped.entry(session_key).or_default().push(file.rel_path);
        }
        for (session, paths) in grouped {
            println!("{session}");
            for path in paths {
                if let Some(event) = db.get_file_event_with_latest(repo_root, &path)? {
                    println!("  - {path} ({})", event.event_kind);
                } else {
                    println!("  - {path}");
                }
            }
        }
    } else {
        for file in files {
            let info = db
                .get_file_event_with_latest(repo_root, &file.rel_path)?
                .and_then(|evt| {
                    evt.session_id
                        .map(|id| format!(" by {id} [{}]", evt.confidence.as_str()))
                })
                .unwrap_or_else(|| " unassigned".to_string());
            println!("{} ({}){}", file.rel_path, file.state_code, info);
        }
    }
    Ok(())
}

fn print_file_owner(db: &Db, repo_root: &str, root: &Path, raw_path: &str) -> Result<()> {
    let abs = resolve_path(root, raw_path);
    let rel = abs
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| raw_path.to_string());

    if let Some(state) = db.get_file_state(repo_root, &rel)? {
        let last_event = db.get_file_event_with_latest(repo_root, &rel)?;
        if let Some(event) = last_event {
            let session = event.session_id.unwrap_or_else(|| "unknown".to_string());
            let turn = event.turn_id.unwrap_or_else(|| "n/a".to_string());
            let dirty = if state.2 { "dirty" } else { "clean" };
            println!(
                "{} | last {}ms | session={} | turn={} | confidence={} | dirty={}",
                rel,
                event.observed_at_ms,
                session,
                turn,
                event.confidence.as_str(),
                dirty
            );
        } else {
            println!("{rel} | no file events yet | clean={}", state.2);
        }
    } else if let Some(event) = db.get_file_event_with_latest(repo_root, &rel)? {
        let session = event.session_id.unwrap_or_else(|| "unknown".to_string());
        let turn = event.turn_id.unwrap_or_else(|| "n/a".to_string());
        println!(
            "{} | last {}ms | session={} | turn={} | confidence={}",
            rel,
            event.observed_at_ms,
            session,
            turn,
            event.confidence.as_str()
        );
    } else {
        println!("{rel} | unknown");
    }
    Ok(())
}

fn print_watch_once(db: &Db, repo_root: &str, snapshot: &Snapshot, since_ms: i64) -> Result<()> {
    print!("\x1b[2J\x1b[H");
    let now = chrono::Utc::now();
    println!("harness-monitor: {}", now.format("%Y-%m-%d %H:%M:%S"));
    println!("repo: {repo_root}");
    println!("changed: {}", snapshot.changed_paths.len());

    let events = db.file_events_since(repo_root, since_ms)?;
    if !events.is_empty() {
        println!("latest events:");
        for event in events.iter().take(10) {
            let session = event
                .session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            println!(
                "  {} {} {} (session={})",
                event.rel_path,
                event.event_kind,
                event.confidence.as_str(),
                session
            );
        }
    }

    let current = db.file_state_all_dirty(repo_root)?;
    if current.is_empty() {
        println!("no dirty files");
    } else {
        println!("dirty files: {}", current.len());
        for file in current.iter().take(20) {
            let owner = file
                .session_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            println!("  {} -> {}", file.rel_path, owner);
        }
    }
    println!("Ctrl-C to stop");
    Ok(())
}

fn resolve_path(root: &Path, raw: &str) -> PathBuf {
    let candidate = Path::new(raw);
    if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        root.join(candidate)
    }
}

// ── Domain command handlers (Phase 0 stubs) ──────────────────────────────────

fn handle_task_command(action: TaskCommand, db: &Db, repo_root: &str) -> Result<()> {
    match action {
        TaskCommand::List => {
            let sessions = db.list_active_sessions(repo_root)?;
            if sessions.is_empty() {
                println!("No active tasks.");
                return Ok(());
            }
            println!(
                "{:<36}  {:<12}  {:<12}  CWD",
                "SESSION / TASK", "CLIENT", "STATUS"
            );
            println!("{}", "-".repeat(90));
            for (session_id, cwd, _model, _started, _last, client, status, _ended) in &sessions {
                println!(
                    "{:<36}  {:<12}  {:<12}  {}",
                    session_id, client, status, cwd
                );
            }
        }
        TaskCommand::Show { id } => {
            let sessions = db.list_active_sessions(repo_root)?;
            let found = sessions.iter().find(|(session_id, ..)| session_id == &id);
            match found {
                Some((session_id, cwd, model, started_at_ms, _last, client, status, ended)) => {
                    println!("id:      {session_id}");
                    println!("client:  {client}");
                    println!("status:  {status}");
                    println!("cwd:     {cwd}");
                    if !model.is_empty() {
                        println!("model:   {model}");
                    }
                    println!(
                        "started: {}",
                        chrono::DateTime::from_timestamp_millis(*started_at_ms)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_else(|| started_at_ms.to_string())
                    );
                    if let Some(ended_ms) = ended {
                        println!(
                            "ended:   {}",
                            chrono::DateTime::from_timestamp_millis(*ended_ms)
                                .map(|dt| dt.to_rfc3339())
                                .unwrap_or_else(|| ended_ms.to_string())
                        );
                    }
                }
                None => println!("Task / session '{id}' not found."),
            }
        }
    }
    Ok(())
}

fn handle_eval_command(action: EvalCommand, db: &Db, repo_root: &str) -> Result<()> {
    match action {
        EvalCommand::Run { mode } => {
            let eval_mode = match mode.as_str() {
                "fast" => crate::domain::EvalMode::Fast,
                "full" => crate::domain::EvalMode::Full,
                other => bail!("unsupported eval mode '{other}', expected fast|full"),
            };
            let changed_files = db.file_state_by_repo_paths(repo_root)?;
            let evaluator = crate::domain::EntrixEvaluator::new(repo_root);
            let snapshot = crate::domain::Evaluator::evaluate(
                &evaluator,
                &crate::domain::EvalInput {
                    task_id: None,
                    run_id: None,
                    workspace_id: None,
                    changed_files,
                    eval_mode,
                    repo_root: repo_root.to_string(),
                },
            )?;
            db.insert_eval_snapshot(repo_root, &snapshot)?;
            println!("repo:        {}", repo_root);
            println!("eval:        {}", cli_operator::summarize_eval(&snapshot));
            println!("duration_ms: {:.1}", snapshot.duration_ms);
            println!("dimensions:  {}", snapshot.dimensions.len());
        }
    }
    Ok(())
}

fn handle_policy_command(action: PolicyCommand) -> Result<()> {
    match action {
        PolicyCommand::Explain { effect } => {
            use crate::domain::policy::{EffectClass, PolicyDecisionKind};
            let effect_class = match effect.as_str() {
                "read_only" => EffectClass::ReadOnly,
                "local_write" => EffectClass::LocalWrite,
                "repo_write" => EffectClass::RepoWrite,
                "git_write" => EffectClass::GitWrite,
                "network_read" => EffectClass::NetworkRead,
                "network_write" => EffectClass::NetworkWrite,
                "secret_access" => EffectClass::SecretAccess,
                "pr_create" => EffectClass::PrCreate,
                "merge" => EffectClass::Merge,
                "deploy" => EffectClass::Deploy,
                "prod_write" => EffectClass::ProdWrite,
                other => {
                    println!("Unknown effect class: '{other}'");
                    println!("Known classes: read_only, local_write, repo_write, git_write,");
                    println!("  network_read, network_write, secret_access, pr_create,");
                    println!("  merge, deploy, prod_write");
                    return Ok(());
                }
            };
            let decision = if effect_class.requires_explicit_allow() {
                PolicyDecisionKind::RequireApproval
            } else {
                PolicyDecisionKind::Allow
            };
            println!("effect:   {}", effect_class.as_str());
            println!("decision: {}", decision.as_str());
            println!("blocking: {}", decision.is_blocking());
            println!(
                "note:     {}",
                if effect_class.requires_explicit_allow() {
                    "High-impact effect — requires explicit allow or user approval."
                } else {
                    "Low-impact effect — allowed by default."
                }
            );
        }
    }
    Ok(())
}
