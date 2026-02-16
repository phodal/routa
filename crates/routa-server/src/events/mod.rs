//! Event Bus - Publish/subscribe event system for inter-agent communication.
//!
//! Port of the TypeScript EventBus from src/core/events/event-bus.ts
//!
//! Features:
//!   - One-shot subscriptions: auto-remove after first matching event
//!   - Priority ordering: higher priority subscribers get notified first
//!   - Wait-group support: group multiple subscriptions for after_all semantics
//!   - Pre-subscribe: subscribe before the triggering action

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Event types for agent coordination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentEventType {
    AgentCreated,
    AgentActivated,
    AgentCompleted,
    AgentError,
    TaskAssigned,
    TaskCompleted,
    TaskFailed,
    TaskStatusChanged,
    MessageSent,
    ReportSubmitted,
    WorkspaceUpdated,
}

impl AgentEventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AgentCreated => "AGENT_CREATED",
            Self::AgentActivated => "AGENT_ACTIVATED",
            Self::AgentCompleted => "AGENT_COMPLETED",
            Self::AgentError => "AGENT_ERROR",
            Self::TaskAssigned => "TASK_ASSIGNED",
            Self::TaskCompleted => "TASK_COMPLETED",
            Self::TaskFailed => "TASK_FAILED",
            Self::TaskStatusChanged => "TASK_STATUS_CHANGED",
            Self::MessageSent => "MESSAGE_SENT",
            Self::ReportSubmitted => "REPORT_SUBMITTED",
            Self::WorkspaceUpdated => "WORKSPACE_UPDATED",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_uppercase().as_str() {
            "AGENT_CREATED" => Some(Self::AgentCreated),
            "AGENT_ACTIVATED" => Some(Self::AgentActivated),
            "AGENT_COMPLETED" => Some(Self::AgentCompleted),
            "AGENT_ERROR" => Some(Self::AgentError),
            "TASK_ASSIGNED" => Some(Self::TaskAssigned),
            "TASK_COMPLETED" => Some(Self::TaskCompleted),
            "TASK_FAILED" => Some(Self::TaskFailed),
            "TASK_STATUS_CHANGED" => Some(Self::TaskStatusChanged),
            "MESSAGE_SENT" => Some(Self::MessageSent),
            "REPORT_SUBMITTED" => Some(Self::ReportSubmitted),
            "WORKSPACE_UPDATED" => Some(Self::WorkspaceUpdated),
            _ => None,
        }
    }
}

/// An event emitted by an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    #[serde(rename = "type")]
    pub event_type: AgentEventType,
    pub agent_id: String,
    pub workspace_id: String,
    pub data: serde_json::Value,
    pub timestamp: DateTime<Utc>,
}

/// Subscription configuration for an agent.
#[derive(Debug, Clone)]
pub struct EventSubscription {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub event_types: Vec<AgentEventType>,
    pub exclude_self: bool,
    /// If true, auto-remove after first matching event delivery
    pub one_shot: bool,
    /// Group ID for wait-all semantics
    pub wait_group_id: Option<String>,
    /// Higher priority subscriptions are notified first (default: 0)
    pub priority: i32,
}

/// Wait group tracks multiple agents completing a set of tasks.
#[derive(Debug, Clone)]
pub struct WaitGroup {
    pub id: String,
    pub parent_agent_id: String,
    pub expected_agent_ids: Vec<String>,
    pub completed_agent_ids: HashSet<String>,
}

type EventHandler = Arc<dyn Fn(AgentEvent) + Send + Sync>;

/// Inner state for the EventBus.
struct EventBusInner {
    handlers: HashMap<String, EventHandler>,
    subscriptions: HashMap<String, EventSubscription>,
    pending_events: HashMap<String, Vec<AgentEvent>>,
    wait_groups: HashMap<String, WaitGroup>,
}

