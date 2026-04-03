//! Shell runner — execute metric commands via subprocess.

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use regex::Regex;

use crate::model::{Gate, Metric, MetricResult, ResultState};

/// Callback type for progress events.
pub type ProgressCallback = Box<dyn Fn(&str, &Metric, Option<&MetricResult>) + Send + Sync>;

/// Executes Metric commands as shell subprocesses.
pub struct ShellRunner {
    project_root: PathBuf,
    timeout: u64,
    env_overrides: HashMap<String, String>,
}

impl ShellRunner {
    pub fn new(project_root: &Path) -> Self {
        Self {
            project_root: project_root.to_path_buf(),
            timeout: 300,
            env_overrides: HashMap::new(),
        }
    }

    pub fn with_timeout(mut self, timeout: u64) -> Self {
        self.timeout = timeout;
        self
    }

    pub fn with_env_overrides(mut self, env_overrides: HashMap<String, String>) -> Self {
        self.env_overrides = env_overrides;
        self
    }

    /// Execute a single metric's shell command.
    ///
    /// Returns a MetricResult with pass/fail status based on either
    /// regex pattern matching or process exit code.
    pub fn run(&self, metric: &Metric, dry_run: bool) -> MetricResult {
        // Check waiver first
        if let Some(ref waiver) = metric.waiver {
            if waiver.is_active(None) {
                return MetricResult {
                    metric_name: metric.name.clone(),
                    passed: true,
                    output: format!("[WAIVED] {}", waiver.reason),
                    tier: metric.tier,
                    hard_gate: metric.gate == Gate::Hard,
                    duration_ms: 0.0,
                    state: ResultState::Waived,
                };
            }
        }

        if dry_run {
            return MetricResult {
                metric_name: metric.name.clone(),
                passed: true,
                output: format!("[DRY-RUN] Would run: {}", metric.command),
                tier: metric.tier,
                hard_gate: metric.gate == Gate::Hard,
                duration_ms: 0.0,
                state: ResultState::Pass,
            };
        }

        let start = Instant::now();
        let timeout = metric.timeout_seconds.unwrap_or(self.timeout);

        // Build the environment
        let mut env: HashMap<String, String> = std::env::vars().collect();
        env.extend(self.env_overrides.clone());

        // Use a thread to implement timeout
        let command_str = metric.command.clone();
        let project_root = self.project_root.clone();
        let env_clone = env;

        let result =
            match run_command_with_timeout(&command_str, &project_root, &env_clone, timeout) {
                Ok(command_result) => {
                    let CommandRunOutput { output, timed_out } = command_result;
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let combined = format!("{}{}", stdout, stderr);
                    let output_truncated = truncate_utf8(&combined, 2000);
                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;

                    if timed_out {
                        let timed_out_output = if output_truncated.trim().is_empty() {
                            format!("TIMEOUT ({}s)", timeout)
                        } else {
                            format!("TIMEOUT ({}s)\n{}", timeout, output_truncated)
                        };

                        MetricResult::new(metric.name.clone(), false, timed_out_output, metric.tier)
                            .with_hard_gate(metric.gate == Gate::Hard)
                            .with_duration_ms(elapsed)
                    } else {
                        let passed = if !metric.pattern.is_empty() {
                            Regex::new(&metric.pattern)
                                .map(|re| re.is_match(&combined))
                                .unwrap_or(false)
                        } else {
                            output.status.success()
                        };

                        MetricResult::new(
                            metric.name.clone(),
                            passed,
                            output_truncated,
                            metric.tier,
                        )
                        .with_hard_gate(metric.gate == Gate::Hard)
                        .with_duration_ms(elapsed)
                    }
                }
                Err(e) => {
                    let elapsed = start.elapsed().as_secs_f64() * 1000.0;
                    MetricResult::new(metric.name.clone(), false, e.to_string(), metric.tier)
                        .with_hard_gate(metric.gate == Gate::Hard)
                        .with_duration_ms(elapsed)
                }
            };

        result
    }

