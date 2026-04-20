//! System tray module for Routa Desktop.
//!
//! Provides a reusable system tray icon with workspace-first shortcuts.
//!
//! The tray is intentionally optimized for "resume and jump" desktop flows:
//! sessions, kanban, team runs, and message review stay one click away,
//! while GitHub repo links remain available as a secondary submenu.
//!
//! # Usage
//!
//! ```rust,ignore
//! // In setup():
//! tray::setup_tray(&app.handle(), &[])?;
//!
//! // From a Tauri command / after loading configs:
//! tray::update_tray_repos(&app_handle, &repos)?;
//! ```

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// Stable identifier for the single application tray icon.
pub const TRAY_ID: &str = "routa-tray";

const TRAY_SHOW_HIDE_ID: &str = "tray:show_hide";
const TRAY_WORKSPACE_SESSIONS_ID: &str = "tray:workspace:sessions";
const TRAY_WORKSPACE_KANBAN_ID: &str = "tray:workspace:kanban";
const TRAY_WORKSPACE_TEAM_ID: &str = "tray:workspace:team";
const TRAY_MESSAGES_ID: &str = "tray:messages";
const TRAY_SETTINGS_AGENTS_ID: &str = "tray:settings:agents";
const TRAY_SETTINGS_WEBHOOKS_ID: &str = "tray:settings:webhooks";
const TRAY_QUIT_ID: &str = "tray:quit";

#[cfg(target_os = "macos")]
const MACOS_TRAY_TEMPLATE_ICON: tauri::image::Image<'_> =
    tauri::include_image!("./icons/tray-template-macos.png");

fn use_template_icon_for_tray() -> bool {
    cfg!(target_os = "macos")
}

// ─── Data types ──────────────────────────────────────────────────────────────

/// A configured GitHub repository to expose in the tray menu.
///
/// Each repo spawns a sub-menu with quick-links to its Pull Requests page
/// and Issues page on github.com.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct GitHubRepo {
    /// Human-readable label shown in the menu (falls back to `owner/repo`).
    /// Uses #[serde(default)] to provide an empty String when the field is missing.
    #[serde(default)]
    pub name: String,
    /// GitHub organisation or user name (e.g. `"phodal"`).
    pub owner: String,
    /// Repository slug (e.g. `"routa"`).
    pub repo: String,
}

impl GitHubRepo {
    /// `https://github.com/{owner}/{repo}/pulls`
    pub fn pulls_url(&self) -> String {
        format!("https://github.com/{}/{}/pulls", self.owner, self.repo)
    }

    /// `https://github.com/{owner}/{repo}/issues`
    pub fn issues_url(&self) -> String {
        format!("https://github.com/{}/{}/issues", self.owner, self.repo)
    }

    /// `https://github.com/{owner}/{repo}`
    pub fn repo_url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.repo)
    }

    /// Menu-item identifier prefix for this repo.
    fn id_prefix(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }
}

// ─── Menu building ───────────────────────────────────────────────────────────

