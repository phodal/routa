//! `routa graph` — TreeSitter-backed code dependency graph analysis.

pub mod analyze;

pub use analyze::{analyze_directory, AnalysisLang, DependencyGraph};
use clap::{Args, Subcommand, ValueEnum};

#[derive(Subcommand, Debug, Clone)]
pub enum GraphAction {
    /// Analyze code dependencies and emit a dependency graph.
    Analyze(AnalyzeArgs),
}

#[derive(Args, Debug, Clone)]
pub struct AnalyzeArgs {
    /// Directory to analyze. Defaults to the current working directory.
    #[arg(long, short = 'd')]
    pub dir: Option<String>,

    /// Language to analyze.
    #[arg(long, short = 'l', value_enum, default_value_t = GraphLanguageArg::Auto)]
    pub lang: GraphLanguageArg,

    /// Output format.
    #[arg(long, short = 'f', value_enum, default_value_t = GraphOutputFormat::Json)]
    pub format: GraphOutputFormat,

    /// Write output to a file instead of stdout.
    #[arg(long, short = 'o')]
    pub output: Option<String>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum GraphLanguageArg {
    Auto,
    Rust,
    #[value(alias = "ts")]
    Typescript,
}

impl GraphLanguageArg {
    pub(crate) fn into_analysis_lang(self) -> AnalysisLang {
        match self {
            Self::Auto => AnalysisLang::Auto,
            Self::Rust => AnalysisLang::Rust,
            Self::Typescript => AnalysisLang::TypeScript,
        }
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum GraphOutputFormat {
    Json,
    Dot,
}

pub fn run(action: GraphAction) -> Result<(), String> {
    match action {
        GraphAction::Analyze(args) => analyze::run_analyze(&args),
    }
}
