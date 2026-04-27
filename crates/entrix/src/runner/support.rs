use std::collections::HashMap;
use std::io;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::model::Metric;

use super::OutputCallback;

pub(crate) fn augment_runner_path(env: &mut HashMap<String, String>) {
    let Ok(current_exe) = std::env::current_exe() else {
        return;
    };
    let Some(bin_dir) = current_exe.parent() else {
        return;
    };

    let current_path = env
        .get("PATH")
        .cloned()
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());
    let bin_dir_str = bin_dir.to_string_lossy().to_string();
    let path_sep = if cfg!(windows) { ";" } else { ":" };

    let already_present = current_path
        .split(path_sep)
        .any(|entry| !entry.is_empty() && entry == bin_dir_str);
    if already_present {
        return;
    }

    let updated = if current_path.is_empty() {
        bin_dir_str
    } else {
        format!("{bin_dir_str}{path_sep}{current_path}")
    };
    env.insert("PATH".to_string(), updated);
}

pub(crate) fn is_infra_failure(
    metric: &Metric,
    output: &str,
    returncode: i32,
    pattern_exit_mismatch: bool,
) -> bool {
    if pattern_exit_mismatch {
        return true;
    }

    let lowered_command = metric.command.to_lowercase();
    let lowered_output = output.to_lowercase();

    if returncode == 127
        || lowered_output.contains("command not found")
        || lowered_output.contains("not recognized as an internal or external command")
    {
        return true;
    }

    if lowered_command.contains("npm audit")
        && [
            "getaddrinfo enotfound",
            "eai_again",
            "econreset",
            "etimedout",
            "network request failed",
            "audit endpoint returned an error",
        ]
        .iter()
        .any(|needle| lowered_output.contains(needle))
    {
        return true;
    }

    false
}

/// Safely truncate a string to a maximum number of bytes at a valid UTF-8 boundary.
pub(crate) fn smart_truncate(s: &str, head_bytes: usize, tail_bytes: usize) -> String {
    let max_bytes = head_bytes + tail_bytes + 200;
    if s.len() <= max_bytes {
        return s.to_owned();
    }

    let mut head_end = head_bytes.min(s.len());
    while head_end > 0 && !s.is_char_boundary(head_end) {
        head_end -= 1;
    }

    let mut tail_start = s.len().saturating_sub(tail_bytes);
    while tail_start < s.len() && !s.is_char_boundary(tail_start) {
        tail_start += 1;
    }

    let omitted = s.len().saturating_sub(head_end + (s.len() - tail_start));
    format!(
        "{}\n\n... [{} characters omitted] ...\n\n{}",
        &s[..head_end],
        omitted,
        &s[tail_start..]
    )
}

pub(crate) struct CommandRunOutput {
    pub(crate) output: Output,
    pub(crate) timed_out: bool,
}

pub(crate) fn run_command_with_timeout(
    command_str: &str,
    project_root: &Path,
    env: &HashMap<String, String>,
    timeout: Duration,
    output_callback: Option<&OutputCallback>,
    metric: &Metric,
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
    let stdout_collector = child.stdout.take();
    let stderr_collector = child.stderr.take();
    let output = if let Some(callback) = output_callback {
        collect_output_with_streaming(
            stdout_collector,
            stderr_collector,
            callback.clone(),
            metric.clone(),
        )
    } else {
        collect_output(stdout_collector, stderr_collector)
    };

    let timed_out = wait_for_child_with_timeout(&mut child, timeout)?;

    if timed_out {
        terminate_child(&mut child)?;
    }

    let status = child.wait()?;
    let output = output
        .join()
        .map_err(|_| io::Error::other("output collector panicked"))?;
    let output = Output {
        status,
        stdout: output.0,
        stderr: output.1,
    };
    Ok(CommandRunOutput { output, timed_out })
}

fn collect_output(
    stdout: Option<std::process::ChildStdout>,
    stderr: Option<std::process::ChildStderr>,
) -> thread::JoinHandle<(Vec<u8>, Vec<u8>)> {
    thread::spawn(move || {
        let stdout_bytes = stdout
            .map(|mut pipe| {
                let mut buffer = Vec::new();
                let _ = io::Read::read_to_end(&mut pipe, &mut buffer);
                buffer
            })
            .unwrap_or_default();
        let stderr_bytes = stderr
            .map(|mut pipe| {
                let mut buffer = Vec::new();
                let _ = io::Read::read_to_end(&mut pipe, &mut buffer);
                buffer
            })
            .unwrap_or_default();
        (stdout_bytes, stderr_bytes)
    })
}

fn collect_output_with_streaming(
    stdout: Option<std::process::ChildStdout>,
    stderr: Option<std::process::ChildStderr>,
    callback: OutputCallback,
    metric: Metric,
) -> thread::JoinHandle<(Vec<u8>, Vec<u8>)> {
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<(String, Vec<u8>, bool)>();

        let stdout_handle = stdout.map(|pipe| {
            let tx = tx.clone();
            let metric = metric.clone();
            let callback = callback.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(pipe);
                let mut raw = Vec::new();
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            raw.extend_from_slice(line.as_bytes());
                            let text = line.trim_end_matches('\n').trim_end_matches('\r');
                            if !text.is_empty() {
                                callback(&metric, "stdout", text);
                            }
                        }
                        Err(_) => break,
                    }
                }
                let _ = tx.send(("stdout".to_string(), raw, true));
            })
        });

        let stderr_handle = stderr.map(|pipe| {
            let tx = tx.clone();
            let metric = metric.clone();
            let callback = callback.clone();
            thread::spawn(move || {
                let mut reader = BufReader::new(pipe);
                let mut raw = Vec::new();
                let mut line = String::new();
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            raw.extend_from_slice(line.as_bytes());
                            let text = line.trim_end_matches('\n').trim_end_matches('\r');
                            if !text.is_empty() {
                                callback(&metric, "stderr", text);
                            }
                        }
                        Err(_) => break,
                    }
                }
                let _ = tx.send(("stderr".to_string(), raw, true));
            })
        });

        drop(tx);

        let mut stdout_bytes = Vec::new();
        let mut stderr_bytes = Vec::new();
        while let Ok((source, raw, _done)) = rx.recv() {
            if source == "stdout" {
                stdout_bytes = raw;
            } else {
                stderr_bytes = raw;
            }
        }

        if let Some(handle) = stdout_handle {
            let _ = handle.join();
        }
        if let Some(handle) = stderr_handle {
            let _ = handle.join();
        }

        (stdout_bytes, stderr_bytes)
    })
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
        .arg(format!("-{signal_name}"))
        .arg(format!("-{pid}"))
        .status()?;

    if status.success() {
        Ok(())
    } else {
        let err = io::Error::other(format!(
            "failed to send {signal_name} to process group {pid}"
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
        .arg(format!("-{pid}"))
        .status()
        .map(|status| !status.success())
        .unwrap_or(false)
}
