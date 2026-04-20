#![allow(unused_imports)]
#![allow(clippy::module_inception)]

pub mod codex_transcript;
pub mod detect;
pub mod events;
pub mod hooks;
pub mod ipc;
pub mod observe;
pub mod repo;

// Re-export commonly used types at this module level
pub use self::detect::{calculate_stats, scan_agents};
pub use self::hooks::{handle_git_event, handle_hook, parse_stdin_payload};
#[cfg(unix)]
pub use self::ipc::RuntimeSocket;
pub use self::ipc::{RuntimeFeed, RuntimeTcp};
pub use self::observe::{
    entry_kind_for_path, entry_kind_for_repo_path, poll_repo, scan_repo, Snapshot,
};
#[cfg(test)]
pub use self::repo::runtime_fitness_artifact_dir;
pub use self::repo::{
    resolve, resolve_runtime, runtime_event_path, runtime_fitness_mailbox_dir, runtime_info_path,
    runtime_socket_path, runtime_tcp_addr, RepoContext,
};
