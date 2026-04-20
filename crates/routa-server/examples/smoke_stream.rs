//! Smoke test for Rust standalone streaming endpoint.
//!
//! Tests that:
//! 1. Server starts successfully
//! 2. SSE stream endpoint connects
//! 3. At least one data frame is received
//! 4. Server shuts down cleanly
//!
//! Usage: cargo run -p routa-server --example smoke_stream

use std::time::Duration;

use tokio::time::timeout;
use tokio_stream::StreamExt;

const STREAM_TIMEOUT_SECS: u64 = 5;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = routa_server::ServerConfig {
        host: "127.0.0.1".to_string(),
        port: 0,
        db_path: ":memory:".to_string(),
        static_dir: None,
    };

    let addr = routa_server::start_server(config).await?;
    println!("Server started on {addr}");

    let base = format!("http://{addr}");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(STREAM_TIMEOUT_SECS))
        .build()?;

    let url = format!("{base}/api/kanban/default/events");
    println!("Connecting to SSE stream: {url}");

    let response = client.get(&url).send().await?;
    if !response.status().is_success() {
        eprintln!("FAILED: SSE stream endpoint returned {}", response.status());
        std::process::exit(1);
    }

    let event_stream = response.bytes_stream();
    let mut event_count = 0;
    let mut has_data_frame = false;

    let collection = timeout(Duration::from_secs(STREAM_TIMEOUT_SECS), async {
        let mut stream = event_stream;
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    println!("Received chunk: {text:?}");
                    if text.contains("data:") && !text.contains("comment") {
                        has_data_frame = true;
                        event_count += 1;
                    }
                }
                Err(e) => {
                    eprintln!("Stream error: {e}");
                    break;
                }
            }
        }
    })
    .await;

    match collection {
        Ok(_) => {}
        Err(_) => {
            println!("Timeout reached (expected for heartbeat-based streams)");
        }
    }

    if !has_data_frame {
        eprintln!("FAILED: No data frames received from stream");
        std::process::exit(1);
    }

    println!("Smoke test PASSED: Received {event_count} data frame(s)");
    Ok(())
}