    /// Execute multiple metrics, optionally in parallel.
    ///
    /// Results are returned in the same order as the input metrics.
    pub fn run_batch(
        &self,
        metrics: &[Metric],
        parallel: bool,
        dry_run: bool,
        progress_callback: Option<&ProgressCallback>,
    ) -> Vec<MetricResult> {
        if !parallel || dry_run {
            let mut results = Vec::new();
            for metric in metrics {
                if let Some(cb) = progress_callback {
                    cb("start", metric, None);
                }
                let result = self.run(metric, dry_run);
                if let Some(cb) = progress_callback {
                    cb("end", metric, Some(&result));
                }
                results.push(result);
            }
            return results;
        }

        thread::scope(|scope| {
            let handles: Vec<_> = metrics
                .iter()
                .map(|metric| {
                    let metric = metric.clone();
                    scope.spawn(move || {
                        if let Some(cb) = progress_callback {
                            cb("start", &metric, None);
                        }
                        let result = self.run(&metric, false);
                        if let Some(cb) = progress_callback {
                            cb("end", &metric, Some(&result));
                        }
                        result
                    })
                })
                .collect();

            handles
                .into_iter()
                .zip(metrics.iter())
                .map(|(handle, metric)| {
                    handle.join().unwrap_or_else(|_| {
                        MetricResult::new(
                            metric.name.clone(),
                            false,
                            "runner thread panicked",
                            metric.tier,
                        )
                        .with_hard_gate(metric.gate == Gate::Hard)
                    })
                })
                .collect()
        })
    }
}

/// Safely truncate a string to a maximum number of bytes at a valid UTF-8 boundary.
fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    // Find a valid UTF-8 char boundary
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}

struct CommandRunOutput {
    output: Output,
    timed_out: bool,
}

fn run_command_with_timeout(
    command_str: &str,
    project_root: &Path,
    env: &HashMap<String, String>,
    timeout: u64,
) -> io::Result<CommandRunOutput> {
    let mut cmd;
    #[cfg(unix)]
    {
        cmd = Command::new("/bin/bash");
        cmd.arg("-lc").arg(command_str);
    }
    #[cfg(windows)]
    {
        cmd = Command::new("cmd");
        cmd.arg("/C").arg(command_str);
    }
    cmd.current_dir(project_root)
        .envs(env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn()?;
    let timeout_duration = Duration::from_secs(timeout);
    let timed_out = wait_for_child_with_timeout(&mut child, timeout_duration)?;

    if timed_out {
        terminate_child(&mut child)?;
    }

    let output = child.wait_with_output()?;
    Ok(CommandRunOutput { output, timed_out })
}

fn wait_for_child_with_timeout(
    child: &mut std::process::Child,
    timeout: Duration,
) -> io::Result<bool> {
    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return Ok(false);
        }
        if start.elapsed() >= timeout {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn terminate_child(child: &mut std::process::Child) -> io::Result<()> {
    #[cfg(unix)]
    {
        terminate_process_group(child)?;
        Ok(())
    }

    #[cfg(not(unix))]
    {
        child.kill()?;
        Ok(())
    }
}

#[cfg(unix)]
fn terminate_process_group(child: &mut std::process::Child) -> io::Result<()> {
    const GRACE_PERIOD: Duration = Duration::from_millis(200);
    const SIGTERM: i32 = 15;
    const SIGKILL: i32 = 9;
    let pid = child.id() as i32;

    send_signal_to_group(pid, SIGTERM)?;

    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return Ok(());
        }
        if start.elapsed() >= GRACE_PERIOD {
            break;
        }
        thread::sleep(Duration::from_millis(20));
    }

    send_signal_to_group(pid, SIGKILL)?;
    Ok(())
}

#[cfg(unix)]
fn send_signal_to_group(pid: i32, signal: i32) -> io::Result<()> {
    let signal_name = match signal {
        15 => "TERM",
        9 => "KILL",
        _ => {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "unsupported signal",
            ))
        }
    };

    let status = Command::new("kill")
        .arg(format!("-{}", signal_name))
        .arg(format!("-{}", pid))
        .status()?;

    if status.success() {
        Ok(())
    } else {
        let err = io::Error::other(format!(
            "failed to send {} to process group {}",
            signal_name, pid
        ));
        if child_process_group_missing(pid) {
            Ok(())
        } else {
            Err(err)
        }
    }
}