/// Build (or rebuild) the tray menu from the current list of repos.
///
/// The menu layout is:
/// ```text
/// Show / Hide Window
/// ──────────────────
/// Sessions
/// Kanban Board
/// Team Runs
/// Messages
/// ──────────────────
/// Settings
///   ├─ Agent Settings…
///   └─ Webhook Settings…
/// GitHub Shortcuts      (optional)
///   └─ [owner/repo]
///      ├─ Pull Requests
///      ├─ Issues
///      └─ Repository
/// ──────────────────
/// Quit Routa
/// ```
pub fn build_tray_menu(app: &AppHandle, repos: &[GitHubRepo]) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;

    // ── Show / Hide window ──
    let show_hide = MenuItem::with_id(
        app,
        TRAY_SHOW_HIDE_ID,
        "Show / Hide Window",
        true,
        None::<&str>,
    )?;
    menu.append(&show_hide)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let sessions = MenuItem::with_id(
        app,
        TRAY_WORKSPACE_SESSIONS_ID,
        "Sessions",
        true,
        None::<&str>,
    )?;
    let kanban = MenuItem::with_id(
        app,
        TRAY_WORKSPACE_KANBAN_ID,
        "Kanban Board",
        true,
        None::<&str>,
    )?;
    let team_runs =
        MenuItem::with_id(app, TRAY_WORKSPACE_TEAM_ID, "Team Runs", true, None::<&str>)?;
    let messages = MenuItem::with_id(app, TRAY_MESSAGES_ID, "Messages", true, None::<&str>)?;
    menu.append(&sessions)?;
    menu.append(&kanban)?;
    menu.append(&team_runs)?;
    menu.append(&messages)?;

    menu.append(&PredefinedMenuItem::separator(app)?)?;

    let agent_settings = MenuItem::with_id(
        app,
        TRAY_SETTINGS_AGENTS_ID,
        "Agent Settings…",
        true,
        None::<&str>,
    )?;
    let webhook_settings = MenuItem::with_id(
        app,
        TRAY_SETTINGS_WEBHOOKS_ID,
        "Webhook Settings…",
        true,
        None::<&str>,
    )?;
    let settings_submenu =
        Submenu::with_items(app, "Settings", true, &[&agent_settings, &webhook_settings])?;
    menu.append(&settings_submenu)?;

    // ── GitHub repo sub-menus (only when configured) ──
    if !repos.is_empty() {
        let github_shortcuts = Submenu::new(app, "GitHub Shortcuts", true)?;

        for repo in repos {
            let owner_repo = repo.id_prefix();
            let label = if repo.name.is_empty() {
                owner_repo.clone()
            } else {
                repo.name.clone()
            };

            let pulls = MenuItem::with_id(
                app,
                format!("tray:gh:pulls:{owner_repo}"),
                "Pull Requests",
                true,
                None::<&str>,
            )?;
            let issues = MenuItem::with_id(
                app,
                format!("tray:gh:issues:{owner_repo}"),
                "Issues",
                true,
                None::<&str>,
            )?;
            let repo_link = MenuItem::with_id(
                app,
                format!("tray:gh:repo:{owner_repo}"),
                "Repository",
                true,
                None::<&str>,
            )?;

            let repo_submenu =
                Submenu::with_items(app, &label, true, &[&pulls, &issues, &repo_link])?;
            github_shortcuts.append(&repo_submenu)?;
        }

        menu.append(&github_shortcuts)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    // ── Quit ──
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit Routa", true, None::<&str>)?;
    menu.append(&quit)?;

    Ok(menu)
}

// ─── Tray lifecycle ──────────────────────────────────────────────────────────

/// Initialise the system tray icon.
///
/// Call once during `app.setup()`.  Pass an empty slice when no webhook repos
/// are configured yet; call [`update_tray_repos`] later to populate the menu.
pub fn setup_tray(app: &AppHandle, repos: &[GitHubRepo]) -> tauri::Result<()> {
    let menu = build_tray_menu(app, repos)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Routa Desktop")
        .menu(&menu)
        .on_menu_event(handle_tray_menu_event);

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    #[cfg(target_os = "macos")]
    {
        // macOS tray icons work best with a dedicated monochrome template asset.
        // Using the full-color application icon here makes the menu-bar glyph
        // hard to read and can disappear entirely when marked as a template.
        builder = builder
            .icon(MACOS_TRAY_TEMPLATE_ICON)
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                handle_tray_icon_event(tray.app_handle(), &event);
            });

        if use_template_icon_for_tray() {
            builder = builder.icon_as_template(true);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.show_menu_on_left_click(true);
    }

    builder.build(app)?;

    Ok(())
}

/// Update the tray menu with a fresh list of GitHub repos.
///
/// Rebuilds and replaces the menu on the existing tray icon so that changes
/// to webhook configurations are reflected without restarting the app.
///
/// # Errors
/// Returns an error if the tray icon with `TRAY_ID` is not found.
pub fn update_tray_repos(app: &AppHandle, repos: &[GitHubRepo]) -> tauri::Result<()> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "Tray icon not found"))?;
    let menu = build_tray_menu(app, repos)?;
    tray.set_menu(Some(menu))?;
    Ok(())
}

// ─── Event handling ──────────────────────────────────────────────────────────

fn handle_tray_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    if id == TRAY_SHOW_HIDE_ID {
        toggle_main_window(app);
        return;
    }

    if let Some(route_suffix) = workspace_route_for_menu_id(id) {
        navigate_to_workspace_route(app, route_suffix);
        return;
    }

    if let Some(path) = absolute_route_for_menu_id(id) {
        navigate_to_absolute_route(app, path);
        return;
    }

    match id {
        TRAY_QUIT_ID => app.exit(0),
        id if id.starts_with("tray:gh:") => {
            if let Some(url) = parse_github_menu_id_to_url(id) {
                open_url_in_browser(app, &url);
            }
        }
        _ => {}
    }
}

fn workspace_route_for_menu_id(id: &str) -> Option<&'static str> {
    match id {
        TRAY_WORKSPACE_SESSIONS_ID => Some("/sessions"),
        TRAY_WORKSPACE_KANBAN_ID => Some("/kanban"),
        TRAY_WORKSPACE_TEAM_ID => Some("/team"),
        _ => None,
    }
}

