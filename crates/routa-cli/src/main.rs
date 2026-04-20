//! Routa CLI — command-line interface for multi-agent coordination.
//!
//! Reuses the same core domain logic (routa-core) and server bootstrap
//! (routa-server) that power the Next.js web UI and Tauri desktop app.

mod commands;
mod kanban_cli;

use crate::commands::acp::AcpAction;
use crate::commands::fitness::FitnessAction;
use crate::commands::graph::GraphAction;
use crate::commands::harness::HarnessAction;
use crate::kanban_cli::{handle_kanban_action, KanbanAction};
use clap::{Parser, Subcommand};

/// Routa.js CLI — Multi-agent coordination platform
#[derive(Parser)]
#[command(
    name = "routa",
    version,
    about = "Routa.js CLI — Multi-agent coordination platform"
)]
pub struct Cli {
    /// Path to the SQLite database file
    #[arg(long, env = "ROUTA_DB_PATH", default_value = "routa.db")]
    db: String,

    /// Quick prompt mode: run the full Routa coordinator flow.
    /// Example: routa -p "Add a login page with OAuth support"
    #[arg(short = 'p', long = "prompt")]
    prompt: Option<String>,

    /// Workspace ID (used with -p prompt mode)
    #[arg(long, default_value = "default")]
    workspace_id: String,

    /// ACP provider for agent sessions (used with -p prompt mode)
    #[arg(long, default_value = "opencode")]
    provider: String,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Routa HTTP backend server
    Server {
        /// Host to bind to
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        /// Port to listen on
        #[arg(long, default_value_t = 3210)]
        port: u16,
        /// Path to static frontend directory (Next.js export)
        #[arg(long)]
        static_dir: Option<String>,
    },

    /// Run Routa as an ACP (Agent Client Protocol) server over stdio.
    /// Use subcommands to manage ACP agents and runtimes.
    Acp {
        #[command(subcommand)]
        action: commands::acp::AcpAction,
    },

    /// Install an ACP provider from presets/registry.
    Install(commands::acp::TopLevelInstallArgs),
    /// Uninstall a Routa-managed ACP provider.
    Uninstall(commands::acp::TopLevelUninstallArgs),

    /// Manage agents
    Agent {
        #[command(subcommand)]
        action: AgentAction,
    },

    /// Run specialist definitions directly
    Specialist {
        #[command(subcommand)]
        action: SpecialistAction,
    },

    /// Manage tasks
    Task {
        #[command(subcommand)]
        action: TaskAction,
    },

