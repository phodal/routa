use chrono::Utc;
use std::sync::Arc;

use super::*;

use crate::db::Database;
use crate::models::kanban::{KanbanBoard, KanbanColumn, KanbanColumnAutomation};
use crate::state::{AppState, AppStateInner};

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
async fn list_automations_returns_column_automation_info() {
    let state = setup_state().await;

    let automation = KanbanColumnAutomation {
        enabled: true,
        provider_id: Some("opencode".to_string()),
        role: Some("DEVELOPER".to_string()),
        ..Default::default()
    };

    let board = KanbanBoard {
        id: "board-auto-test".to_string(),
        workspace_id: "default".to_string(),
        name: "Auto Board".to_string(),
        is_default: false,
        github_token: None,
        columns: vec![
            KanbanColumn {
                id: "backlog".to_string(),
                name: "Backlog".to_string(),
                color: None,
                position: 0,
                stage: "backlog".to_string(),
                automation: None,
                visible: Some(true),
                width: None,
            },
            KanbanColumn {
                id: "dev".to_string(),
                name: "Dev".to_string(),
                color: None,
                position: 1,
                stage: "active".to_string(),
                automation: Some(automation),
                visible: Some(true),
                width: None,
            },
        ],
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };
    state
        .kanban_store
        .create(&board)
        .await
        .expect("board create should succeed");

    create_card(
        &state,
        super::cards::CreateCardParams {
            workspace_id: "default".to_string(),
            board_id: Some("board-auto-test".to_string()),
            column_id: Some("backlog".to_string()),
            title: "Backlog card".to_string(),
            description: None,
            priority: None,
            labels: None,
        },
    )
    .await
    .expect("backlog card create should succeed");

    create_card(
        &state,
        super::cards::CreateCardParams {
            workspace_id: "default".to_string(),
            board_id: Some("board-auto-test".to_string()),
            column_id: Some("dev".to_string()),
            title: "Dev card".to_string(),
            description: None,
            priority: None,
            labels: None,
        },
    )
    .await
    .expect("dev card create should succeed");

    let result = list_automations(
        &state,
        ListAutomationsParams {
            workspace_id: "default".to_string(),
            board_id: Some("board-auto-test".to_string()),
        },
    )
    .await
    .expect("list automations should succeed");

    assert_eq!(result.board_id, "board-auto-test");
    assert_eq!(result.columns.len(), 2);

    let backlog_col = result
        .columns
        .iter()
        .find(|column| column.column_id == "backlog")
        .unwrap();
    assert_eq!(backlog_col.stage, "backlog");
    assert_eq!(backlog_col.position, 0);
    assert_eq!(backlog_col.card_count, 1);
    assert!(!backlog_col.automation_enabled);
    assert!(backlog_col.automation.is_none());

    let dev_col = result
        .columns
        .iter()
        .find(|column| column.column_id == "dev")
        .unwrap();
    assert_eq!(dev_col.stage, "active");
    assert_eq!(dev_col.position, 1);
    assert_eq!(dev_col.card_count, 1);
    assert!(dev_col.automation_enabled);
    assert!(dev_col.automation.is_some());
}

#[tokio::test]
async fn list_automations_without_board_id_uses_default_board() {
    let state = setup_state().await;

    let board_result = create_board(
        &state,
        CreateBoardParams {
            workspace_id: "default".to_string(),
            name: "Default Automation Board".to_string(),
            columns: Some(vec!["Backlog".to_string(), "Dev".to_string()]),
            is_default: Some(true),
            id: None,
        },
    )
    .await
    .expect("create board should succeed");

    let result = list_automations(
        &state,
        ListAutomationsParams {
            workspace_id: "default".to_string(),
            board_id: None,
        },
    )
    .await
    .expect("list automations should succeed");

    assert_eq!(result.board_id, board_result.board.id);
    assert_eq!(result.columns.len(), board_result.board.columns.len());
}

