//! `routa graph` — TreeSitter-based code dependency graph analysis.

pub mod analyze;

pub use analyze::run_analyze;

use clap::{Args, Subcommand};

#[derive(Subcommand, Debug, Clone)]
pub enum GraphAction {
    /// Analyze code dependencies using TreeSitter and produce a dependency graph.
    Analyze(AnalyzeArgs),
}

#[derive(Args, Debug, Clone)]
pub struct AnalyzeArgs {
    /// Directory to analyze. Defaults to the current directory.
    #[arg(long, short = 'd')]
    pub dir: Option<String>,

    /// Language to analyze: rust, typescript, or auto (detect from files).
    #[arg(long, short = 'l', default_value = "auto")]
    pub lang: String,

    /// Output format: json or dot.
    #[arg(long, short = 'f', default_value = "json")]
    pub format: String,

    /// Write output to a file instead of stdout.
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

pub fn run(action: GraphAction) -> Result<(), String> {
    match action {
        GraphAction::Analyze(args) => run_analyze(&args),
    }
}
