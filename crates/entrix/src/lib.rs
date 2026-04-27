//! Entrix — Rust implementation of the fitness function engine.
//!
//! This crate provides the core logic for evolutionary architecture fitness
//! functions and replaces the former `tools/entrix` Python runtime.

pub mod evidence;
pub mod file_budgets;
pub mod governance;
pub mod long_file;
pub mod model;
pub mod release_trigger;
pub mod reporting;
pub mod review_context;
pub mod review_trigger;
pub mod run_deadline;
pub mod run_support;
pub mod runner;
pub mod sarif;
pub mod scoring;
pub mod server;
pub mod terminal;
pub mod test_mapping;
