use crate::models::{RuntimeMessage, RuntimeServiceInfo};
use anyhow::{Context, Result};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
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
                .with_context(|| format!("create runtime event dir {:?}", parent))?;
        }
        let _ = OpenOptions::new()
            .create(true)
            .append(true)
            .open(event_path)
            .with_context(|| format!("create runtime feed {:?}", event_path))?;

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
            self.offset += bytes as u64;
            if line.trim().is_empty() {
                continue;
            }
            let message: RuntimeMessage =
                serde_json::from_str(line.trim_end()).context("decode runtime feed line")?;
            messages.push(message);
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
            let message: RuntimeMessage =
                serde_json::from_str(line.trim_end()).context("decode runtime feed history")?;
            if message.observed_at_ms() >= cutoff_ms {
                messages.push(message);
            }
        }
        Ok(messages)
    }
}

pub struct RuntimeSocket {
    listener: UnixListener,
}

impl RuntimeSocket {
    pub fn bind(socket_path: &Path) -> Result<Self> {
        if let Some(parent) = socket_path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create runtime socket dir {:?}", parent))?;
        }
        if socket_path.exists() {
            std::fs::remove_file(socket_path)
                .with_context(|| format!("remove stale runtime socket {:?}", socket_path))?;
        }
        let listener = UnixListener::bind(socket_path)
            .with_context(|| format!("bind runtime socket {:?}", socket_path))?;
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
            .with_context(|| format!("create runtime event dir {:?}", parent))?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(event_path)
        .with_context(|| format!("open runtime event file {:?}", event_path))?;
    serde_json::to_writer(&mut file, message).context("write runtime event json")?;
    file.write_all(b"\n")
        .context("write runtime event newline")?;
    file.flush().context("flush runtime event")?;
    Ok(())
}

pub fn send_socket_message(socket_path: &Path, message: &RuntimeMessage) -> Result<()> {
    let mut stream = UnixStream::connect(socket_path)
        .with_context(|| format!("connect runtime socket {:?}", socket_path))?;
    serde_json::to_writer(&mut stream, message).context("write runtime socket json")?;
    stream
        .write_all(b"\n")
        .context("write runtime socket newline")?;
    stream.flush().context("flush runtime socket")?;
    Ok(())
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

pub fn socket_reachable(socket_path: &Path) -> bool {
    socket_path.exists() && UnixStream::connect(socket_path).is_ok()
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
            .with_context(|| format!("create runtime info dir {:?}", parent))?;
    }
    let payload = serde_json::to_vec_pretty(info).context("encode runtime info json")?;
    std::fs::write(info_path, payload)
        .with_context(|| format!("write runtime info {:?}", info_path))
}

pub fn read_service_info(info_path: &Path) -> Result<Option<RuntimeServiceInfo>> {
    if !info_path.exists() {
        return Ok(None);
    }
    let payload = std::fs::read_to_string(info_path)
        .with_context(|| format!("read runtime info {:?}", info_path))?;
    let info = serde_json::from_str(&payload).context("decode runtime info json")?;
    Ok(Some(info))
}

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