#[tokio::test]
async fn trigger_automation_applies_column_defaults_before_triggering() {
    let state = setup_state().await;

    let board_result = create_board(
        &state,
        CreateBoardParams {
            workspace_id: "default".to_string(),
            name: "Manual Trigger Board".to_string(),
            columns: None,
            is_default: Some(true),
            id: None,
        },
    )
    .await
    .expect("create board should succeed");
    let board_id = board_result.board.id.clone();

    let created = create_card(
        &state,
        super::cards::CreateCardParams {
            workspace_id: "default".to_string(),
            board_id: Some(board_id.clone()),
            column_id: Some("dev".to_string()),
            title: "Manual trigger card".to_string(),
            description: None,
            priority: None,
            labels: None,
        },
    )
    .await
    .expect("create card should succeed");

    let initial_task = state
        .task_store
        .get(&created.card.id)
        .await
        .expect("task lookup should succeed")
        .expect("task should exist");
    assert!(initial_task.assigned_provider.is_none());
    assert!(initial_task.assigned_role.is_none());
    assert!(initial_task.assigned_specialist_id.is_none());
    assert!(initial_task.assigned_specialist_name.is_none());

    let mut board = state
        .kanban_store
        .get(&board_id)
        .await
        .expect("board lookup should succeed")
        .expect("board should exist");
    let dev = board
        .columns
        .iter_mut()
        .find(|column| column.id == "dev")
        .expect("dev column should exist");
    dev.automation = Some(KanbanColumnAutomation {
        enabled: true,
        provider_id: Some("custom-provider".to_string()),
        role: Some("REVIEWER".to_string()),
        specialist_id: Some("manual-trigger-specialist".to_string()),
        specialist_name: Some("Manual Trigger Worker".to_string()),
        transition_type: Some("entry".to_string()),
        ..Default::default()
    });
    state
        .kanban_store
        .update(&board)
        .await
        .expect("board update should succeed");

    let result = trigger_automation(
        &state,
        TriggerAutomationParams {
            card_id: created.card.id.clone(),
            column_id: None,
            force: false,
            dry_run: false,
        },
    )
    .await
    .expect("manual trigger should return a result");

    let saved = state
        .task_store
        .get(&created.card.id)
        .await
        .expect("task lookup should succeed")
        .expect("task should still exist");
    assert_eq!(saved.assigned_provider.as_deref(), Some("custom-provider"));
    assert_eq!(saved.assigned_role.as_deref(), Some("REVIEWER"));
    assert_eq!(
        saved.assigned_specialist_id.as_deref(),
        Some("manual-trigger-specialist")
    );
    assert_eq!(
        saved.assigned_specialist_name.as_deref(),
        Some("Manual Trigger Worker")
    );
    assert!(
        result.triggered || result.error.is_some(),
        "manual trigger should either start a session or explain why it could not"
    );
    assert!(
        saved.trigger_session_id.is_some() || saved.last_sync_error.is_some(),
        "manual trigger should either persist a session id or a sync error"
    );
}

#[tokio::test]
async fn trigger_automation_dry_run_does_not_create_session() {
    let state = setup_state().await;

    let board_result = create_board(
        &state,
        CreateBoardParams {
            workspace_id: "default".to_string(),
            name: "Dry Run Board".to_string(),
            columns: None,
            is_default: Some(true),
            id: None,
        },
    )
    .await
    .expect("create board should succeed");
    let board_id = board_result.board.id.clone();

    let created = create_card(
        &state,
        super::cards::CreateCardParams {
            workspace_id: "default".to_string(),
            board_id: Some(board_id.clone()),
            column_id: Some("dev".to_string()),
            title: "Dry run card".to_string(),
            description: None,
            priority: None,
            labels: None,
        },
    )
    .await
    .expect("create card should succeed");

    let mut board = state
        .kanban_store
        .get(&board_id)
        .await
        .expect("board lookup should succeed")
        .expect("board should exist");
    let dev = board
        .columns
        .iter_mut()
        .find(|column| column.id == "dev")
        .expect("dev column should exist");
    dev.automation = Some(KanbanColumnAutomation {
        enabled: true,
        provider_id: Some("dry-run-provider".to_string()),
        ..Default::default()
    });
    state
        .kanban_store
        .update(&board)
        .await
        .expect("board update should succeed");

    let result = trigger_automation(
        &state,
        TriggerAutomationParams {
            card_id: created.card.id.clone(),
            column_id: None,
            force: false,
            dry_run: true,
        },
    )
    .await
    .expect("dry run should succeed");

    let saved = state
        .task_store
        .get(&created.card.id)
        .await
        .expect("task lookup should succeed")
        .expect("task should still exist");
    assert!(!result.triggered);
    assert!(result.session_id.is_none());
    assert!(result.error.is_none());
    assert_eq!(
        result.message.as_deref(),
        Some("Dry run: automation for column dev is ready to trigger.")
    );
    assert!(saved.trigger_session_id.is_none());
}

