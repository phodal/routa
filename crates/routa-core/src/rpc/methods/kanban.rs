//! RPC methods for Kanban board and card management.
//!
//! Methods:
//! - `kanban.listBoards`
//! - `kanban.createBoard`
//! - `kanban.getBoard`
//! - `kanban.updateBoard`
//! - `kanban.createCard`
//! - `kanban.moveCard`
//! - `kanban.updateCard`
//! - `kanban.deleteCard`
//! - `kanban.createColumn`
//! - `kanban.deleteColumn`
//! - `kanban.searchCards`
//! - `kanban.listCardsByColumn`
//! - `kanban.decomposeTasks`

mod automation;
mod boards;
mod cards;
mod queries;
mod shared;

pub use boards::{
    create_board, create_column, delete_column, get_board, list_boards, update_board,
    CreateBoardParams, CreateBoardResult, CreateColumnParams, CreateColumnResult,
    DeleteColumnParams, DeleteColumnResult, GetBoardParams, GetBoardResult, KanbanBoardSummary,
    KanbanColumnWithCards, ListBoardsParams, ListBoardsResult, UpdateBoardParams,
    UpdateBoardResult,
};
pub use cards::{
    create_card, decompose_tasks, delete_card, move_card, update_card, CreateCardParams,
    CreateCardResult, DecomposeTaskItem, DecomposeTasksParams, DecomposeTasksResult,
    DeleteCardParams, DeleteCardResult, MoveCardParams, MoveCardResult, UpdateCardParams,
    UpdateCardResult,
};
pub use queries::{
    list_cards_by_column, search_cards, ListCardsByColumnParams, ListCardsByColumnResult,
    SearchCardsParams, SearchCardsResult,
};

#[cfg(test)]
mod tests {
    use super::automation::{
        absolutize_url, apply_trigger_result, build_task_prompt, AgentTriggerResult,
    };
    use super::boards::build_board_result;
    use super::*;
    use chrono::Utc;

    use crate::db::Database;
    use crate::models::kanban::{
        KanbanAutomationStep, KanbanBoard, KanbanColumn, KanbanColumnAutomation, KanbanTransport,
    };
    use crate::models::task::{Task, TaskLaneSessionStatus};
    use crate::rpc::error::RpcError;
    use crate::state::{AppState, AppStateInner};
    use std::sync::Arc;

    async fn setup_state() -> AppState {
        let db = Database::open_in_memory().expect("in-memory db should open");
        let state: AppState = Arc::new(AppStateInner::new(db));
        state
            .workspace_store
            .ensure_default()
            .await
            .expect("default workspace should exist");
        state
    }

    #[tokio::test]
    async fn list_boards_ensures_default_board_exists() {
        let state = setup_state().await;

        let result = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");

        assert_eq!(result.boards.len(), 1);
        assert!(result.boards[0].is_default);
        assert!(result.boards[0].column_count > 0);
    }