    /// Manage Kanban boards, cards, and columns
    Kanban {
        /// Prefer this Routa server for Kanban RPC calls.
        #[arg(
            long,
            env = "ROUTA_SERVER_URL",
            default_value = "http://127.0.0.1:3210"
        )]
        server_url: String,
        /// Emit JSON results without the JSON-RPC transport envelope.
        #[arg(long, default_value_t = false)]
        json: bool,
        #[command(subcommand)]
        action: KanbanAction,
    },

    /// Manage workspaces
    Workspace {
        #[command(subcommand)]
        action: WorkspaceAction,
    },

    /// Manage skills
    Skill {
        #[command(subcommand)]
        action: SkillAction,
    },

    /// Manage persisted ACP sessions
    Session {
        #[command(subcommand)]
        action: SessionAction,
    },

    /// Send a raw JSON-RPC request
    Rpc {
        /// JSON-RPC method name (e.g. "agents.list")
        #[arg(long)]
        method: String,
        /// JSON-RPC params as a JSON string
        #[arg(long, default_value = "{}")]
        params: String,
    },

    /// Delegate a task to a specialist agent with ACP process spawning
    Delegate {
        /// Task ID to delegate
        #[arg(long)]
        task_id: String,
        /// Calling (parent) agent ID
        #[arg(long)]
        caller_agent_id: String,
        /// Calling agent's ACP session ID
        #[arg(long)]
        caller_session_id: String,
        /// Workspace ID
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Specialist role: CRAFTER, GATE, or DEVELOPER
        #[arg(long, short = 's')]
        specialist: String,
        /// ACP provider (e.g. "opencode")
        #[arg(long)]
        provider: Option<String>,
        /// Working directory for the child agent
        #[arg(long)]
        cwd: Option<String>,
        /// Wait mode: "immediate" or "after_all"
        #[arg(long, default_value = "immediate")]
        wait_mode: String,
    },

    /// Interactive chat session with an agent
    Chat {
        /// Workspace ID
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// ACP provider to use (e.g. "opencode")
        #[arg(long, default_value = "opencode")]
        provider: String,
        /// Agent role: ROUTA, CRAFTER, GATE, or DEVELOPER
        #[arg(long, default_value = "DEVELOPER")]
        role: String,
        /// Resume or attach to an existing ACP session ID
        #[arg(long)]
        session_id: Option<String>,
    },

    /// Run repository static/security scans (TypeScript, Rust, Docker)
    Scan {
        /// Optional project directory to scan
        #[arg(long)]
        project_dir: Option<String>,
        /// Directory to write reports into
        #[arg(long, default_value = "artifacts/security")]
        output_dir: String,
        /// Fail if any scanner fails
        #[arg(long, default_value_t = false)]
        strict: bool,
    },

    /// Analyze code dependencies and generate dependency graphs
    Graph {
        #[command(subcommand)]
        action: GraphAction,
    },

    /// Run repository fitness and fluency assessments
    Fitness {
        #[command(subcommand)]
        action: FitnessAction,
    },

    /// Detect Harness build/test surfaces from docs/harness/*.yml
    Harness {
        #[command(subcommand)]
        action: HarnessAction,
    },

    /// Run YAML-defined agent workflows
    Workflow {
        #[command(subcommand)]
        action: WorkflowAction,
    },

    /// Run read-only code review analysis against git changes
    Review {
        #[command(subcommand)]
        action: ReviewAction,
    },

    /// Team coordination with an agent lead
    Team {
        #[command(subcommand)]
        action: TeamAction,
    },

    /// Generate and inspect feature tree surface index
    FeatureTree {
        #[command(subcommand)]
        action: FeatureTreeAction,
    },
}

