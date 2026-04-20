use clap::Subcommand;
use routa_core::state::AppState;

use crate::commands;

#[derive(Subcommand)]
pub(crate) enum KanbanAction {
    /// Manage boards
    Board {
        #[command(subcommand)]
        action: KanbanBoardAction,
    },
    /// Manage cards
    Card {
        #[command(subcommand)]
        action: KanbanCardAction,
    },
    /// Manage columns
    Column {
        #[command(subcommand)]
        action: KanbanColumnAction,
    },
    /// Show board status summary
    Status {
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Optional board ID. Defaults to the workspace default board.
        #[arg(long)]
        board_id: Option<String>,
    },
    /// Manage column automations
    Automation {
        #[command(subcommand)]
        action: KanbanAutomationAction,
    },
    /// Sync GitHub issues into Kanban cards
    Sync {
        #[command(subcommand)]
        action: KanbanSyncAction,
    },
}

#[derive(Subcommand)]
pub(crate) enum KanbanBoardAction {
    /// List boards in a workspace
    List {
        #[arg(long, default_value = "default")]
        workspace_id: String,
    },
    /// Create a board
    Create {
        #[arg(long)]
        name: String,
        #[arg(long, default_value = "default")]
        workspace_id: String,
        #[arg(long, value_delimiter = ',')]
        columns: Option<Vec<String>>,
        #[arg(long, default_value_t = false)]
        is_default: bool,
    },
    /// Get a board with its cards
    Get {
        #[arg(long)]
        board_id: String,
    },
    /// Update a board
    Update {
        #[arg(long)]
        board_id: String,
        #[arg(long)]
        name: Option<String>,
        #[arg(long)]
        columns_json: Option<String>,
        #[arg(long, default_value_t = false)]
        set_default: bool,
    },
    /// Validate a Kanban YAML config file
    Validate {
        /// Path to the YAML config file
        #[arg(long)]
        file: String,
    },
    /// Apply a Kanban YAML config (upsert boards and columns)
    Apply {
        /// Path to the YAML config file
        #[arg(long)]
        file: String,
        /// Workspace ID override (overrides value in YAML)
        #[arg(long)]
        workspace_id: Option<String>,
        /// Preview changes without writing
        #[arg(long, default_value_t = false)]
        dry_run: bool,
        /// Continue applying remaining boards on error
        #[arg(long, default_value_t = false)]
        continue_on_error: bool,
    },
    /// Export workspace boards to a YAML config file
    Export {
        /// Workspace ID to export
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Output file path (prints to stdout if omitted)
        #[arg(long)]
        output: Option<String>,
    },
}

#[derive(Subcommand)]
pub(crate) enum KanbanCardAction {
    /// Create a card
    Create {
        #[arg(long)]
        title: String,
        #[arg(long)]
        description: Option<String>,
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Optional board ID. Defaults to the workspace default board.
        #[arg(long)]
        board_id: Option<String>,
        /// Optional column ID. Defaults to `backlog` on the resolved board.
        #[arg(long)]
        column_id: Option<String>,
        #[arg(long)]
        priority: Option<String>,
        #[arg(long, value_delimiter = ',')]
        labels: Option<Vec<String>>,
    },
    /// Move a card
    Move {
        #[arg(long)]
        card_id: String,
        #[arg(long)]
        target_column_id: String,
        #[arg(long)]
        position: Option<i64>,
    },
    /// Update a card
    Update {
        #[arg(long)]
        card_id: String,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        description: Option<String>,
        #[arg(long)]
        priority: Option<String>,
        #[arg(long, value_delimiter = ',')]
        labels: Option<Vec<String>>,
    },
    /// Show detailed card information
    Get {
        #[arg(long)]
        card_id: String,
    },
    /// Create a linked GitHub issue for a card
    CreateIssue {
        #[arg(long)]
        card_id: String,
        /// Optional owner/repo override. Falls back to the task's linked/default codebase.
        #[arg(long)]
        repo: Option<String>,
    },
    /// Delete a card
    Delete {
        #[arg(long)]
        card_id: String,
    },
    /// Search cards
    Search {
        #[arg(long)]
        query: String,
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Optional board ID. Defaults to the workspace default board.
        #[arg(long)]
        board_id: Option<String>,
    },
    /// List cards in a column
    ListByColumn {
        #[arg(long)]
        column_id: String,
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Optional board ID. Defaults to the workspace default board.
        #[arg(long)]
        board_id: Option<String>,
    },
    /// List cards with optional filters
    List {
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Optional board ID. Defaults to the workspace default board.
        #[arg(long)]
        board_id: Option<String>,
        #[arg(long)]
        column_id: Option<String>,
        /// Filter by status (PENDING, IN_PROGRESS, REVIEW_REQUIRED, COMPLETED, NEEDS_FIX, BLOCKED, CANCELLED)
        #[arg(long)]
        status: Option<String>,
        /// Filter by priority (low, medium, high, urgent)
        #[arg(long)]
        priority: Option<String>,
        /// Filter by labels. Repeat the flag or pass a comma-separated list; all labels must match.
        #[arg(long, value_delimiter = ',')]
        label: Option<Vec<String>>,
    },
    /// Bulk-create cards from a JSON task array
    Decompose {
        #[arg(long)]
        tasks_json: String,
        #[arg(long, default_value = "default")]
        workspace_id: String,
        #[arg(long)]
        board_id: Option<String>,
        #[arg(long)]
        column_id: Option<String>,
    },
}

