use axum::{extract::Query, http::request::Parts};
use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Implementation, InitializeRequestParams,
        InitializeResult, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo,
        Tool,
    },
    service::{RequestContext, RoleServer},
    transport::{
        streamable_http_server::session::local::LocalSessionManager, StreamableHttpServerConfig,
        StreamableHttpService,
    },
    ErrorData as McpError,
};
use std::sync::Arc;

use crate::state::AppState;

use super::tool_catalog;
use super::{
    execute_tool_public, inject_workspace_id, normalize_tool_name_public, McpRequestQuery,
};

pub(super) type SharedMcpHttpService =
    Arc<StreamableHttpService<RoutaMcpHttpServer, LocalSessionManager>>;

#[derive(Clone)]
pub(super) struct RoutaMcpHttpServer {
    state: AppState,
}

#[derive(Debug, Clone)]
struct RequestScope {
    workspace_id: String,
    mcp_profile: Option<String>,
}

impl RequestScope {
    fn from_context(context: &RequestContext<RoleServer>) -> Self {
        let parts = context.extensions.get::<Parts>();
        let query = parts
            .and_then(|parts| Query::<McpRequestQuery>::try_from_uri(&parts.uri).ok())
            .map(|query| query.0)
            .unwrap_or_default();

        let workspace_id = parts
            .and_then(|parts| {
                parts
                    .headers
                    .get("routa-workspace-id")
                    .and_then(|value| value.to_str().ok())
            })
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or(query.ws_id)
            .unwrap_or_else(|| "default".to_string());

        Self {
            workspace_id,
            mcp_profile: query.mcp_profile,
        }
    }
}

impl RoutaMcpHttpServer {
    pub(super) fn new(state: AppState) -> Self {
        Self { state }
    }
}

pub(super) fn build_service(state: AppState) -> SharedMcpHttpService {
    Arc::new(StreamableHttpService::new(
        move || Ok(RoutaMcpHttpServer::new(state.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig {
            stateful_mode: true,
            ..Default::default()
        },
    ))
}

impl ServerHandler for RoutaMcpHttpServer {
    fn get_info(&self) -> ServerInfo {
        server_info(None, rmcp::model::ProtocolVersion::default())
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, McpError> {
        if context.peer.peer_info().is_none() {
            context.peer.set_peer_info(request.clone());
        }

        let scope = RequestScope::from_context(&context);
        Ok(server_info(
            scope.mcp_profile.as_deref(),
            request.protocol_version,
        ))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let scope = RequestScope::from_context(&context);
        let tools = tool_catalog::build_tool_list_for_profile(scope.mcp_profile.as_deref())
            .into_iter()
            .map(tool_from_value)
            .collect::<Result<Vec<_>, _>>()?;

        Ok(ListToolsResult {
            tools,
            next_cursor: None,
            meta: None,
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let scope = RequestScope::from_context(&context);
        let requested_tool_name = request.name.to_string();
        let normalized_tool_name = normalize_tool_name_public(&requested_tool_name).to_string();

        if !tool_catalog::tool_allowed_for_profile(
            &normalized_tool_name,
            scope.mcp_profile.as_deref(),
        ) {
            return Err(McpError::invalid_params(
                format!("Tool not allowed for MCP profile: {requested_tool_name}"),
                None,
            ));
        }

        let mut arguments = request
            .arguments
            .map(serde_json::Value::Object)
            .unwrap_or_else(|| serde_json::json!({}));
        inject_workspace_id(&mut arguments, &scope.workspace_id);

        let result = execute_tool_public(&self.state, &normalized_tool_name, &arguments).await;
        serde_json::from_value(result).map_err(|err| {
            McpError::internal_error(
                format!("Failed to encode MCP tool result for '{normalized_tool_name}': {err}"),
                None,
            )
        })
    }
}

fn server_info(
    profile: Option<&str>,
    protocol_version: rmcp::model::ProtocolVersion,
) -> ServerInfo {
    ServerInfo {
        protocol_version,
        capabilities: ServerCapabilities::builder().enable_tools().build(),
        server_info: Implementation {
            name: server_name(profile).to_string(),
            version: "0.1.0".to_string(),
            title: None,
            description: None,
            icons: None,
            website_url: None,
        },
        instructions: Some(
            "Routa multi-agent coordination platform. Use these tools to manage agents, tasks, notes, workspaces, and Kanban flows."
                .to_string(),
        ),
    }
}

fn server_name(profile: Option<&str>) -> &'static str {
    match profile {
        Some("kanban-planning") => "kanban-planning-mcp",
        Some("team-coordination") => "team-coordination-mcp",
        _ => "routa-mcp",
    }
}

fn tool_from_value(value: serde_json::Value) -> Result<Tool, McpError> {
    serde_json::from_value(value).map_err(|err| {
        McpError::internal_error(format!("Invalid MCP tool definition: {err}"), None)
    })
}