#[derive(Subcommand)]
enum AgentAction {
    /// List agents in a workspace
    List {
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Maximum agents to show
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Create a new agent
    Create {
        /// Agent name
        #[arg(long)]
        name: String,
        /// Agent role: ROUTA, CRAFTER, GATE, DEVELOPER
        #[arg(long)]
        role: String,
        /// Workspace ID
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Parent agent ID
        #[arg(long)]
        parent_id: Option<String>,
    },
    /// Run a specialist agent for a one-off prompt
    Run {
        /// Specialist ID (for example: crafter, gate, view-git-change)
        #[arg(long, short = 's')]
        specialist: Option<String>,
        /// Directly execute a specialist definition file (.md/.yaml/.yml)
        #[arg(long)]
        specialist_file: Option<String>,
        /// Prompt to send to the specialist. Supports `@specialist prompt`.
        #[arg(long, short = 'p')]
        prompt: Option<String>,
        /// Workspace ID
        #[arg(long, short = 'w', default_value = "default")]
        workspace_id: String,
        /// ACP provider to use (for example: opencode). Overrides specialist execution.provider.
        #[arg(long)]
        provider: Option<String>,
        /// Extra specialist definitions directory
        #[arg(long, short = 'd')]
        specialist_dir: Option<String>,
    },
    /// Get agent status
    Status {
        /// Agent ID
        #[arg(long)]
        id: String,
    },
    /// Get agent summary
    Summary {
        /// Agent ID
        #[arg(long)]
        id: String,
    },
}

#[derive(Subcommand)]
enum SpecialistAction {
    /// Execute a specialist by id or definition file
    Run {
        /// Specialist ID or definition file path (.yaml/.yml)
        specialist: String,
        /// Prompt to send to the specialist
        #[arg(long, short = 'p')]
        prompt: Option<String>,
        /// Workspace ID
        #[arg(long, short = 'w', default_value = "default")]
        workspace_id: String,
        /// ACP provider override. If omitted, uses specialist execution.provider.
        #[arg(long)]
        provider: Option<String>,
        /// Print only specialist result JSON (machine-readable mode).
        #[arg(long, default_value_t = false)]
        json: bool,
        /// Timeout in milliseconds for provider initialize call.
        #[arg(long)]
        provider_timeout_ms: Option<u64>,
        /// Extra retries for provider create/session init failure.
        #[arg(long, default_value_t = 0)]
        provider_retries: u8,
        /// Repeat the run N times and write a baseline aggregate (ui-journey-evaluator only).
        #[arg(long, default_value_t = 1)]
        repeat: u8,
    },
}

#[derive(Subcommand)]
enum TaskAction {
    /// List tasks in a workspace
    List {
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Maximum tasks to show
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Create a new task
    Create {
        /// Task title
        #[arg(long)]
        title: String,
        /// Task objective
        #[arg(long)]
        objective: String,
        /// Workspace ID
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Task scope description
        #[arg(long)]
        scope: Option<String>,
        /// Acceptance criteria (comma-separated)
        #[arg(long, value_delimiter = ',')]
        acceptance_criteria: Option<Vec<String>>,
    },
    /// Get a task by ID
    Get {
        /// Task ID
        #[arg(long)]
        id: String,
    },
    /// Update task status
    UpdateStatus {
        /// Task ID
        #[arg(long)]
        id: String,
        /// New status: PENDING, IN_PROGRESS, REVIEW_REQUIRED, COMPLETED, NEEDS_FIX, BLOCKED, CANCELLED
        #[arg(long)]
        status: String,
        /// Agent ID performing the update
        #[arg(long)]
        agent_id: String,
        /// Optional completion summary
        #[arg(long)]
        summary: Option<String>,
    },
    /// List artifacts attached to a task
    ArtifactList {
        /// Task ID
        #[arg(long)]
        task_id: String,
        /// Optional artifact type filter
        #[arg(long)]
        artifact_type: Option<String>,
    },
    /// Attach an artifact to a task
    ArtifactProvide {
        /// Task ID
        #[arg(long)]
        task_id: String,
        /// Agent ID providing the artifact
        #[arg(long)]
        agent_id: String,
        /// Artifact type: screenshot, test_results, code_diff, logs
        #[arg(long = "type")]
        artifact_type: String,
        /// Artifact content
        #[arg(long)]
        content: String,
        /// Optional context
        #[arg(long)]
        context: Option<String>,
    },
}

#[derive(Subcommand)]
enum SessionAction {
    /// List persisted ACP sessions
    List {
        /// Optional workspace ID filter
        #[arg(long)]
        workspace_id: Option<String>,
        /// Maximum sessions to return
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Show a persisted ACP session
    Get {
        /// Session ID
        #[arg(long)]
        id: String,
    },
    /// Interactively pick a session and open chat
    Pick {
        /// Optional workspace ID filter
        #[arg(long)]
        workspace_id: Option<String>,
        /// ACP provider fallback if the session has no provider
        #[arg(long, default_value = "opencode")]
        provider: String,
        /// Agent role fallback if the session has no role
        #[arg(long, default_value = "DEVELOPER")]
        role: String,
        /// Maximum sessions to show
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum WorkspaceAction {
    /// List all workspaces
    List {
        /// Maximum workspaces to show
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Create a new workspace
    Create {
        /// Workspace name
        #[arg(long)]
        name: String,
    },
}

#[derive(Subcommand)]
enum SkillAction {
    /// List discovered skills
    List,
    /// Reload skills from the current directory
    Reload,
}

#[derive(Subcommand)]
enum WorkflowAction {
    /// Run a workflow from a YAML file
    Run {
        /// Path to the workflow YAML file
        file: String,
        /// Enable verbose output (show prompts and responses)
        #[arg(long, short = 'v')]
        verbose: bool,
        /// Custom specialist definitions directory
        #[arg(long)]
        specialist_dir: Option<String>,
        /// Trigger payload (JSON string for webhook-triggered workflows)
        #[arg(long)]
        trigger_payload: Option<String>,
    },
    /// Validate a workflow YAML file without executing it
    Validate {
        /// Path to the workflow YAML file
        file: String,
    },
    /// List available specialist definitions
    Specialists {
        /// Custom specialist definitions directory
        #[arg(long)]
        specialist_dir: Option<String>,
    },
}

#[derive(Subcommand)]
enum TeamAction {
    /// Launch a team coordination session with an agent lead
    Run {
        /// Task description / user requirement
        #[arg(long, short = 't')]
        task: Option<String>,
        /// Workspace ID
        #[arg(long, short = 'w', default_value = "default")]
        workspace_id: String,
        /// ACP provider for all team members
        #[arg(long, default_value = "opencode")]
        provider: String,
        /// Enter interactive mode after initial delegation
        #[arg(long, short = 'i', default_value_t = true)]
        interactive: bool,
    },
    /// Show team status (agents and tasks in workspace)
    Status {
        /// Workspace ID
        #[arg(long, default_value = "default")]
        workspace_id: String,
    },
}

#[derive(Subcommand)]
enum ReviewAction {
    /// Analyze a git diff using Specialist-backed multi-phase review
    Analyze {
        /// Base revision for the diff (defaults to HEAD~1)
        #[arg(long, default_value = "HEAD~1")]
        base: String,
        /// Head revision for the diff (defaults to HEAD)
        #[arg(long, default_value = "HEAD")]
        head: String,
        /// Repository path (defaults to current working directory)
        #[arg(long)]
        repo_path: Option<String>,
        /// Optional project-specific review rules file
        #[arg(long)]
        rules_file: Option<String>,
        /// Optional model override for all review workers
        #[arg(long)]
        model: Option<String>,
        /// Optional model override for validator worker only
        #[arg(long)]
        validator_model: Option<String>,
        /// Enable verbose workflow output
        #[arg(long, short = 'v')]
        verbose: bool,
        /// Print the final output as pretty JSON when possible
        #[arg(long, default_value_t = false)]
        json: bool,
        /// Custom specialist definitions directory
        #[arg(long)]
        specialist_dir: Option<String>,
    },
    /// Analyze a git diff using tool-driven security review
    Security {
        /// Base revision for the diff (defaults to HEAD~1)
        #[arg(long, default_value = "HEAD~1")]
        base: String,
        /// Head revision for the diff (defaults to HEAD)
        #[arg(long, default_value = "HEAD")]
        head: String,
        /// Repository path (defaults to current working directory)
        #[arg(long)]
        repo_path: Option<String>,
        /// Optional project-specific review rules file
        #[arg(long)]
        rules_file: Option<String>,
        /// Enable verbose workflow output
        #[arg(long, short = 'v')]
        verbose: bool,
        /// Print the final output as pretty JSON when possible
        #[arg(long, default_value_t = false)]
        json: bool,
        /// Print the tool-collected payload without invoking the specialist
        #[arg(long, default_value_t = false)]
        payload_only: bool,
        /// Custom specialist definitions directory
        #[arg(long)]
        specialist_dir: Option<String>,
    },
}

#[derive(Subcommand)]
enum FeatureTreeAction {
    /// Run feature-tree preflight and print the selected scan root
    Preflight {
        /// Repository path to analyze
        #[arg(long)]
        repo_path: Option<String>,
        /// Print the preflight payload as JSON
        #[arg(long, default_value_t = false)]
        json_output: bool,
    },
    /// Scan the repository and generate FEATURE_TREE.md + feature-tree.index.json
    Generate {
        /// Repository path (defaults to current working directory)
        #[arg(long)]
        repo_path: Option<String>,
        /// Optional scan root within the repository
        #[arg(long)]
        scan_root: Option<String>,
        /// Preview what would be generated without writing files
        #[arg(long, default_value_t = false)]
        dry_run: bool,
        /// Print the generation result as JSON
        #[arg(long, default_value_t = false)]
        json_output: bool,
    },
    /// Commit FEATURE_TREE artifacts with optional metadata enrichment
    Commit {
        /// Repository path (defaults to current working directory)
        #[arg(long)]
        repo_path: Option<String>,
        /// Optional scan root within the repository
        #[arg(long)]
        scan_root: Option<String>,
        /// Optional JSON file containing feature metadata
        #[arg(long)]
        metadata_file: Option<String>,
        /// Print the commit result as JSON
        #[arg(long, default_value_t = false)]
        json_output: bool,
    },
    /// Display a summary of the current feature tree index
    Inspect {
        /// Repository path (defaults to current working directory)
        #[arg(long)]
        repo_path: Option<String>,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();
    std::env::set_var("ROUTA_DB_PATH", &cli.db);

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "routa_core=warn,routa_server=warn,routa_cli=info".into()),
        )
        .init();

    let result = if let Some(prompt_text) = cli.prompt {
        // ── Quick prompt mode: routa -p "requirement" ───────────────
        // Resolve full shell PATH so child processes can be found
        let full_path = routa_core::shell_env::full_path();
        std::env::set_var("PATH", full_path);

        let state = commands::init_state(&cli.db).await;
        commands::prompt::run(&state, &prompt_text, &cli.workspace_id, &cli.provider).await
    } else if let Some(command) = cli.command {
        match command {
            Commands::Server {
                host,
                port,
                static_dir,
            } => commands::server::run(host, port, cli.db, static_dir).await,

            Commands::Acp { action } => {
                match action {
                    AcpAction::Serve {
                        workspace_id,
                        provider,
                    } => {
                        // Resolve full shell PATH so child processes can be found
                        let full_path = routa_core::shell_env::full_path();
                        std::env::set_var("PATH", full_path);
                        let state = commands::init_state(&cli.db).await;
                        commands::acp_serve::run(&state, &workspace_id, &provider).await
                    }
                    AcpAction::Install { agent_id, dist } => {
                        let state = commands::init_state(&cli.db).await;
                        commands::acp::install(&state, &agent_id, dist.as_deref()).await
                    }
                    AcpAction::Uninstall { agent_id } => {
                        let state = commands::init_state(&cli.db).await;
                        commands::acp::uninstall(&state, &agent_id).await
                    }
                    AcpAction::List => {
                        let state = commands::init_state(&cli.db).await;
                        commands::acp::list(&state).await
                    }
                    AcpAction::Installed => {
                        let state = commands::init_state(&cli.db).await;
                        commands::acp::list_installed(&state).await
                    }
                    AcpAction::RuntimeStatus => {
                        let state = commands::init_state(&cli.db).await;
                        commands::acp::runtime_status(&state).await
                    }
                    AcpAction::EnsureNode => {
                        let state = commands::init_state(&cli.db).await;
                        commands::acp::ensure_node(&state).await
                    }
                    AcpAction::EnsureUv => {
                        let state = commands::init_state(&cli.db).await;
                        commands::acp::ensure_uv(&state).await
                    }
                }
            }

            Commands::Install(args) => {
                let state = commands::init_state(&cli.db).await;
                commands::acp::install_top_level(
                    &state,
                    args.agent_id.as_deref(),
                    args.dist.as_deref(),
                )
                .await
            }

            Commands::Uninstall(args) => {
                let state = commands::init_state(&cli.db).await;
                commands::acp::uninstall_top_level(&state, args.agent_id.as_deref()).await
            }

            Commands::Agent { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    AgentAction::List {
                        workspace_id,
                        limit,
                    } => commands::agent::list(&state, &workspace_id, limit).await,
                    AgentAction::Create {
                        name,
                        role,
                        workspace_id,
                        parent_id,
                    } => {
                        commands::agent::create(
                            &state,
                            &name,
                            &role,
                            &workspace_id,
                            parent_id.as_deref(),
                        )
                        .await
                    }
                    AgentAction::Run {
                        specialist,
                        specialist_file,
                        prompt,
                        workspace_id,
                        provider,
                        specialist_dir,
                    } => {
                        commands::agent::run(
                            &state,
                            commands::agent::RunArgs {
                                specialist: specialist.as_deref(),
                                specialist_file: specialist_file.as_deref(),
                                prompt: prompt.as_deref(),
                                workspace_id: &workspace_id,
                                provider: provider.as_deref(),
                                output_json: false,
                                cwd_override: None,
                                specialist_dir: specialist_dir.as_deref(),
                                provider_timeout_ms: None,
                                provider_retries: 0,
                                repeat_count: 1,
                            },
                        )
                        .await
                    }
                    AgentAction::Status { id } => commands::agent::status(&state, &id).await,
                    AgentAction::Summary { id } => commands::agent::summary(&state, &id).await,
                }
            }

            Commands::Specialist { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    SpecialistAction::Run {
                        specialist,
                        prompt,
                        workspace_id,
                        provider,
                        json,
                        provider_timeout_ms,
                        provider_retries,
                        repeat,
                    } => {
                        commands::specialist::run(
                            &state,
                            commands::specialist::RunArgs {
                                specialist_target: &specialist,
                                prompt: prompt.as_deref(),
                                workspace_id: &workspace_id,
                                provider: provider.as_deref(),
                                output_json: json,
                                cwd_override: None,
                                provider_timeout_ms,
                                provider_retries,
                                repeat_count: repeat,
                            },
                        )
                        .await
                    }
                }
            }

            Commands::Task { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    TaskAction::List {
                        workspace_id,
                        limit,
                    } => commands::task::list(&state, &workspace_id, limit).await,
                    TaskAction::Create {
                        title,
                        objective,
                        workspace_id,
                        scope,
                        acceptance_criteria,
                    } => {
                        commands::task::create(
                            &state,
                            &title,
                            &objective,
                            &workspace_id,
                            scope.as_deref(),
                            acceptance_criteria,
                        )
                        .await
                    }
                    TaskAction::Get { id } => commands::task::get(&state, &id).await,
                    TaskAction::UpdateStatus {
                        id,
                        status,
                        agent_id,
                        summary,
                    } => {
                        commands::task::update_status(
                            &state,
                            &id,
                            &status,
                            &agent_id,
                            summary.as_deref(),
                        )
                        .await
                    }
                    TaskAction::ArtifactList {
                        task_id,
                        artifact_type,
                    } => {
                        commands::task::list_artifacts(&state, &task_id, artifact_type.as_deref())
                            .await
                    }
                    TaskAction::ArtifactProvide {
                        task_id,
                        agent_id,
                        artifact_type,
                        content,
                        context,
                    } => {
                        commands::task::provide_artifact(
                            &state,
                            &task_id,
                            &agent_id,
                            &artifact_type,
                            &content,
                            context.as_deref(),
                        )
                        .await
                    }
                }
            }

            Commands::Session { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    SessionAction::List {
                        workspace_id,
                        limit,
                    } => commands::session::list(&state, workspace_id.as_deref(), limit).await,
                    SessionAction::Get { id } => commands::session::get(&state, &id).await,
                    SessionAction::Pick {
                        workspace_id,
                        provider,
                        role,
                        limit,
                    } => {
                        commands::session::pick(
                            &state,
                            workspace_id.as_deref(),
                            &provider,
                            &role,
                            limit,
                        )
                        .await
                    }
                }
            }

            Commands::Kanban {
                server_url,
                json,
                action,
            } => {
                std::env::set_var("ROUTA_SERVER_URL", &server_url);
                if json {
                    std::env::set_var("ROUTA_KANBAN_JSON", "1");
                } else {
                    std::env::remove_var("ROUTA_KANBAN_JSON");
                }
                let state = commands::init_state(&cli.db).await;
                handle_kanban_action(&state, action).await
            }

            Commands::Workspace { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    WorkspaceAction::List { limit } => {
                        commands::workspace::list(&state, limit).await
                    }
                    WorkspaceAction::Create { name } => {
                        commands::workspace::create(&state, &name).await
                    }
                }
            }