#[tokio::test]
async fn trigger_automation_requires_force_to_replace_active_session() {
    let state = setup_state().await;

    let board_result = create_board(
        &state,
        CreateBoardParams {
            workspace_id: "default".to_string(),
            name: "Force Guard Board".to_string(),
            columns: None,
            is_default: Some(true),
            id: None,
        },
    )
    .await
    .expect("create board should succeed");
    let board_id = board_result.board.id.clone();

    let created = create_card(
        &state,
        super::cards::CreateCardParams {
            workspace_id: "default".to_string(),
            board_id: Some(board_id.clone()),
            column_id: Some("dev".to_string()),
            title: "Already running card".to_string(),
            description: None,
            priority: None,
            labels: None,
        },
    )
    .await
    .expect("create card should succeed");

    let mut board = state
        .kanban_store
        .get(&board_id)
        .await
        .expect("board lookup should succeed")
        .expect("board should exist");
    let dev = board
        .columns
        .iter_mut()
        .find(|column| column.id == "dev")
        .expect("dev column should exist");
    dev.automation = Some(KanbanColumnAutomation {
        enabled: true,
        provider_id: Some("force-guard-provider".to_string()),
        ..Default::default()
    });
    state
        .kanban_store
        .update(&board)
        .await
        .expect("board update should succeed");

    let mut task = state
        .task_store
        .get(&created.card.id)
        .await
        .expect("task lookup should succeed")
        .expect("task should exist");
    task.trigger_session_id = Some("session-existing".to_string());
    state
        .task_store
        .save(&task)
        .await
        .expect("task should save");

    let result = trigger_automation(
        &state,
        TriggerAutomationParams {
            card_id: created.card.id.clone(),
            column_id: None,
            force: false,
            dry_run: false,
        },
    )
    .await
    .expect("manual trigger should succeed");

    assert!(!result.triggered);
    assert_eq!(result.session_id.as_deref(), Some("session-existing"));
    assert!(result.error.is_none());
    assert_eq!(
        result.message.as_deref(),
        Some(
            "Automation already has an active trigger session. Re-run with force to start a new one."
        )
    );
}

#[tokio::test]
async fn trigger_automation_can_use_column_override_without_moving_card() {
    let state = setup_state().await;

    let board_result = create_board(
        &state,
        CreateBoardParams {
            workspace_id: "default".to_string(),
            name: "Override Board".to_string(),
            columns: None,
            is_default: Some(true),
            id: None,
        },
    )
    .await
    .expect("create board should succeed");
    let board_id = board_result.board.id.clone();

    let created = create_card(
        &state,
        super::cards::CreateCardParams {
            workspace_id: "default".to_string(),
            board_id: Some(board_id.clone()),
            column_id: Some("backlog".to_string()),
            title: "Override card".to_string(),
            description: None,
            priority: None,
            labels: None,
        },
    )
    .await
    .expect("create card should succeed");

    let mut board = state
        .kanban_store
        .get(&board_id)
        .await
        .expect("board lookup should succeed")
        .expect("board should exist");
    let dev = board
        .columns
        .iter_mut()
        .find(|column| column.id == "dev")
        .expect("dev column should exist");
    dev.automation = Some(KanbanColumnAutomation {
        enabled: true,
        provider_id: Some("override-provider".to_string()),
        role: Some("DEVELOPER".to_string()),
        specialist_id: Some("override-specialist".to_string()),
        specialist_name: Some("Override Worker".to_string()),
        ..Default::default()
    });
    state
        .kanban_store
        .update(&board)
        .await
        .expect("board update should succeed");

    let result = trigger_automation(
        &state,
        TriggerAutomationParams {
            card_id: created.card.id.clone(),
            column_id: Some("dev".to_string()),
            force: false,
            dry_run: false,
        },
    )
    .await
    .expect("manual trigger should return a result");

    let saved = state
        .task_store
        .get(&created.card.id)
        .await
        .expect("task lookup should succeed")
        .expect("task should still exist");
    assert_eq!(saved.column_id.as_deref(), Some("backlog"));
    assert_eq!(
        saved.assigned_provider.as_deref(),
        Some("override-provider")
    );
    assert_eq!(saved.assigned_role.as_deref(), Some("DEVELOPER"));
    assert_eq!(
        saved.assigned_specialist_id.as_deref(),
        Some("override-specialist")
    );
    assert_eq!(
        saved.assigned_specialist_name.as_deref(),
        Some("Override Worker")
    );
    assert!(result.triggered || result.error.is_some());
    if result.triggered {
        assert_eq!(
            result.message.as_deref(),
            Some("Triggered automation using the selected column without moving the card.")
        );
    }
}
