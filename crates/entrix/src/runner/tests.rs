use super::*;
use crate::model::{Metric, ResultState, Waiver};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

type ProgressEvent = (String, String, Option<String>);

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
fn test_run_pattern_non_zero_exit_is_unknown() {
    let runner = ShellRunner::new(&tmp_dir());
    let cmd = if cfg!(windows) {
        "echo checker crashed && cmd /c exit 1"
    } else {
        "echo 'checker crashed'; exit 1"
    };
    let mut metric = Metric::new("pattern_unknown", cmd);
    metric.pattern = "all good".to_string();
    let result = runner.run(&metric, false);
    assert!(!result.passed);
    assert_eq!(result.state, ResultState::Unknown);
    assert!(result.is_infra_error());
}

#[test]
fn test_run_command_not_found_is_unknown() {
    let runner = ShellRunner::new(&tmp_dir());
    let metric = Metric::new("missing_tool", "definitely-not-a-real-command-xyz");
    let result = runner.run(&metric, false);
    assert!(!result.passed);
    assert_eq!(result.state, ResultState::Unknown);
    assert!(result.is_infra_error());
}

#[test]
fn test_run_npm_audit_dns_failure_is_unknown() {
    let metric = Metric::new(
        "npm_audit_critical",
        "npm audit --omit=dev --audit-level=critical",
    );
    let output = "npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\nnpm error audit endpoint returned an error\n";
    assert!(is_infra_failure(&metric, output, 1, false));
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
    let leak_path = format!("/tmp/entrix-timeout-{}.txt", std::process::id());
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

#[test]
#[cfg(unix)]
fn test_run_streaming_emits_output_callback() {
    let lines: Arc<Mutex<Vec<(String, String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let captured = Arc::clone(&lines);
    let callback: OutputCallback = Arc::new(move |metric, source, line| {
        captured
            .lock()
            .unwrap()
            .push((metric.name.clone(), source.to_string(), line.to_string()));
    });

    let runner = ShellRunner::new(Path::new("/tmp")).with_output_callback(callback);
    let metric = Metric::new("streamed", "printf 'hello\\n' && printf 'oops\\n' >&2");
    let result = runner.run(&metric, false);

    assert!(result.passed);
    let captured = lines.lock().unwrap();
    assert!(captured
        .iter()
        .any(|entry| entry.0 == "streamed" && entry.1 == "stdout" && entry.2 == "hello"));
    assert!(captured
        .iter()
        .any(|entry| entry.0 == "streamed" && entry.1 == "stderr" && entry.2 == "oops"));
}

#[test]
fn test_smart_truncate_keeps_head_and_tail() {
    let source = format!("{}\n{}", "a".repeat(4500), "z".repeat(4500));
    let truncated = smart_truncate(&source, 4000, 4000);
    assert!(truncated.contains("... ["));
    assert!(truncated.starts_with(&"a".repeat(4000)));
    assert!(truncated.ends_with(&"z".repeat(4000)));
}
