use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::model::{Dimension, Metric};
use crate::model::{DimensionScore, FitnessReport, MetricResult, ResultState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamMode {
    Off,
    Failures,
    All,
}

impl StreamMode {
    pub fn parse(value: &str) -> Self {
        match value {
            "all" => Self::All,
            "off" => Self::Off,
            _ => Self::Failures,
        }
    }
}

pub struct TerminalReporter {
    verbose: bool,
    stream_mode: StreamMode,
}

pub struct ShellOutputController {
    reporter: Arc<TerminalReporter>,
    buffered_lines: Mutex<HashMap<String, Vec<(String, String)>>>,
}

impl ShellOutputController {
    pub fn new(reporter: Arc<TerminalReporter>) -> Self {
        Self {
            reporter,
            buffered_lines: Mutex::new(HashMap::new()),
        }
    }

    pub fn should_capture_output(&self) -> bool {
        self.reporter.stream_mode != StreamMode::Off
    }

    pub fn handle_output(&self, metric: &Metric, source: &str, line: &str) {
        match self.reporter.stream_mode {
            StreamMode::Off => {}
            StreamMode::All => self
                .reporter
                .print_metric_output(&metric.name, source, line),
            StreamMode::Failures => {
                self.buffered_lines
                    .lock()
                    .unwrap()
                    .entry(metric.name.clone())
                    .or_default()
                    .push((source.to_string(), line.to_string()));
            }
        }
    }

    pub fn handle_progress(&self, event: &str, metric: &Metric, result: Option<&MetricResult>) {
        self.reporter.print_metric_progress(
            event,
            &metric.name,
            metric.tier.as_str(),
            metric.gate == crate::model::Gate::Hard,
            result,
        );

        if event != "end" || self.reporter.stream_mode != StreamMode::Failures {
            return;
        }

        let buffered = self
            .buffered_lines
            .lock()
            .unwrap()
            .remove(&metric.name)
            .unwrap_or_default();
        if !matches!(
            result.map(|result| result.state),
            Some(ResultState::Fail | ResultState::Unknown)
        ) {
            return;
        }

        for (source, line) in buffered {
            self.reporter
                .print_metric_output(&metric.name, &source, &line);
        }
    }
}

impl TerminalReporter {
    pub fn new(verbose: bool, stream_mode: StreamMode) -> Self {
        Self {
            verbose,
            stream_mode,
        }
    }

    pub fn print_header(&self, dry_run: bool, tier: Option<&str>, parallel: bool) {
        println!("{}", "=".repeat(60));
        println!("FITNESS FUNCTION REPORT");
        if dry_run {
            println!("(DRY-RUN MODE)");
        }
        if let Some(tier) = tier {
            println!("(TIER: {})", tier.to_uppercase());
        }
        if parallel {
            println!("(PARALLEL MODE)");
        }
        println!("{}", "=".repeat(60));
    }

    pub fn print_metric_progress(
        &self,
        event: &str,
        metric_name: &str,
        tier: &str,
        hard_gate: bool,
        result: Option<&MetricResult>,
    ) {
        let hard = if hard_gate { " [HARD GATE]" } else { "" };
        let tier_label = format!(" [{tier}]");
        if event == "start" {
            println!("[RUNNING] {metric_name}{hard}{tier_label}");
            return;
        }

        let status = result
            .map(|result| match result.state {
                ResultState::Pass => "PASS",
                ResultState::Fail => "FAIL",
                ResultState::Unknown => "UNKNOWN",
                ResultState::Skipped => "SKIPPED",
                ResultState::Waived => "WAIVED",
            })
            .unwrap_or("UNKNOWN");
        let duration = result
            .filter(|result| result.duration_ms > 0.0)
            .map(|result| format!(" in {:.1}s", result.duration_ms / 1000.0))
            .unwrap_or_default();
        println!("[DONE] {metric_name}: {status}{hard}{tier_label}{duration}");
    }

    pub fn print_metric_output(&self, metric_name: &str, source: &str, line: &str) {
        let text = line.trim();
        if text.is_empty() {
            return;
        }
        println!("[LOG][{source}] {metric_name}: {text}");
    }

    pub fn report(&self, report: &FitnessReport, show_tier: bool) {
        for dimension in &report.dimensions {
            self.print_dimension(dimension, None, show_tier);
        }
        self.print_footer(report);
    }

    pub fn report_with_dimensions(
        &self,
        report: &FitnessReport,
        dimensions: &[Dimension],
        show_tier: bool,
    ) {
        for (index, dimension) in report.dimensions.iter().enumerate() {
            let source_file = dimensions.get(index).map(|item| item.source_file.as_str());
            self.print_dimension(dimension, source_file, show_tier);
        }
        self.print_footer(report);
    }

    fn print_dimension(
        &self,
        dimension: &DimensionScore,
        source_file: Option<&str>,
        show_tier: bool,
    ) {
        println!(
            "\n## {} (weight: {}%)",
            dimension.dimension.to_uppercase(),
            dimension.weight
        );
        if let Some(source_file) = source_file.filter(|value| !value.is_empty()) {
            println!("   Source: {source_file}");
        }
        for result in &dimension.results {
            self.print_result(result, show_tier);
        }
        if dimension.total > 0 {
            println!("   Score: {:.0}%", dimension.score);
        }
    }

    fn print_result(&self, result: &MetricResult, show_tier: bool) {
        let status = match result.state {
            ResultState::Pass => "PASS",
            ResultState::Fail => "FAIL",
            ResultState::Unknown => "UNKNOWN",
            ResultState::Skipped => "SKIPPED",
            ResultState::Waived => "WAIVED",
        };
        let hard = if result.hard_gate { " [HARD GATE]" } else { "" };
        let tier = if show_tier {
            format!(" [{}]", result.tier.as_str())
        } else {
            String::new()
        };
        println!("   - {}: {}{}{}", result.metric_name, status, hard, tier);

        let should_print_output = matches!(result.state, ResultState::Fail | ResultState::Unknown)
            && (self.verbose
                || result.hard_gate
                || result.is_infra_error()
                || self.stream_mode == StreamMode::Off);
        if !should_print_output {
            return;
        }

        let lines = result
            .output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>();
        if lines.is_empty() {
            return;
        }

        let max_head = 20usize;
        let max_tail = 30usize;
        if lines.len() <= max_head + max_tail {
            for line in lines {
                println!("     > {line}");
            }
            return;
        }

        for line in &lines[..max_head] {
            println!("     > {line}");
        }
        println!(
            "     > ... ({} lines omitted) ...",
            lines.len() - max_head - max_tail
        );
        for line in &lines[lines.len() - max_tail..] {
            println!("     > {line}");
        }
    }

    fn print_footer(&self, report: &FitnessReport) {
        println!("\n{}", "=".repeat(60));
        let scored_dimensions = report
            .dimensions
            .iter()
            .filter(|dimension| dimension.weight > 0 && dimension.total > 0)
            .count();
        let infra_errors = report
            .dimensions
            .iter()
            .flat_map(|dimension| dimension.results.iter())
            .filter(|result| result.is_infra_error())
            .map(|result| result.metric_name.clone())
            .collect::<Vec<_>>();

        if !infra_errors.is_empty() {
            println!("INFRA ERRORS: {}", infra_errors.join(", "));
            println!("These failures are likely checker/tooling problems, not code defects.");
        }

        if report.runtime_timed_out {
            println!("BLOCK - Runtime exceeded the max execution budget");
        } else if report.hard_gate_blocked {
            let failures = report
                .dimensions
                .iter()
                .flat_map(|dimension| dimension.hard_gate_failures.iter())
                .cloned()
                .collect::<Vec<_>>();
            println!("HARD GATES FAILED: {}", failures.join(", "));
            println!("Cannot proceed until hard gates pass.");
        } else if !report.dimensions.is_empty() && scored_dimensions == 0 {
            println!("FINAL SCORE: n/a");
            println!("PASS - No weighted metrics were scored in this run");
        } else if !report.dimensions.is_empty() {
            println!("FINAL SCORE: {:.1}%", report.final_score);
            if report.score_blocked {
                println!("BLOCK - Score too low");
            } else if report.final_score >= 90.0 {
                println!("PASS");
            } else if report.final_score >= 80.0 {
                println!("WARN - Consider improvements");
            } else {
                println!("PASS");
            }
        }

        println!("{}", "=".repeat(60));
    }
}

pub struct AsciiReporter {
    width: usize,
}

pub struct RichReporter {
    width: usize,
}

pub struct RichLiveProgressReporter {
    width: usize,
    refresh_interval: Duration,
    state: Mutex<RichLiveProgressState>,
}

struct RichLiveProgressState {
    order: Vec<String>,
    entries: HashMap<String, RichLiveMetricState>,
    tail: Vec<String>,
    last_render: Option<Instant>,
}

struct RichLiveMetricState {
    tier: String,
    hard_gate: bool,
    status: &'static str,
    duration_ms: Option<f64>,
}

impl AsciiReporter {
    pub fn new(width: usize) -> Self {
        Self { width }
    }

    pub fn report(&self, report: &FitnessReport) {
        println!("\nVISUAL SCORECARD");
        println!("{}", "-".repeat(60));
        for dimension in &report.dimensions {
            let scorable = dimension.weight > 0 && dimension.total > 0;
            let score_text = if scorable {
                format!("{:>5.1}%", dimension.score)
            } else {
                "  n/a".to_string()
            };
            println!(
                "{:<16} {} {} {:<5} weight={:>2}% metrics={}",
                dimension
                    .dimension
                    .to_uppercase()
                    .chars()
                    .take(16)
                    .collect::<String>(),
                bar(dimension.score, self.width),
                score_text,
                status_for_score(dimension.score, scorable),
                dimension.weight,
                metric_summary(dimension)
            );
        }
        println!("{}", "-".repeat(60));
        println!(
            "FINAL SCORE      {} {:>5.1}% {}",
            bar(report.final_score, self.width),
            report.final_score,
            status_for_score(report.final_score, !report.dimensions.is_empty())
        );
        if report.hard_gate_blocked {
            println!("Hard gates are blocking this run.");
        } else if report.score_blocked {
            println!("Score is below the configured minimum threshold.");
        }
    }
}

impl RichReporter {
    pub fn new(width: usize) -> Self {
        Self { width }
    }

    pub fn report(&self, report: &FitnessReport) {
        println!("\n{:^74}", "Fitness Scorecard");
        println!("┏{0:━<19}┳{0:━<27}┳{0:━<8}┳{0:━<9}┳{0:━<8}┓", "");
        println!(
            "┃ {:<17} ┃ {:<25} ┃ {:>6} ┃ {:>7} ┃ {:<6} ┃",
            "Dimension", "Score", "Weight", "Metrics", "Status"
        );
        println!("┡{0:━<19}╇{0:━<27}╇{0:━<8}╇{0:━<9}╇{0:━<8}┩", "");

        for dimension in &report.dimensions {
            let scorable = dimension.weight > 0 && dimension.total > 0;
            let score_text = if scorable {
                format!("{:>5.1}%", dimension.score)
            } else {
                "  n/a".to_string()
            };
            println!(
                "│ {:<17} │ {} {} │ {:>6}% │ {:>7} │ {:<6} │",
                dimension
                    .dimension
                    .to_uppercase()
                    .chars()
                    .take(17)
                    .collect::<String>(),
                bar(dimension.score, self.width),
                score_text,
                dimension.weight,
                metric_summary(dimension),
                status_for_score(dimension.score, scorable),
            );
        }

        println!("└{0:─<19}┴{0:─<27}┴{0:─<8}┴{0:─<9}┴{0:─<8}┘", "");
        println!(
            "\nFINAL SCORE {} {:>5.1}% {}",
            bar(report.final_score, self.width),
            report.final_score,
            status_for_score(report.final_score, !report.dimensions.is_empty())
        );
        if report.hard_gate_blocked {
            println!("Hard gates are blocking this run.");
        } else if report.score_blocked {
            println!("Score is below the configured minimum threshold.");
        }

        let failures = report
            .dimensions
            .iter()
            .flat_map(|dimension| {
                dimension
                    .results
                    .iter()
                    .filter(|result| matches!(result.state, ResultState::Fail))
                    .map(|result| result.metric_name.clone())
            })
            .collect::<Vec<_>>();
        if !failures.is_empty() {
            println!("Failing metrics: {}", failures.join(", "));
        }
    }
}

impl RichLiveProgressReporter {
    pub fn new(width: usize, refresh_per_second: usize) -> Self {
        let refresh_per_second = refresh_per_second.max(1) as u64;
        Self {
            width,
            refresh_interval: Duration::from_millis(1000 / refresh_per_second),
            state: Mutex::new(RichLiveProgressState {
                order: Vec::new(),
                entries: HashMap::new(),
                tail: Vec::new(),
                last_render: None,
            }),
        }
    }

    pub fn setup(&self, metrics: &[Metric]) {
        let mut state = self.state.lock().unwrap();
        state.order.clear();
        state.entries.clear();
        state.tail.clear();
        state.last_render = None;
        for metric in metrics {
            state.order.push(metric.name.clone());
            state.entries.insert(
                metric.name.clone(),
                RichLiveMetricState {
                    tier: metric.tier.as_str().to_string(),
                    hard_gate: metric.gate == crate::model::Gate::Hard,
                    status: "queued",
                    duration_ms: None,
                },
            );
        }
        drop(state);
        self.force_render();
    }

    pub fn handle_progress(&self, event: &str, metric: &Metric, result: Option<&MetricResult>) {
        let mut state = self.state.lock().unwrap();
        let Some(entry) = state.entries.get_mut(&metric.name) else {
            return;
        };

        if event == "start" {
            entry.status = "running";
            entry.duration_ms = None;
        } else if let Some(result) = result {
            let status = match result.state {
                ResultState::Pass => "passed",
                ResultState::Fail => "failed",
                ResultState::Unknown => "unknown",
                ResultState::Skipped => "skipped",
                ResultState::Waived => "waived",
            };
            entry.status = status;
            entry.duration_ms = (result.duration_ms > 0.0).then_some(result.duration_ms);
            let hard_gate = entry.hard_gate;

            if matches!(
                result.state,
                ResultState::Fail | ResultState::Skipped | ResultState::Unknown
            ) {
                let status_label = status.to_uppercase();
                for line in result
                    .output
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .take(3)
                {
                    let marker = if hard_gate { "HARD" } else { "SOFT" };
                    state.tail.push(format!(
                        "[{}|{}|{}] {}",
                        metric.name,
                        marker,
                        status_label,
                        truncate_tail_line(line),
                    ));
                }
                if state.tail.len() > 6 {
                    let drain = state.tail.len() - 6;
                    state.tail.drain(0..drain);
                }
            }
        }

        let now = Instant::now();
        let should_render = state
            .last_render
            .map(|last| now.duration_since(last) >= self.refresh_interval)
            .unwrap_or(true);
        if should_render {
            state.last_render = Some(now);
            let snapshot = render_live_snapshot(self.width, &state);
            drop(state);
            print!("{snapshot}");
        }
    }

    pub fn force_render(&self) {
        let mut state = self.state.lock().unwrap();
        state.last_render = Some(Instant::now());
        let snapshot = render_live_snapshot(self.width, &state);
        drop(state);
        print!("{snapshot}");
    }
}

fn truncate_tail_line(line: &str) -> String {
    let mut clean = line.replace('\n', " ");
    if clean.chars().count() > 200 {
        clean = clean.chars().take(197).collect::<String>() + "...";
    }
    clean
}

fn render_live_snapshot(width: usize, state: &RichLiveProgressState) -> String {
    let mut queued = 0;
    let mut running = 0;
    let mut passed = 0;
    let mut failed = 0;
    let mut hard_failures = 0;
    for name in &state.order {
        if let Some(entry) = state.entries.get(name) {
            match entry.status {
                "queued" => queued += 1,
                "running" => running += 1,
                "passed" => passed += 1,
                "failed" => {
                    failed += 1;
                    if entry.hard_gate {
                        hard_failures += 1;
                    }
                }
                _ => {}
            }
        }
    }

    let mut out = String::new();
    out.push('\n');
    out.push_str(&format!(
        "{}\n",
        "Fitness Live Progress".chars().take(74).collect::<String>()
    ));
    out.push_str(&format!(
        "passed={passed} failed={failed} hard_failures={hard_failures} running={running} queued={queued}\n"
    ));
    out.push_str(&format!(
        "┏{0:━<4}┳{0:━<28}┳{0:━<10}┳{0:━<8}┳{0:━<6}┳{0:━<8}┓\n",
        ""
    ));
    out.push_str(&format!(
        "┃ {:>2} ┃ {:<26} ┃ {:<8} ┃ {:<6} ┃ {:<4} ┃ {:>6} ┃\n",
        "#", "Metric", "State", "Tier", "Gate", "Time"
    ));
    out.push_str(&format!(
        "┡{0:━<4}╇{0:━<28}╇{0:━<10}╇{0:━<8}╇{0:━<6}╇{0:━<8}┩\n",
        ""
    ));
    for (idx, name) in state.order.iter().enumerate() {
        if let Some(entry) = state.entries.get(name) {
            let display_name = name.chars().take(26).collect::<String>();
            let gate = if entry.hard_gate { "HARD" } else { "SOFT" };
            let time = entry
                .duration_ms
                .map(|ms| format!("{:.1}s", ms / 1000.0))
                .unwrap_or_default();
            out.push_str(&format!(
                "│ {:>2} │ {:<26} │ {:<8} │ {:<6} │ {:<4} │ {:>6} ┃\n",
                idx + 1,
                display_name,
                live_status_label(entry.status),
                entry.tier,
                gate,
                time
            ));
        }
    }
    out.push_str(&format!(
        "└{0:─<4}┴{0:─<28}┴{0:─<10}┴{0:─<8}┴{0:─<6}┴{0:─<8}┘\n",
        ""
    ));
    if !state.tail.is_empty() {
        out.push_str("tail:\n");
        for line in &state.tail {
            out.push_str("- ");
            out.push_str(line);
            out.push('\n');
        }
    }
    out.push_str(&format!("bar: {}\n", bar(progress_score(state), width)));
    out
}

fn live_status_label(status: &str) -> &'static str {
    match status {
        "queued" => "WAIT",
        "running" => "RUN",
        "passed" => "PASS",
        "failed" => "FAIL",
        "skipped" => "SKIP",
        "waived" => "WAIVE",
        _ => "UNK",
    }
}

