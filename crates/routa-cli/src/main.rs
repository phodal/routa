//! Routa CLI — command-line interface for multi-agent coordination.
//!
//! Reuses the same core domain logic (routa-core) and server bootstrap
//! (routa-server) that power the Next.js web UI and Tauri desktop app.

mod commands;

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
        action: AcpAction,
    },

    /// Manage agents
    Agent {
        #[command(subcommand)]
        action: AgentAction,
    },

    /// Manage tasks
    Task {
        #[command(subcommand)]
        action: TaskAction,
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

    /// Run YAML-defined agent workflows
    Workflow {
        #[command(subcommand)]
        action: WorkflowAction,
    },
}

#[derive(Subcommand)]
enum AcpAction {
    /// Run Routa as an ACP server over stdio (other agents can connect to it).
    Serve {
        /// Workspace ID
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Default ACP provider for child agents (e.g. "opencode", "claude")
        #[arg(long, default_value = "opencode")]
        provider: String,
    },
    /// Install an ACP agent (downloads runtime if needed).
    Install {
        /// Agent ID from the ACP registry (e.g. "opencode")
        agent_id: String,
        /// Distribution type override: npx | uvx | binary
        #[arg(long)]
        dist: Option<String>,
    },
    /// Uninstall a previously-installed ACP agent.
    Uninstall {
        /// Agent ID to remove
        agent_id: String,
    },
    /// List agents from the ACP registry with their install status.
    List,
    /// List locally-installed ACP agents.
    Installed,
    /// Show Node.js / uv runtime status.
    RuntimeStatus,
    /// Download and cache Node.js (managed runtime) if not already present.
    EnsureNode,
    /// Download and cache uv (managed runtime) if not already present.
    EnsureUv,
}

#[derive(Subcommand)]
enum AgentAction {
    /// List agents in a workspace
    List {
        #[arg(long, default_value = "default")]
        workspace_id: String,
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
        /// Prompt to send to the specialist. Supports `@specialist prompt`.
        #[arg(long, short = 'p')]
        prompt: Option<String>,
        /// Workspace ID
        #[arg(long, short = 'w', default_value = "default")]
        workspace_id: String,
        /// ACP provider to use (for example: opencode)
        #[arg(long, default_value = "opencode")]
        provider: String,
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
enum TaskAction {
    /// List tasks in a workspace
    List {
        #[arg(long, default_value = "default")]
        workspace_id: String,
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
}

#[derive(Subcommand)]
enum WorkspaceAction {
    /// List all workspaces
    List,
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

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

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

            Commands::Agent { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    AgentAction::List { workspace_id } => {
                        commands::agent::list(&state, &workspace_id).await
                    }
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
                        prompt,
                        workspace_id,
                        provider,
                        specialist_dir,
                    } => {
                        commands::agent::run(
                            &state,
                            specialist.as_deref(),
                            prompt.as_deref(),
                            &workspace_id,
                            &provider,
                            specialist_dir.as_deref(),
                        )
                        .await
                    }
                    AgentAction::Status { id } => commands::agent::status(&state, &id).await,
                    AgentAction::Summary { id } => commands::agent::summary(&state, &id).await,
                }
            }

            Commands::Task { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    TaskAction::List { workspace_id } => {
                        commands::task::list(&state, &workspace_id).await
                    }
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
                }
            }

            Commands::Workspace { action } => {
                let state = commands::init_state(&cli.db).await;
                match action {
                    WorkspaceAction::List => commands::workspace::list(&state).await,
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
            } => {
                let state = commands::init_state(&cli.db).await;
                commands::chat::run(&state, &workspace_id, &provider, &role).await
            }

            Commands::Scan {
                project_dir,
                output_dir,
                strict,
            } => commands::scan::run(project_dir.as_deref(), &output_dir, strict).await,

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
        }
    } else {
        // No prompt and no subcommand — show help
        use clap::CommandFactory;
        Cli::command().print_help().ok();
        println!();
        Ok(())
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}