#[derive(Subcommand)]
pub(crate) enum KanbanColumnAction {
    /// Create a column
    Create {
        #[arg(long)]
        board_id: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        color: Option<String>,
    },
    /// Delete a column
    Delete {
        #[arg(long)]
        board_id: String,
        #[arg(long)]
        column_id: String,
        #[arg(long, default_value_t = false)]
        delete_cards: bool,
    },
}

#[derive(Subcommand)]
pub(crate) enum KanbanAutomationAction {
    /// List automation configurations for a board's columns
    List {
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Optional board ID. Defaults to the workspace default board.
        #[arg(long)]
        board_id: Option<String>,
    },
    /// Manually trigger automation for a card
    Trigger {
        #[arg(long)]
        card_id: String,
        #[arg(long)]
        column_id: Option<String>,
        #[arg(long, default_value_t = false)]
        force: bool,
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
}

#[derive(Subcommand)]
pub(crate) enum KanbanSyncAction {
    /// Import or refresh GitHub issues for a workspace board
    Github {
        #[arg(long, default_value = "default")]
        workspace_id: String,
        /// Optional board ID. Defaults to the workspace default board.
        #[arg(long)]
        board_id: Option<String>,
        /// Optional column ID. Defaults to `backlog` on the resolved board.
        #[arg(long)]
        column_id: Option<String>,
        #[arg(long)]
        repo: Option<String>,
        #[arg(long)]
        codebase_id: Option<String>,
        /// Filter GitHub issues by state: open, closed, or all
        #[arg(long)]
        state: Option<String>,
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
}

pub(crate) async fn handle_kanban_action(
    state: &AppState,
    action: KanbanAction,
) -> Result<(), String> {
    match action {
        KanbanAction::Board { action } => match action {
            KanbanBoardAction::List { workspace_id } => {
                commands::kanban::list_boards(state, &workspace_id).await
            }
            KanbanBoardAction::Create {
                name,
                workspace_id,
                columns,
                is_default,
            } => {
                commands::kanban::create_board(state, &workspace_id, &name, columns, is_default)
                    .await
            }
            KanbanBoardAction::Get { board_id } => {
                commands::kanban::get_board(state, &board_id).await
            }
            KanbanBoardAction::Update {
                board_id,
                name,
                columns_json,
                set_default,
            } => {
                commands::kanban::update_board(
                    state,
                    &board_id,
                    name.as_deref(),
                    columns_json.as_deref(),
                    set_default,
                )
                .await
            }
            KanbanBoardAction::Validate { file } => commands::kanban::validate_config(&file).await,
            KanbanBoardAction::Apply {
                file,
                workspace_id,
                dry_run,
                continue_on_error,
            } => {
                commands::kanban::apply_config(
                    state,
                    &file,
                    workspace_id.as_deref(),
                    dry_run,
                    continue_on_error,
                )
                .await
            }
            KanbanBoardAction::Export {
                workspace_id,
                output,
            } => commands::kanban::export_config(state, &workspace_id, output.as_deref()).await,
        },
        KanbanAction::Card { action } => match action {
            KanbanCardAction::Create {
                title,
                description,
                workspace_id,
                board_id,
                column_id,
                priority,
                labels,
            } => {
                commands::kanban::create_card(
                    state,
                    commands::kanban::CreateCardOptions {
                        workspace_id: &workspace_id,
                        board_id: board_id.as_deref(),
                        column_id: column_id.as_deref(),
                        title: &title,
                        description: description.as_deref(),
                        priority: priority.as_deref(),
                        labels,
                    },
                )
                .await
            }
            KanbanCardAction::Move {
                card_id,
                target_column_id,
                position,
            } => commands::kanban::move_card(state, &card_id, &target_column_id, position).await,
            KanbanCardAction::Update {
                card_id,
                title,
                description,
                priority,
                labels,
            } => {
                commands::kanban::update_card(
                    state,
                    &card_id,
                    title.as_deref(),
                    description.as_deref(),
                    priority.as_deref(),
                    labels,
                )
                .await
            }
            KanbanCardAction::Get { card_id } => commands::kanban::get_card(state, &card_id).await,
            KanbanCardAction::CreateIssue { card_id, repo } => {
                commands::kanban::create_issue_from_card(state, &card_id, repo.as_deref()).await
            }
            KanbanCardAction::Delete { card_id } => {
                commands::kanban::delete_card(state, &card_id).await
            }
            KanbanCardAction::Search {
                query,
                workspace_id,
                board_id,
            } => {
                commands::kanban::search_cards(state, &workspace_id, &query, board_id.as_deref())
                    .await
            }
            KanbanCardAction::ListByColumn {
                column_id,
                workspace_id,
                board_id,
            } => {
                commands::kanban::list_cards_by_column(
                    state,
                    &workspace_id,
                    &column_id,
                    board_id.as_deref(),
                )
                .await
            }
            KanbanCardAction::List {
                workspace_id,
                board_id,
                column_id,
                status,
                priority,
                label,
            } => {
                commands::kanban::list_cards(
                    state,
                    commands::kanban::ListCardsOptions {
                        workspace_id: &workspace_id,
                        board_id: board_id.as_deref(),
                        column_id: column_id.as_deref(),
                        status: status.as_deref(),
                        priority: priority.as_deref(),
                        labels: label
                            .as_ref()
                            .map(|values| values.iter().map(String::as_str).collect()),
                    },
                )
                .await
            }
            KanbanCardAction::Decompose {
                tasks_json,
                workspace_id,
                board_id,
                column_id,
            } => {
                commands::kanban::decompose_tasks(
                    state,
                    &workspace_id,
                    board_id.as_deref(),
                    column_id.as_deref(),
                    &tasks_json,
                )
                .await
            }
        },
        KanbanAction::Column { action } => match action {
            KanbanColumnAction::Create {
                board_id,
                name,
                color,
            } => commands::kanban::create_column(state, &board_id, &name, color.as_deref()).await,
            KanbanColumnAction::Delete {
                board_id,
                column_id,
                delete_cards,
            } => commands::kanban::delete_column(state, &board_id, &column_id, delete_cards).await,
        },
        KanbanAction::Status {
            workspace_id,
            board_id,
        } => commands::kanban::board_status(state, &workspace_id, board_id.as_deref()).await,
        KanbanAction::Automation { action } => match action {
            KanbanAutomationAction::List {
                workspace_id,
                board_id,
            } => {
                commands::kanban::list_automations(state, &workspace_id, board_id.as_deref()).await
            }
            KanbanAutomationAction::Trigger {
                card_id,
                column_id,
                force,
                dry_run,
            } => {
                commands::kanban::trigger_automation(
                    state,
                    &card_id,
                    column_id.as_deref(),
                    force,
                    dry_run,
                )
                .await
            }
        },
        KanbanAction::Sync { action } => match action {
            KanbanSyncAction::Github {
                workspace_id,
                board_id,
                column_id,
                repo,
                codebase_id,
                state: state_filter,
                dry_run,
            } => {
                commands::kanban::sync_github_issues(
                    state,
                    &workspace_id,
                    commands::kanban::SyncGithubIssuesOptions {
                        board_id: board_id.as_deref(),
                        column_id: column_id.as_deref(),
                        repo: repo.as_deref(),
                        codebase_id: codebase_id.as_deref(),
                        state_filter: state_filter.as_deref(),
                        dry_run,
                    },
                )
                .await
            }
        },
    }
}