fn absolute_route_for_menu_id(id: &str) -> Option<&'static str> {
    match id {
        TRAY_MESSAGES_ID => Some("/messages"),
        TRAY_SETTINGS_AGENTS_ID => Some("/settings/agents"),
        TRAY_SETTINGS_WEBHOOKS_ID => Some("/settings/webhooks"),
        _ => None,
    }
}

fn handle_tray_icon_event(app: &AppHandle, event: &TrayIconEvent) {
    if should_open_main_window_for_tray_event(event) {
        show_main_window(app);
    }
}

fn should_open_main_window_for_tray_event(event: &TrayIconEvent) -> bool {
    matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    )
}

/// Parse a `tray:gh:{type}:{owner}/{repo}` menu-event id and return the
/// corresponding GitHub URL.
///
/// This is a pure function extracted for testability. It returns `None` if
/// the id format is invalid or the link type is unknown.
///
/// # Examples
///
/// ```rust,ignore
/// # use crate::tray::parse_github_menu_id_to_url;
/// assert_eq!(
///     parse_github_menu_id_to_url("tray:gh:pulls:phodal/routa"),
///     Some("https://github.com/phodal/routa/pulls".to_string())
/// );
/// assert_eq!(
///     parse_github_menu_id_to_url("tray:gh:issues:phodal/routa"),
///     Some("https://github.com/phodal/routa/issues".to_string())
/// );
/// assert_eq!(
///     parse_github_menu_id_to_url("tray:gh:repo:phodal/routa"),
///     Some("https://github.com/phodal/routa".to_string())
/// );
/// assert_eq!(parse_github_menu_id_to_url("invalid"), None);
/// ```
pub fn parse_github_menu_id_to_url(id: &str) -> Option<String> {
    // id format: "tray:gh:<type>:<owner>/<repo>"
    let rest = id.strip_prefix("tray:gh:")?;
    // split into (<type>, <owner>/<repo>) at the first ':'
    let colon_pos = rest.find(':')?;
    let link_type = &rest[..colon_pos];
    let owner_repo = &rest[colon_pos + 1..];

    let url = match link_type {
        "pulls" => format!("https://github.com/{owner_repo}/pulls"),
        "issues" => format!("https://github.com/{owner_repo}/issues"),
        "repo" => format!("https://github.com/{owner_repo}"),
        _ => return None,
    };

    Some(url)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Toggle the main window's visibility.
fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

/// Navigate the in-app webview to `path` and bring the window to the front.
///
/// # Safety
/// `path` must be a trusted, internal application path (e.g. `/settings/webhooks`).
/// It is interpolated directly into JavaScript and must never contain user-controlled data.
fn navigate_to_absolute_route(app: &AppHandle, path: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let js = format!("window.location.href = `${{window.location.origin}}{path}`;");
        let _ = window.eval(&js);
        show_main_window(app);
    }
}

fn navigate_to_workspace_route(app: &AppHandle, route_suffix: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let js = crate::desktop_workspace_navigation_js(crate::api_port(), route_suffix);
        let _ = window.eval(&js);
        show_main_window(app);
    }
}

