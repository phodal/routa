use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use routa_server::{start_server, ServerConfig};

pub struct ApiFixture {
    pub base_url: String,
    pub client: Client,
    pub db_path: PathBuf,
}

impl ApiFixture {
    pub async fn new() -> Self {
        let db_path = random_db_path();
        let config = ServerConfig {
            host: "127.0.0.1".to_string(),
            port: 0,
            db_path: db_path.to_string_lossy().to_string(),
            static_dir: None,
        };

        let addr = start_server(config)
            .await
            .expect("start server for api fixture");
        let fixture = Self {
            base_url: format!("http://{addr}"),
            client: Client::new(),
            db_path,
        };
        fixture.wait_until_ready().await;
        fixture
    }

    pub fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    pub async fn wait_until_ready(&self) {
        for _ in 0..50 {
            if self
                .client
                .get(self.endpoint("/api/health"))
                .send()
                .await
                .is_ok_and(|resp| resp.status() == StatusCode::OK)
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("server did not become ready");
    }
}

impl Drop for ApiFixture {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.db_path);
    }
}

pub fn random_db_path() -> PathBuf {
    std::env::temp_dir().join(format!("routa-server-api-{}.db", uuid::Uuid::new_v4()))
}