    #[tokio::test]
    async fn create_card_without_board_id_uses_default_board() {
        let state = setup_state().await;
        let boards = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");
        let default_board_id = boards.boards[0].id.clone();

        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: None,
                column_id: Some("backlog".to_string()),
                title: "Implement RPC".to_string(),
                description: Some("wire core methods".to_string()),
                priority: Some("high".to_string()),
                labels: Some(vec!["rpc".to_string(), "kanban".to_string()]),
            },
        )
        .await
        .expect("create card should succeed");

        let board_view = get_board(
            &state,
            GetBoardParams {
                board_id: default_board_id,
            },
        )
        .await
        .expect("get board should succeed");

        let backlog = board_view
            .columns
            .iter()
            .find(|column| column.id == "backlog")
            .expect("backlog column should exist");
        assert_eq!(backlog.cards.len(), 1);
        assert_eq!(backlog.cards[0].id, created.card.id);
        assert_eq!(backlog.cards[0].priority.as_deref(), Some("high"));
    }

    #[test]
    fn build_task_prompt_includes_lane_specific_guidance() {
        let mut task = Task::new(
            "task-1".to_string(),
            "Implement Kanban RPC".to_string(),
            "Ship the kanban lane workflow".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.column_id = Some("todo".to_string());
        task.labels = vec!["rpc".to_string(), "kanban".to_string()];

        let prompt = build_task_prompt(
            &task,
            Some("board-1"),
            Some("dev"),
            "- todo (Todo) stage=todo position=1\n- dev (Dev) stage=dev position=2",
        );

        assert!(prompt.contains("You are in the `todo` lane."));
        assert!(prompt.contains("Do not edit files"));
        assert!(prompt.contains("**Board ID:** board-1"));
        assert!(prompt.contains("targetColumnId `dev`"));
        assert!(prompt.contains("Labels: rpc, kanban"));
    }

    #[test]
    fn absolutize_url_resolves_relative_urls_against_agent_card() {
        let resolved = absolutize_url("https://example.com/.well-known/agent-card.json", "/rpc")
            .expect("relative URLs should resolve");

        assert_eq!(resolved, "https://example.com/rpc");
        assert_eq!(
            absolutize_url(
                "https://example.com/agent-card.json",
                "https://agent.example/rpc"
            )
            .expect("absolute URLs should pass through"),
            "https://agent.example/rpc"
        );
    }

    #[test]
    fn apply_trigger_result_tracks_session_history_for_current_lane() {
        let mut task = Task::new(
            "task-1".to_string(),
            "Implement lane automation".to_string(),
            "Move the task through the board".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        task.column_id = Some("todo".to_string());
        task.assigned_provider = Some("opencode".to_string());
        task.assigned_role = Some("CRAFTER".to_string());
        task.assigned_specialist_id = Some("spec-1".to_string());
        task.assigned_specialist_name = Some("Todo Worker".to_string());

        let board = KanbanBoard {
            id: "board-1".to_string(),
            workspace_id: "default".to_string(),
            name: "Board".to_string(),
            is_default: true,
            columns: vec![KanbanColumn {
                id: "todo".to_string(),
                name: "Todo".to_string(),
                color: None,
                position: 1,
                stage: "todo".to_string(),
                automation: None,
                visible: Some(true),
                width: None,
            }],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };
        let step = KanbanAutomationStep {
            id: "step-1".to_string(),
            specialist_name: Some("Planner".to_string()),
            ..Default::default()
        };

        apply_trigger_result(
            &mut task,
            Some(&board),
            Some(&step),
            AgentTriggerResult {
                session_id: "session-1".to_string(),
                transport: "acp".to_string(),
                external_task_id: None,
                context_id: Some("ctx-1".to_string()),
            },
        );

        assert_eq!(task.trigger_session_id.as_deref(), Some("session-1"));
        assert_eq!(task.session_ids, vec!["session-1".to_string()]);
        assert_eq!(task.lane_sessions.len(), 1);

        let lane_session = &task.lane_sessions[0];
        assert_eq!(lane_session.session_id, "session-1");
        assert_eq!(lane_session.column_id.as_deref(), Some("todo"));
        assert_eq!(lane_session.column_name.as_deref(), Some("Todo"));
        assert_eq!(lane_session.step_id.as_deref(), Some("step-1"));
        assert_eq!(lane_session.step_name.as_deref(), Some("Planner"));
        assert_eq!(lane_session.provider.as_deref(), Some("opencode"));
        assert_eq!(lane_session.role.as_deref(), Some("CRAFTER"));
        assert_eq!(lane_session.transport.as_deref(), Some("acp"));
        assert_eq!(lane_session.context_id.as_deref(), Some("ctx-1"));
        assert_eq!(lane_session.status, TaskLaneSessionStatus::Running);
    }

    #[tokio::test]
    async fn build_board_result_sorts_cards_within_each_column_by_position() {
        let state = setup_state().await;
        let boards = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");
        let board_id = boards.boards[0].id.clone();
        let board = state
            .kanban_store
            .get(&board_id)
            .await
            .expect("board load should succeed")
            .expect("default board should exist");

        let mut later = Task::new(
            "task-later".to_string(),
            "Later backlog task".to_string(),
            "Later".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        later.board_id = Some(board.id.clone());
        later.column_id = Some("backlog".to_string());
        later.position = 2;

        let mut earlier = Task::new(
            "task-earlier".to_string(),
            "Earlier backlog task".to_string(),
            "Earlier".to_string(),
            "default".to_string(),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );
        earlier.board_id = Some(board.id.clone());
        earlier.column_id = Some("backlog".to_string());
        earlier.position = 1;

        state
            .task_store
            .save(&later)
            .await
            .expect("later task save should succeed");
        state
            .task_store
            .save(&earlier)
            .await
            .expect("earlier task save should succeed");

        let result = build_board_result(&state, board)
            .await
            .expect("board result should build");
        let backlog = result
            .columns
            .iter()
            .find(|column| column.id == "backlog")
            .expect("backlog column should exist");

        let backlog_ids: Vec<&str> = backlog.cards.iter().map(|card| card.id.as_str()).collect();
        assert_eq!(backlog_ids, vec!["task-earlier", "task-later"]);
    }

    #[tokio::test]
    async fn move_card_updates_status_and_rejects_negative_position() {
        let state = setup_state().await;
        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: None,
                column_id: Some("backlog".to_string()),
                title: "Move me".to_string(),
                description: None,
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");

        let moved = move_card(
            &state,
            MoveCardParams {
                card_id: created.card.id.clone(),
                target_column_id: "dev".to_string(),
                position: None,
            },
        )
        .await
        .expect("move card should succeed");
        assert_eq!(moved.card.column_id, "dev");
        assert_eq!(moved.card.status, "IN_PROGRESS");

        let err = move_card(
            &state,
            MoveCardParams {
                card_id: created.card.id,
                target_column_id: "review".to_string(),
                position: Some(-1),
            },
        )
        .await
        .expect_err("negative position should fail");
        assert!(matches!(err, RpcError::BadRequest(_)));
    }

    #[tokio::test]
    async fn update_card_rejects_description_changes_in_dev() {
        let state = setup_state().await;
        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: None,
                column_id: Some("backlog".to_string()),
                title: "Freeze description".to_string(),
                description: Some("Original story".to_string()),
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");

        move_card(
            &state,
            MoveCardParams {
                card_id: created.card.id.clone(),
                target_column_id: "dev".to_string(),
                position: None,
            },
        )
        .await
        .expect("move card should succeed");

        let err = update_card(
            &state,
            UpdateCardParams {
                card_id: created.card.id,
                title: None,
                description: Some("Rewrite in dev".to_string()),
                comment: None,
                priority: None,
                labels: None,
            },
        )
        .await
        .expect_err("description update in dev should fail");

        assert!(
            matches!(err, RpcError::BadRequest(message) if message.contains("comment field instead"))
        );
    }

    #[tokio::test]
    async fn update_card_appends_comment_without_rewriting_description() {
        let state = setup_state().await;
        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: None,
                column_id: Some("backlog".to_string()),
                title: "Append comment".to_string(),
                description: Some("Stable story".to_string()),
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");

        let first = update_card(
            &state,
            UpdateCardParams {
                card_id: created.card.id.clone(),
                title: None,
                description: None,
                comment: Some("First note".to_string()),
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("first comment update should succeed");
        assert_eq!(first.card.comment.as_deref(), Some("First note"));

        let second = update_card(
            &state,
            UpdateCardParams {
                card_id: created.card.id.clone(),
                title: None,
                description: None,
                comment: Some("Second note".to_string()),
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("second comment update should succeed");
        assert_eq!(
            second.card.comment.as_deref(),
            Some("First note\n\nSecond note")
        );

        let saved = state
            .task_store
            .get(&created.card.id)
            .await
            .expect("task lookup should succeed")
            .expect("task should exist");
        assert_eq!(saved.objective, "Stable story");
        assert_eq!(saved.comment.as_deref(), Some("First note\n\nSecond note"));
    }

    #[tokio::test]
    async fn move_card_applies_lane_automation_defaults_to_task() {
        let state = setup_state().await;
        let boards = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");
        let board_id = boards.boards[0].id.clone();

        let mut board = state
            .kanban_store
            .get(&board_id)
            .await
            .expect("board load should succeed")
            .expect("default board should exist");
        let todo = board
            .columns
            .iter_mut()
            .find(|column| column.id == "todo")
            .expect("todo column should exist");
        todo.automation = Some(KanbanColumnAutomation {
            enabled: true,
            provider_id: Some("opencode".to_string()),
            role: Some("CRAFTER".to_string()),
            specialist_id: Some("kanban-todo-worker".to_string()),
            specialist_name: Some("Todo Worker".to_string()),
            transition_type: Some("entry".to_string()),
            ..Default::default()
        });
        state
            .kanban_store
            .update(&board)
            .await
            .expect("board update should succeed");

        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: Some(board_id.clone()),
                column_id: Some("backlog".to_string()),
                title: "Automate me".to_string(),
                description: None,
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");

        move_card(
            &state,
            MoveCardParams {
                card_id: created.card.id.clone(),
                target_column_id: "todo".to_string(),
                position: None,
            },
        )
        .await
        .expect("move card should succeed");

        let task = state
            .task_store
            .get(&created.card.id)
            .await
            .expect("task lookup should succeed")
            .expect("task should exist");
        assert_eq!(task.assigned_provider.as_deref(), Some("opencode"));
        assert_eq!(task.assigned_role.as_deref(), Some("CRAFTER"));
        assert_eq!(
            task.assigned_specialist_id.as_deref(),
            Some("kanban-backlog-refiner")
        );
        assert_eq!(
            task.assigned_specialist_name.as_deref(),
            Some("Backlog Refiner")
        );
        assert!(
            task.trigger_session_id.is_some() || task.last_sync_error.is_some(),
            "lane automation should either start a session or record why it could not"
        );
    }

    #[tokio::test]
    async fn move_card_routes_a2a_lane_automation_without_falling_back_to_acp() {
        let state = setup_state().await;
        let boards = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");
        let board_id = boards.boards[0].id.clone();

        let mut board = state
            .kanban_store
            .get(&board_id)
            .await
            .expect("board load should succeed")
            .expect("default board should exist");
        let todo = board
            .columns
            .iter_mut()
            .find(|column| column.id == "todo")
            .expect("todo column should exist");
        todo.automation = Some(KanbanColumnAutomation {
            enabled: true,
            steps: Some(vec![KanbanAutomationStep {
                id: "todo-a2a".to_string(),
                transport: Some(KanbanTransport::A2a),
                provider_id: None,
                role: Some("CRAFTER".to_string()),
                specialist_id: None,
                specialist_name: Some("Todo Remote Worker".to_string()),
                agent_card_url: Some("http://127.0.0.1:9/card".to_string()),
                skill_id: Some("remote-skill".to_string()),
                auth_config_id: None,
            }]),
            transition_type: Some("entry".to_string()),
            ..Default::default()
        });
        state
            .kanban_store
            .update(&board)
            .await
            .expect("board update should succeed");

        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: Some(board_id.clone()),
                column_id: Some("backlog".to_string()),
                title: "Automate remotely".to_string(),
                description: None,
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");

        move_card(
            &state,
            MoveCardParams {
                card_id: created.card.id.clone(),
                target_column_id: "todo".to_string(),
                position: None,
            },
        )
        .await
        .expect("move card should succeed");

        let task = state
            .task_store
            .get(&created.card.id)
            .await
            .expect("task lookup should succeed")
            .expect("task should exist");
        assert!(
            task.trigger_session_id.is_none(),
            "failed A2A triggers must not silently create ACP sessions"
        );
        assert!(
            task.last_sync_error
                .as_deref()
                .is_some_and(|message| message.contains("A2A") || message.contains("a2a")),
            "expected a2a-specific error, got {:?}",
            task.last_sync_error
        );
        assert!(task.session_ids.is_empty());
        assert!(task.lane_sessions.is_empty());
    }

    #[tokio::test]
    async fn move_card_blocks_transition_when_required_artifacts_are_missing() {
        let state = setup_state().await;
        let boards = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");
        let board_id = boards.boards[0].id.clone();

        let mut board = state
            .kanban_store
            .get(&board_id)
            .await
            .expect("board load should succeed")
            .expect("default board should exist");
        let review = board
            .columns
            .iter_mut()
            .find(|column| column.id == "review")
            .expect("review column should exist");
        review.automation = Some(KanbanColumnAutomation {
            enabled: true,
            required_artifacts: Some(vec!["screenshot".to_string()]),
            ..Default::default()
        });
        state
            .kanban_store
            .update(&board)
            .await
            .expect("board update should succeed");

        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: Some(board_id),
                column_id: Some("todo".to_string()),
                title: "Need screenshot".to_string(),
                description: None,
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");

        let err = move_card(
            &state,
            MoveCardParams {
                card_id: created.card.id,
                target_column_id: "review".to_string(),
                position: None,
            },
        )
        .await
        .expect_err("transition should be blocked");

        assert!(
            matches!(err, RpcError::BadRequest(message) if message.contains("missing required artifacts: screenshot"))
        );
    }

    #[tokio::test]
    async fn delete_column_moves_cards_to_backlog_when_not_deleting_cards() {
        let state = setup_state().await;
        let created = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: None,
                column_id: Some("todo".to_string()),
                title: "Todo card".to_string(),
                description: None,
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");

        let board_before = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");
        let board_id = board_before.boards[0].id.clone();

        let result = delete_column(
            &state,
            DeleteColumnParams {
                board_id: board_id.clone(),
                column_id: "todo".to_string(),
                delete_cards: Some(false),
            },
        )
        .await
        .expect("delete column should succeed");

        assert!(result.deleted);
        assert_eq!(result.cards_moved, 1);
        assert_eq!(result.cards_deleted, 0);
        assert!(!result
            .board
            .columns
            .iter()
            .any(|column| column.id == "todo"));

        let task = state
            .task_store
            .get(&created.card.id)
            .await
            .expect("task get should succeed")
            .expect("task should still exist");
        assert_eq!(task.column_id.as_deref(), Some("backlog"));
    }

    #[tokio::test]
    async fn search_list_by_column_and_decompose_tasks_work() {
        let state = setup_state().await;
        let first = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: None,
                column_id: Some("backlog".to_string()),
                title: "Searchable API card".to_string(),
                description: None,
                priority: None,
                labels: Some(vec!["api".to_string()]),
            },
        )
        .await
        .expect("create card should succeed");
        let second = create_card(
            &state,
            CreateCardParams {
                workspace_id: "default".to_string(),
                board_id: None,
                column_id: Some("backlog".to_string()),
                title: "Another card".to_string(),
                description: None,
                priority: None,
                labels: None,
            },
        )
        .await
        .expect("create card should succeed");
        move_card(
            &state,
            MoveCardParams {
                card_id: second.card.id.clone(),
                target_column_id: "dev".to_string(),
                position: Some(0),
            },
        )
        .await
        .expect("move should succeed");

        let boards = list_boards(
            &state,
            ListBoardsParams {
                workspace_id: "default".to_string(),
            },
        )
        .await
        .expect("list boards should succeed");
        let board_id = boards.boards[0].id.clone();

        let searched = search_cards(
            &state,
            SearchCardsParams {
                workspace_id: "default".to_string(),
                query: "api".to_string(),
                board_id: Some(board_id.clone()),
            },
        )
        .await
        .expect("search should succeed");
        assert_eq!(searched.cards.len(), 1);
        assert_eq!(searched.cards[0].id, first.card.id);

        let dev_cards = list_cards_by_column(
            &state,
            ListCardsByColumnParams {
                workspace_id: "default".to_string(),
                board_id: Some(board_id.clone()),
                column_id: "dev".to_string(),
            },
        )
        .await
        .expect("list cards by column should succeed");
        assert_eq!(dev_cards.cards.len(), 1);
        assert_eq!(dev_cards.cards[0].id, second.card.id);

        let decomposed = decompose_tasks(
            &state,
            DecomposeTasksParams {
                workspace_id: "default".to_string(),
                board_id: Some(board_id),
                column_id: Some("backlog".to_string()),
                tasks: vec![
                    DecomposeTaskItem {
                        title: "Split 1".to_string(),
                        description: Some("a".to_string()),
                        priority: Some("low".to_string()),
                        labels: None,
                    },
                    DecomposeTaskItem {
                        title: "Split 2".to_string(),
                        description: None,
                        priority: Some("urgent".to_string()),
                        labels: Some(vec!["bulk".to_string()]),
                    },
                ],
            },
        )
        .await
        .expect("decompose should succeed");
        assert_eq!(decomposed.count, 2);
        assert_eq!(decomposed.cards.len(), 2);
    }
}
