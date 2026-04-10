use crate::models::RuntimeMessage;
use anyhow::{Context, Result};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

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

    pub fn event_path(&self) -> &Path {
        &self.event_path
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