            Commands::Skill { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    SkillAction::List => commands::skill::list(&state).await,
                    SkillAction::Reload => commands::skill::reload(&state).await,
                }
            }

            Commands::Rpc { method, params } => {
                let state = commands::init_state(&cli.db).await;
                commands::rpc::call(&state, &method, &params).await
            }

            Commands::Delegate {
                task_id,
                caller_agent_id,
                caller_session_id,
                workspace_id,
                specialist,
                provider,
                cwd,
                wait_mode,
            } => {
                let state = commands::init_state(&cli.db).await;
                commands::delegate::run(
                    &state,
                    &task_id,
                    &caller_agent_id,
                    &caller_session_id,
                    &workspace_id,
                    &specialist,
                    provider.as_deref(),
                    cwd.as_deref(),
                    &wait_mode,
                )
                .await
            }

            Commands::Chat {
                workspace_id,
                provider,
                role,
                session_id,
            } => {
                let state = commands::init_state(&cli.db).await;
                commands::chat::run(
                    &state,
                    &workspace_id,
                    &provider,
                    &role,
                    session_id.as_deref(),
                )
                .await
            }

            Commands::Scan {
                project_dir,
                output_dir,
                strict,
            } => commands::scan::run(project_dir.as_deref(), &output_dir, strict),