fn progress_score(state: &RichLiveProgressState) -> f64 {
    let total = state.order.len();
    if total == 0 {
        return 0.0;
    }
    let done = state
        .order
        .iter()
        .filter(|name| {
            state.entries.get(*name).is_some_and(|entry| {
                matches!(
                    entry.status,
                    "passed" | "failed" | "skipped" | "waived" | "unknown"
                )
            })
        })
        .count();
    (done as f64 / total as f64) * 100.0
}

fn status_for_score(score: f64, scorable: bool) -> &'static str {
    if !scorable {
        return "INFO";
    }
    if score >= 90.0 {
        "PASS"
    } else if score >= 80.0 {
        "WARN"
    } else {
        "BLOCK"
    }
}

fn bar(score: f64, width: usize) -> String {
    let clamped = score.clamp(0.0, 100.0);
    let filled = ((clamped / 100.0) * width as f64).round() as usize;
    format!("{}{}", "█".repeat(filled), "░".repeat(width - filled))
}

fn metric_summary(dimension: &DimensionScore) -> String {
    if dimension.total == 0 {
        "n/a".to_string()
    } else {
        format!("{}/{}", dimension.passed, dimension.total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Metric, MetricResult, Tier};

    #[test]
    fn stream_mode_parses_supported_values() {
        assert_eq!(StreamMode::parse("off"), StreamMode::Off);
        assert_eq!(StreamMode::parse("all"), StreamMode::All);
        assert_eq!(StreamMode::parse("failures"), StreamMode::Failures);
        assert_eq!(StreamMode::parse("unknown"), StreamMode::Failures);
    }

    #[test]
    fn shell_output_controller_only_captures_when_enabled() {
        let controller = ShellOutputController::new(Arc::new(TerminalReporter::new(
            false,
            StreamMode::Failures,
        )));
        assert!(controller.should_capture_output());

        let disabled =
            ShellOutputController::new(Arc::new(TerminalReporter::new(false, StreamMode::Off)));
        assert!(!disabled.should_capture_output());
    }

    #[test]
    fn shell_output_controller_buffers_failure_lines() {
        let controller = ShellOutputController::new(Arc::new(TerminalReporter::new(
            false,
            StreamMode::Failures,
        )));
        let metric = Metric::new("lint", "echo lint");
        controller.handle_output(&metric, "stdout", "first");
        controller.handle_output(&metric, "stderr", "second");
        assert_eq!(
            controller
                .buffered_lines
                .lock()
                .unwrap()
                .get("lint")
                .map(|lines| lines.len()),
            Some(2)
        );

        let result = MetricResult::new("lint", true, "ok", Tier::Fast);
        controller.handle_progress("end", &metric, Some(&result));
        assert!(controller
            .buffered_lines
            .lock()
            .unwrap()
            .get("lint")
            .is_none());
    }

    #[test]
    fn shell_output_controller_all_mode_does_not_buffer_lines() {
        let controller =
            ShellOutputController::new(Arc::new(TerminalReporter::new(false, StreamMode::All)));
        let metric = Metric::new("lint", "echo lint");
        controller.handle_output(&metric, "stdout", "line one");
        assert!(controller
            .buffered_lines
            .lock()
            .unwrap()
            .get("lint")
            .is_none());
    }

    #[test]
    fn shell_output_controller_flushes_and_clears_failure_buffer() {
        let controller = ShellOutputController::new(Arc::new(TerminalReporter::new(
            false,
            StreamMode::Failures,
        )));
        let metric = Metric::new("lint", "echo lint");
        controller.handle_output(&metric, "stdout", "line one");
        let result = MetricResult::new("lint", false, "failed", Tier::Fast);
        controller.handle_progress("end", &metric, Some(&result));
        assert!(controller
            .buffered_lines
            .lock()
            .unwrap()
            .get("lint")
            .is_none());
    }
}