/// Thread-safe event bus for inter-agent communication.
#[derive(Clone)]
pub struct EventBus {
    inner: Arc<RwLock<EventBusInner>>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(EventBusInner {
                handlers: HashMap::new(),
                subscriptions: HashMap::new(),
                pending_events: HashMap::new(),
                wait_groups: HashMap::new(),
            })),
        }
    }

    // ─── Direct handlers ────────────────────────────────────────────────

    /// Subscribe to events with a handler function.
    pub async fn on<F>(&self, key: &str, handler: F)
    where
        F: Fn(AgentEvent) + Send + Sync + 'static,
    {
        let mut inner = self.inner.write().await;
        inner.handlers.insert(key.to_string(), Arc::new(handler));
    }

    /// Unsubscribe a handler.
    pub async fn off(&self, key: &str) {
        let mut inner = self.inner.write().await;
        inner.handlers.remove(key);
    }

    // ─── Publish ────────────────────────────────────────────────────────

    /// Publish an event to all subscribed handlers and agent subscriptions.
    pub async fn emit(&self, event: AgentEvent) {
        let mut inner = self.inner.write().await;

        // 1. Deliver to direct handlers
        for handler in inner.handlers.values() {
            let handler = handler.clone();
            let event = event.clone();
            // Fire and forget - don't block on handler execution
            tokio::spawn(async move {
                handler(event);
            });
        }

        // 2. Buffer for agent subscriptions, sorted by priority (descending)
        let mut sorted_subs: Vec<_> = inner.subscriptions.values().cloned().collect();
        sorted_subs.sort_by(|a, b| b.priority.cmp(&a.priority));

        let mut one_shot_to_remove: Vec<String> = Vec::new();

        for sub in &sorted_subs {
            if sub.exclude_self && event.agent_id == sub.agent_id {
                continue;
            }
            if !sub.event_types.contains(&event.event_type) {
                continue;
            }

            let pending = inner
                .pending_events
                .entry(sub.agent_id.clone())
                .or_default();
            pending.push(event.clone());

            // Track one-shot for removal
            if sub.one_shot {
                one_shot_to_remove.push(sub.id.clone());
            }
        }

        // Remove one-shot subscriptions that were triggered
        for sub_id in one_shot_to_remove {
            inner.subscriptions.remove(&sub_id);
        }

        // 3. Check wait groups
        if matches!(
            event.event_type,
            AgentEventType::AgentCompleted | AgentEventType::ReportSubmitted
        ) {
            Self::check_wait_groups_inner(&mut inner, &event.agent_id);
        }
    }

    // ─── Agent subscriptions ────────────────────────────────────────────

    /// Register an agent event subscription.
    pub async fn subscribe(&self, subscription: EventSubscription) {
        let mut inner = self.inner.write().await;
        inner
            .subscriptions
            .insert(subscription.id.clone(), subscription);
    }

    /// Remove an agent event subscription.
    pub async fn unsubscribe(&self, subscription_id: &str) -> bool {
        let mut inner = self.inner.write().await;
        inner.subscriptions.remove(subscription_id).is_some()
    }

    /// Drain all pending events for an agent.
    pub async fn drain_pending_events(&self, agent_id: &str) -> Vec<AgentEvent> {
        let mut inner = self.inner.write().await;
        inner.pending_events.remove(agent_id).unwrap_or_default()
    }

    // ─── Wait groups ────────────────────────────────────────────────────

    /// Create a wait group for after_all semantics.
    pub async fn create_wait_group(
        &self,
        id: String,
        parent_agent_id: String,
        expected_agent_ids: Vec<String>,
    ) {
        let mut inner = self.inner.write().await;
        inner.wait_groups.insert(
            id.clone(),
            WaitGroup {
                id,
                parent_agent_id,
                expected_agent_ids,
                completed_agent_ids: HashSet::new(),
            },
        );
    }

    /// Add an agent to an existing wait group.
    pub async fn add_to_wait_group(&self, group_id: &str, agent_id: &str) {
        let mut inner = self.inner.write().await;
        if let Some(group) = inner.wait_groups.get_mut(group_id) {
            if !group.expected_agent_ids.contains(&agent_id.to_string()) {
                group.expected_agent_ids.push(agent_id.to_string());
            }
        }
    }

    /// Get a wait group by ID.
    pub async fn get_wait_group(&self, group_id: &str) -> Option<WaitGroup> {
        let inner = self.inner.read().await;
        inner.wait_groups.get(group_id).cloned()
    }

    /// Remove a wait group.
    pub async fn remove_wait_group(&self, group_id: &str) {
        let mut inner = self.inner.write().await;
        inner.wait_groups.remove(group_id);
    }

    /// Check if any wait group should be triggered.
    fn check_wait_groups_inner(inner: &mut EventBusInner, completed_agent_id: &str) {
        let mut completed_groups: Vec<String> = Vec::new();

        for (group_id, group) in inner.wait_groups.iter_mut() {
            if group.expected_agent_ids.contains(&completed_agent_id.to_string()) {
                group.completed_agent_ids.insert(completed_agent_id.to_string());

                tracing::info!(
                    "[EventBus] Wait group {}: {}/{} completed",
                    group_id,
                    group.completed_agent_ids.len(),
                    group.expected_agent_ids.len()
                );

                if group.completed_agent_ids.len() >= group.expected_agent_ids.len() {
                    tracing::info!(
                        "[EventBus] Wait group {} complete",
                        group_id
                    );
                    completed_groups.push(group_id.clone());
                }
            }
        }

        // Remove completed groups
        for group_id in completed_groups {
            inner.wait_groups.remove(&group_id);
        }
    }

    /// Get all event types as strings (for API responses).
    pub fn all_event_types() -> Vec<&'static str> {
        vec![
            "AGENT_CREATED",
            "AGENT_ACTIVATED",
            "AGENT_COMPLETED",
            "AGENT_ERROR",
            "TASK_ASSIGNED",
            "TASK_COMPLETED",
            "TASK_FAILED",
            "TASK_STATUS_CHANGED",
            "MESSAGE_SENT",
            "REPORT_SUBMITTED",
            "WORKSPACE_UPDATED",
        ]
    }
}