#[cfg(unix)]
fn child_process_group_missing(pid: i32) -> bool {
    Command::new("kill")
        .arg("-0")
        .arg(format!("-{}", pid))
        .status()
        .map(|status| !status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Metric, ResultState, Waiver};
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    type ProgressEvent = (String, String, Option<String>);

    #[test]
    fn test_dry_run() {
        let runner = ShellRunner::new(&tmp_dir());
        let m = Metric::new("test", "echo hello");
        let result = runner.run(&m, true);
        assert!(result.passed);
        assert!(result.output.contains("[DRY-RUN]"));
        assert_eq!(result.metric_name, "test");
    }

    #[test]
    fn test_run_success_exit_code() {
        let runner = ShellRunner::new(&tmp_dir());
        let m = Metric::new("echo_test", "echo ok");
        let result = runner.run(&m, false);
        assert!(result.passed);
        assert!(result.output.contains("ok"));
    }

    fn tmp_dir() -> PathBuf {
        #[cfg(unix)]
        {
            PathBuf::from("/tmp")
        }
        #[cfg(windows)]
        {
            std::env::temp_dir()
        }
    }

    #[test]
    fn test_run_failure_exit_code() {
        let runner = ShellRunner::new(&tmp_dir());
        #[cfg(unix)]
        let cmd = "exit 1";
        #[cfg(windows)]
        let cmd = "cmd /c exit 1";
        let m = Metric::new("fail_test", cmd);
        let result = runner.run(&m, false);
        assert!(!result.passed);
    }

    #[test]
    fn test_run_pattern_match() {
        let runner = ShellRunner::new(&tmp_dir());
        let cmd = if cfg!(windows) {
            "echo Tests 42 passed"
        } else {
            "echo 'Tests 42 passed'"
        };
        let mut m = Metric::new("pattern_test", cmd);
        m.pattern = r"Tests\s+\d+\s+passed".to_string();
        let result = runner.run(&m, false);
        assert!(result.passed);
    }

    #[test]
    fn test_run_pattern_no_match() {
        let runner = ShellRunner::new(&tmp_dir());
        let cmd = if cfg!(windows) {
            "echo Tests 0 failed"
        } else {
            "echo 'Tests 0 failed'"
        };
        let mut m = Metric::new("pattern_fail", cmd);
        m.pattern = r"Tests\s+\d+\s+passed".to_string();
        let result = runner.run(&m, false);
        assert!(!result.passed);
    }

    #[test]
    #[cfg(unix)]
    fn test_run_timeout() {
        let runner = ShellRunner::new(Path::new("/tmp")).with_timeout(1);
        let m = Metric::new("slow", "sleep 10");
        let result = runner.run(&m, false);
        assert!(!result.passed);
        assert!(result.output.contains("TIMEOUT"));
    }

    #[test]
    #[cfg(unix)]
    fn test_run_metric_specific_timeout() {
        let runner = ShellRunner::new(Path::new("/tmp")).with_timeout(5);
        let mut m = Metric::new("slow", "sleep 2");
        m.timeout_seconds = Some(1);
        let result = runner.run(&m, false);
        assert!(!result.passed);
        assert!(result.output.contains("TIMEOUT (1s)"));
    }

    #[test]
    #[cfg(unix)]
    fn test_run_timeout_kills_background_processes() {
        let leak_path = format!("/tmp/routa-entrix-timeout-{}.txt", std::process::id());
        let _ = std::fs::remove_file(&leak_path);

        let runner = ShellRunner::new(Path::new("/tmp")).with_timeout(1);
        let command = format!("sh -c 'sleep 2; echo leaked > {}' & wait", leak_path);
        let result = runner.run(&Metric::new("slow", command), false);

        assert!(!result.passed);
        assert!(result.output.contains("TIMEOUT"));

        thread::sleep(Duration::from_secs(3));
        assert!(!Path::new(&leak_path).exists());
    }

    #[test]
    fn test_run_hard_gate_preserved() {
        let runner = ShellRunner::new(&tmp_dir());
        let m = Metric::new("gate", "echo ok").with_hard_gate(true);
        let result = runner.run(&m, false);
        assert!(result.hard_gate);
    }

    #[test]
    fn test_run_batch_serial() {
        let runner = ShellRunner::new(&tmp_dir());
        let metrics = vec![Metric::new("a", "echo a"), Metric::new("b", "echo b")];
        let results = runner.run_batch(&metrics, false, false, None);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].metric_name, "a");
        assert_eq!(results[1].metric_name, "b");
    }

    #[test]
    fn test_run_batch_parallel() {
        let runner = ShellRunner::new(&tmp_dir());
        let metrics = vec![Metric::new("a", "echo a"), Metric::new("b", "echo b")];
        let results = runner.run_batch(&metrics, true, false, None);
        assert_eq!(results.len(), 2);
        // Order preserved
        assert_eq!(results[0].metric_name, "a");
        assert_eq!(results[1].metric_name, "b");
    }

    #[test]
    #[cfg(unix)]
    fn test_run_batch_parallel_executes_concurrently() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let metrics = vec![Metric::new("a", "sleep 2"), Metric::new("b", "sleep 2")];
        let events: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let cb: ProgressCallback = Box::new(move |event, metric, _result| {
            events_clone
                .lock()
                .unwrap()
                .push((event.to_string(), metric.name.clone()));
        });

        let results = runner.run_batch(&metrics, true, false, Some(&cb));
        let recorded_events = events.lock().unwrap();
        let first_end_index = recorded_events
            .iter()
            .position(|(event, _metric_name)| event == "end")
            .expect("parallel run should emit end events");
        let start_events_before_end = recorded_events[..first_end_index]
            .iter()
            .filter(|(event, _metric_name)| event == "start")
            .count();

        assert_eq!(results.len(), 2);
        assert!(
            start_events_before_end >= 2,
            "both metrics should start before the first metric ends, got events: {:?}",
            *recorded_events
        );
    }

    #[test]
    fn test_run_batch_dry_run() {
        let runner = ShellRunner::new(&tmp_dir());
        let metrics = vec![Metric::new("x", "rm -rf /")];
        let results = runner.run_batch(&metrics, false, true, None);
        assert!(results[0].passed);
        assert!(results[0].output.contains("[DRY-RUN]"));
    }

    #[test]
    fn test_run_batch_emits_progress_events() {
        let runner = ShellRunner::new(&tmp_dir());
        let metrics = vec![Metric::new("a", "echo a"), Metric::new("b", "echo b")];
        let events: Arc<Mutex<Vec<ProgressEvent>>> = Arc::new(Mutex::new(Vec::new()));

        let events_clone = events.clone();
        let cb: ProgressCallback = Box::new(move |event, metric, result| {
            events_clone.lock().unwrap().push((
                event.to_string(),
                metric.name.clone(),
                result.map(|r| r.state.as_str().to_string()),
            ));
        });

        runner.run_batch(&metrics, false, false, Some(&cb));

        let captured = events.lock().unwrap();
        assert_eq!(captured.len(), 4);
        assert_eq!(captured[0], ("start".to_string(), "a".to_string(), None));
        assert_eq!(
            captured[1],
            ("end".to_string(), "a".to_string(), Some("pass".to_string()))
        );
        assert_eq!(captured[2], ("start".to_string(), "b".to_string(), None));
        assert_eq!(
            captured[3],
            ("end".to_string(), "b".to_string(), Some("pass".to_string()))
        );
    }

    #[test]
    fn test_run_waived_metric() {
        let runner = ShellRunner::new(Path::new("/tmp"));
        let today = chrono::Utc::now().date_naive();
        let mut metric = Metric::new("waived", "exit 1");
        metric.waiver = Some(Waiver {
            reason: "temporary waiver".to_string(),
            owner: String::new(),
            tracking_issue: None,
            expires_at: Some(today + chrono::Duration::days(1)),
        });
        let result = runner.run(&metric, false);
        assert!(result.passed);
        assert_eq!(result.state, ResultState::Waived);
        assert!(result.output.contains("temporary waiver"));
    }
}