/// Open the given URL in the user's default browser.
fn open_url_in_browser(app: &AppHandle, url: &str) {
    use tauri_plugin_opener::OpenerExt;
    if let Err(e) = app.opener().open_url(url, None::<&str>) {
        eprintln!("[tray] Failed to open URL {url}: {e}");
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{Position, Size};

    fn make_repo(name: &str, owner: &str, repo: &str) -> GitHubRepo {
        GitHubRepo {
            name: name.to_string(),
            owner: owner.to_string(),
            repo: repo.to_string(),
        }
    }

    #[test]
    fn test_github_repo_urls() {
        let repo = make_repo("Routa", "phodal", "routa");
        assert_eq!(repo.pulls_url(), "https://github.com/phodal/routa/pulls");
        assert_eq!(repo.issues_url(), "https://github.com/phodal/routa/issues");
        assert_eq!(repo.repo_url(), "https://github.com/phodal/routa");
    }

    #[test]
    fn test_github_repo_id_prefix() {
        let repo = make_repo("", "myorg", "my-project");
        assert_eq!(repo.id_prefix(), "myorg/my-project");
    }

    #[test]
    fn test_github_repo_name_fallback() {
        // When name is empty the id_prefix (owner/repo) should be used as label
        let repo = make_repo("", "phodal", "routa");
        let label = if repo.name.is_empty() {
            repo.id_prefix()
        } else {
            repo.name.clone()
        };
        assert_eq!(label, "phodal/routa");
    }

    #[test]
    fn test_github_repo_custom_name() {
        let repo = make_repo("My Routa Fork", "phodal", "routa");
        let label = if repo.name.is_empty() {
            repo.id_prefix()
        } else {
            repo.name.clone()
        };
        assert_eq!(label, "My Routa Fork");
    }

    #[test]
    fn test_parse_github_menu_id_to_url() {
        // Test pulls
        assert_eq!(
            parse_github_menu_id_to_url("tray:gh:pulls:phodal/routa"),
            Some("https://github.com/phodal/routa/pulls".to_string())
        );

        // Test issues
        assert_eq!(
            parse_github_menu_id_to_url("tray:gh:issues:phodal/routa"),
            Some("https://github.com/phodal/routa/issues".to_string())
        );

        // Test repo
        assert_eq!(
            parse_github_menu_id_to_url("tray:gh:repo:phodal/routa"),
            Some("https://github.com/phodal/routa".to_string())
        );

        // Test invalid formats
        assert_eq!(parse_github_menu_id_to_url("invalid"), None);
        assert_eq!(parse_github_menu_id_to_url("tray:gh:invalid"), None);
        assert_eq!(parse_github_menu_id_to_url("tray:gh:unknown:type"), None);
    }

    #[test]
    fn test_parse_github_menu_id_to_url_with_org() {
        assert_eq!(
            parse_github_menu_id_to_url("tray:gh:pulls:myorg/my-project"),
            Some("https://github.com/myorg/my-project/pulls".to_string())
        );
    }

    #[test]
    fn test_workspace_route_for_menu_id() {
        assert_eq!(
            workspace_route_for_menu_id(TRAY_WORKSPACE_SESSIONS_ID),
            Some("/sessions")
        );
        assert_eq!(
            workspace_route_for_menu_id(TRAY_WORKSPACE_KANBAN_ID),
            Some("/kanban")
        );
        assert_eq!(
            workspace_route_for_menu_id(TRAY_WORKSPACE_TEAM_ID),
            Some("/team")
        );
        assert_eq!(workspace_route_for_menu_id(TRAY_MESSAGES_ID), None);
    }

    #[test]
    fn test_absolute_route_for_menu_id() {
        assert_eq!(
            absolute_route_for_menu_id(TRAY_MESSAGES_ID),
            Some("/messages")
        );
        assert_eq!(
            absolute_route_for_menu_id(TRAY_SETTINGS_AGENTS_ID),
            Some("/settings/agents")
        );
        assert_eq!(
            absolute_route_for_menu_id(TRAY_SETTINGS_WEBHOOKS_ID),
            Some("/settings/webhooks")
        );
        assert_eq!(absolute_route_for_menu_id(TRAY_WORKSPACE_SESSIONS_ID), None);
    }

    #[test]
    fn test_should_open_main_window_for_left_click_release() {
        let event = TrayIconEvent::Click {
            id: TRAY_ID.into(),
            position: tauri::PhysicalPosition::new(0.0, 0.0),
            rect: tauri::Rect {
                position: Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                size: Size::Physical(tauri::PhysicalSize::new(12, 12)),
            },
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
        };

        assert!(should_open_main_window_for_tray_event(&event));
    }

    #[test]
    fn test_should_ignore_non_primary_open_clicks() {
        let right_click = TrayIconEvent::Click {
            id: TRAY_ID.into(),
            position: tauri::PhysicalPosition::new(0.0, 0.0),
            rect: tauri::Rect {
                position: Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                size: Size::Physical(tauri::PhysicalSize::new(12, 12)),
            },
            button: MouseButton::Right,
            button_state: MouseButtonState::Up,
        };
        let left_down = TrayIconEvent::Click {
            id: TRAY_ID.into(),
            position: tauri::PhysicalPosition::new(0.0, 0.0),
            rect: tauri::Rect {
                position: Position::Physical(tauri::PhysicalPosition::new(0, 0)),
                size: Size::Physical(tauri::PhysicalSize::new(12, 12)),
            },
            button: MouseButton::Left,
            button_state: MouseButtonState::Down,
        };

        assert!(!should_open_main_window_for_tray_event(&right_click));
        assert!(!should_open_main_window_for_tray_event(&left_down));
    }

    #[test]
    fn tray_uses_template_icon_only_on_macos() {
        assert_eq!(use_template_icon_for_tray(), cfg!(target_os = "macos"));
    }
}
