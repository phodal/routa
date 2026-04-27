use crate::shared::models::{RuntimeMessage, RuntimeServiceInfo};
use anyhow::{Context, Result};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
#[cfg(unix)]
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub struct RuntimeFeed {
    event_path: PathBuf,
    offset: u64,
}

impl RuntimeFeed {
    pub fn open(event_path: &Path) -> Result<Self> {
        if let Some(parent) = event_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create runtime event dir {parent:?}"))?;
        }
        let _ = OpenOptions::new()
            .create(true)
            .append(true)
            .open(event_path)
            .with_context(|| format!("create runtime feed {event_path:?}"))?;

        let offset = std::fs::metadata(event_path).map(|m| m.len()).unwrap_or(0);

        Ok(Self {
            event_path: event_path.to_path_buf(),
            offset,
        })
    }

    pub fn read_new(&mut self) -> Result<Vec<RuntimeMessage>> {
        let file = OpenOptions::new()
            .read(true)
            .open(&self.event_path)
            .with_context(|| format!("open runtime feed {:?}", self.event_path))?;
        let mut reader = BufReader::new(file);
        reader
            .seek(SeekFrom::Start(self.offset))
            .context("seek runtime feed")?;

        let mut messages = Vec::new();
        let mut line = String::new();
        loop {
            line.clear();
            let bytes = reader
                .read_line(&mut line)
                .context("read runtime feed line")?;
            if bytes == 0 {
                break;
            }
            if !line.ends_with('\n') {
                break;
            }
            self.offset += bytes as u64;
            if line.trim().is_empty() {
                continue;
            }
            if let Some(message) = decode_feed_line(line.trim_end()) {
                messages.push(message);
            }
        }
        Ok(messages)
    }

    pub fn read_recent_since(&self, cutoff_ms: i64) -> Result<Vec<RuntimeMessage>> {
        let file = OpenOptions::new()
            .read(true)
            .open(&self.event_path)
            .with_context(|| format!("open runtime feed {:?}", self.event_path))?;
        let reader = BufReader::new(file);
        let mut messages = Vec::new();
        for line in reader.lines() {
            let line = line.context("read runtime feed history line")?;
            if line.trim().is_empty() {
                continue;
            }
            let Some(message) = decode_feed_line(line.trim_end()) else {
                continue;
            };
            if message.observed_at_ms() >= cutoff_ms {
                messages.push(message);
            }
        }
        Ok(messages)
    }
}

#[cfg(unix)]
pub struct RuntimeSocket {
    listener: UnixListener,
}

#[cfg(unix)]
impl RuntimeSocket {
    pub fn bind(socket_path: &Path) -> Result<Self> {
        if let Some(parent) = socket_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create runtime socket dir {parent:?}"))?;
        }
        if socket_path.exists() {
            std::fs::remove_file(socket_path)
                .with_context(|| format!("remove stale runtime socket {socket_path:?}"))?;
        }
        let listener = UnixListener::bind(socket_path)
            .with_context(|| format!("bind runtime socket {socket_path:?}"))?;
        listener
            .set_nonblocking(true)
            .context("set runtime socket nonblocking")?;
        Ok(Self { listener })
    }

    pub fn read_pending(&self) -> Result<Vec<RuntimeMessage>> {
        let mut messages = Vec::new();
        loop {
            match self.listener.accept() {
                Ok((stream, _addr)) => {
                    if let Some(message) = read_stream_message(stream)? {
                        messages.push(message);
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(err) => return Err(err).context("accept runtime socket connection"),
            }
        }
        Ok(messages)
    }
}

pub struct RuntimeTcp {
    listener: TcpListener,
}

impl RuntimeTcp {
    pub fn bind(addr: &str) -> Result<Self> {
        let listener =
            TcpListener::bind(addr).with_context(|| format!("bind runtime tcp {addr}"))?;
        listener
            .set_nonblocking(true)
            .context("set runtime tcp nonblocking")?;
        Ok(Self { listener })
    }

    pub fn read_pending(&self) -> Result<Vec<RuntimeMessage>> {
        let mut messages = Vec::new();
        loop {
            match self.listener.accept() {
                Ok((stream, _addr)) => {
                    if let Some(message) = read_tcp_message(stream)? {
                        messages.push(message);
                    }
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(err) => return Err(err).context("accept runtime tcp connection"),
            }
        }
        Ok(messages)
    }
}

pub fn send_message(event_path: &Path, message: &RuntimeMessage) -> Result<()> {
    if let Some(parent) = event_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create runtime event dir {parent:?}"))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(event_path)
        .with_context(|| format!("open runtime event file {event_path:?}"))?;
    let mut payload = serde_json::to_vec(message).context("encode runtime event json")?;
    payload.push(b'\n');
    file.write_all(&payload).context("write runtime event")?;
    file.flush().context("flush runtime event")?;
    Ok(())
}

fn decode_feed_line(line: &str) -> Option<RuntimeMessage> {
    serde_json::from_str(line).ok()
}

#[cfg(unix)]
pub fn send_socket_message(socket_path: &Path, message: &RuntimeMessage) -> Result<()> {
    let mut stream = UnixStream::connect(socket_path)
        .with_context(|| format!("connect runtime socket {socket_path:?}"))?;
    serde_json::to_writer(&mut stream, message).context("write runtime socket json")?;
    stream
        .write_all(b"\n")
        .context("write runtime socket newline")?;
    stream.flush().context("flush runtime socket")?;
    Ok(())
}

#[cfg(not(unix))]
pub fn send_socket_message(_socket_path: &Path, _message: &RuntimeMessage) -> Result<()> {
    anyhow::bail!("Unix sockets are not supported on this platform")
}

pub fn send_tcp_message(addr: &str, message: &RuntimeMessage) -> Result<()> {
    let mut stream =
        TcpStream::connect(addr).with_context(|| format!("connect runtime tcp {addr}"))?;
    serde_json::to_writer(&mut stream, message).context("write runtime tcp json")?;
    stream
        .write_all(b"\n")
        .context("write runtime tcp newline")?;
    stream.flush().context("flush runtime tcp")?;
    Ok(())
}

#[cfg(unix)]
pub fn socket_reachable(socket_path: &Path) -> bool {
    socket_path.exists() && UnixStream::connect(socket_path).is_ok()
}

#[cfg(not(unix))]
pub fn socket_reachable(_socket_path: &Path) -> bool {
    false
}

pub fn tcp_reachable(addr: &str) -> bool {
    addr.parse()
        .ok()
        .and_then(|socket_addr| {
            TcpStream::connect_timeout(&socket_addr, Duration::from_millis(120)).ok()
        })
        .is_some()
}

pub fn write_service_info(info_path: &Path, info: &RuntimeServiceInfo) -> Result<()> {
    if let Some(parent) = info_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create runtime info dir {parent:?}"))?;
    }
    let payload = serde_json::to_vec_pretty(info).context("encode runtime info json")?;
    std::fs::write(info_path, payload).with_context(|| format!("write runtime info {info_path:?}"))
}

pub fn read_service_info(info_path: &Path) -> Result<Option<RuntimeServiceInfo>> {
    if !info_path.exists() {
        return Ok(None);
    }
    let payload = std::fs::read_to_string(info_path)
        .with_context(|| format!("read runtime info {info_path:?}"))?;
    let info = serde_json::from_str(&payload).context("decode runtime info json")?;
    Ok(Some(info))
}

#[cfg(unix)]
fn read_stream_message(stream: UnixStream) -> Result<Option<RuntimeMessage>> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let bytes = reader
        .read_line(&mut line)
        .context("read runtime socket line")?;
    if bytes == 0 || line.trim().is_empty() {
        return Ok(None);
    }
    let message = serde_json::from_str(line.trim_end()).context("decode runtime socket payload")?;
    Ok(Some(message))
}