            Commands::Graph { action } => commands::graph::run(action),

            Commands::Fitness { action } => commands::fitness::run(action),
            Commands::Harness { action } => commands::harness::run(&cli.db, action).await,

            Commands::Workflow { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    WorkflowAction::Run {
                        file,
                        verbose,
                        specialist_dir,
                        trigger_payload,
                    } => {
                        commands::workflow::run(
                            &state,
                            &file,
                            verbose,
                            specialist_dir.as_deref(),
                            trigger_payload.as_deref(),
                        )
                        .await
                    }
                    WorkflowAction::Validate { file } => commands::workflow::validate(&file).await,
                    WorkflowAction::Specialists { specialist_dir } => {
                        commands::workflow::list_specialists(specialist_dir.as_deref()).await
                    }
                }
            }
            Commands::Review { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    ReviewAction::Analyze {
                        base,
                        head,
                        repo_path,
                        rules_file,
                        model,
                        validator_model,
                        verbose,
                        json,
                        specialist_dir,
                    } => {
                        commands::review::analyze(
                            &state,
                            commands::review::ReviewAnalyzeOptions {
                                base: &base,
                                head: &head,
                                repo_path: repo_path.as_deref(),
                                rules_file: rules_file.as_deref(),
                                model: model.as_deref(),
                                validator_model: validator_model.as_deref(),
                                verbose,
                                as_json: json,
                                payload_only: false,
                                specialist_dir: specialist_dir.as_deref(),
                            },
                        )
                        .await
                    }
                    ReviewAction::Security {
                        base,
                        head,
                        repo_path,
                        rules_file,
                        verbose,
                        json,
                        payload_only,
                        specialist_dir,
                    } => {
                        commands::review::security(
                            &state,
                            commands::review::ReviewAnalyzeOptions {
                                base: &base,
                                head: &head,
                                repo_path: repo_path.as_deref(),
                                rules_file: rules_file.as_deref(),
                                model: None,
                                validator_model: None,
                                verbose,
                                as_json: json,
                                payload_only,
                                specialist_dir: specialist_dir.as_deref(),
                            },
                        )
                        .await
                    }
                }
            }

            Commands::Team { action } => {
                // Resolve full shell PATH so child processes can be found
                let full_path = routa_core::shell_env::full_path();
                std::env::set_var("PATH", full_path);

                let state = commands::init_state(&cli.db).await;
                match action {
                    TeamAction::Run {
                        task,
                        workspace_id,
                        provider,
                        interactive,
                    } => {
                        let task_prompt = match task {
                            Some(t) => t,
                            None => match commands::team::prompt_for_task() {
                                Ok(t) => t,
                                Err(e) => {
                                    eprintln!("Error: {e}");
                                    std::process::exit(1);
                                }
                            },
                        };
                        commands::team::run(
                            &state,
                            &task_prompt,
                            &workspace_id,
                            &provider,
                            interactive,
                        )
                        .await
                    }
                    TeamAction::Status { workspace_id } => {
                        commands::team::status(&state, &workspace_id).await
                    }
                }
            }

            Commands::FeatureTree { action } => match action {
                FeatureTreeAction::Preflight {
                    repo_path,
                    json_output,
                } => commands::feature_tree::preflight(repo_path.as_deref(), json_output),
                FeatureTreeAction::Generate {
                    repo_path,
                    scan_root,
                    dry_run,
                    json_output,
                } => commands::feature_tree::generate(
                    repo_path.as_deref(),
                    scan_root.as_deref(),
                    dry_run,
                    json_output,
                ),
                FeatureTreeAction::Commit {
                    repo_path,
                    scan_root,
                    metadata_file,
                    json_output,
                } => commands::feature_tree::commit(
                    repo_path.as_deref(),
                    scan_root.as_deref(),
                    metadata_file.as_deref(),
                    json_output,
                ),
                FeatureTreeAction::Inspect { repo_path } => {
                    commands::feature_tree::inspect(repo_path.as_deref())
                }
            },
        }
    } else {
        // No prompt and no subcommand — show help
        use clap::CommandFactory;
        Cli::command().print_help().ok();
        println!();
        Ok(())
    };

    if let Err(e) = result {
        eprintln!("Error: {e}");
        std::process::exit(1);
    }
}