fn read_tcp_message(stream: TcpStream) -> Result<Option<RuntimeMessage>> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let bytes = reader
        .read_line(&mut line)
        .context("read runtime tcp line")?;
    if bytes == 0 || line.trim().is_empty() {
        return Ok(None);
    }
    let message = serde_json::from_str(line.trim_end()).context("decode runtime tcp payload")?;
    Ok(Some(message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::models::{HookEvent, RuntimeMessage};

    fn hook_message(observed_at_ms: i64, tool_command: Option<String>) -> RuntimeMessage {
        RuntimeMessage::Hook(HookEvent {
            repo_root: "/tmp/repo".to_string(),
            observed_at_ms,
            status: None,
            client: "codex".to_string(),
            session_id: "session-1".to_string(),
            session_display_name: None,
            turn_id: Some("turn-1".to_string()),
            cwd: "/tmp/repo".to_string(),
            model: Some("gpt-test".to_string()),
            transcript_path: None,
            session_source: None,
            event_name: "PostToolUse".to_string(),
            tool_name: Some("apply_patch".to_string()),
            tool_command,
            file_paths: Vec::new(),
            task_id: None,
            task_title: None,
            prompt_preview: None,
            recovered_from_transcript: false,
            tmux_session: None,
            tmux_window: None,
            tmux_pane: None,
        })
    }

    #[test]
    fn read_recent_since_skips_corrupt_history_lines() {
        let dir = tempfile::tempdir().expect("tempdir");
        let event_path = dir.path().join("events.jsonl");
        let valid = serde_json::to_string(&hook_message(200, None)).expect("encode message");
        std::fs::write(
            &event_path,
            format!("{valid}\n{{\"type\"\n:null}}\nnot json\n"),
        )
        .expect("write feed");

        let feed = RuntimeFeed::open(&event_path).expect("open feed");
        let messages = feed.read_recent_since(100).expect("read history");

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].observed_at_ms(), 200);
    }

    #[test]
    fn send_message_writes_multiline_command_as_one_jsonl_record() {
        let dir = tempfile::tempdir().expect("tempdir");
        let event_path = dir.path().join("events.jsonl");
        let message = hook_message(
            300,
            Some("*** Begin Patch\n*** Update File: src/app.ts\n*** End Patch".to_string()),
        );

        send_message(&event_path, &message).expect("send message");

        let contents = std::fs::read_to_string(&event_path).expect("read feed");
        let lines = contents.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 1);
        let decoded: RuntimeMessage = serde_json::from_str(lines[0]).expect("decode line");
        assert_eq!(decoded.observed_at_ms(), 300);
    }

    #[test]
    fn read_new_leaves_incomplete_final_line_for_later() {
        let dir = tempfile::tempdir().expect("tempdir");
        let event_path = dir.path().join("events.jsonl");
        let first = serde_json::to_string(&hook_message(400, None)).expect("encode first");
        let second = serde_json::to_string(&hook_message(500, None)).expect("encode second");
        std::fs::write(&event_path, format!("{first}\n{second}")).expect("write feed");

        let mut feed = RuntimeFeed {
            event_path: event_path.clone(),
            offset: 0,
        };

        let messages = feed.read_new().expect("read first pass");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].observed_at_ms(), 400);

        let mut file = OpenOptions::new()
            .append(true)
            .open(&event_path)
            .expect("open feed");
        file.write_all(b"\n").expect("finish line");

        let messages = feed.read_new().expect("read second pass");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].observed_at_ms(), 500);
    }
}
