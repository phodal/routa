use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use reqwest::StatusCode;
use serde_json::Value;
use tempfile::TempDir;

#[path = "common/mod.rs"]
mod common;
use common::ApiFixture;

struct GitRepoFixture {
    _temp: TempDir,
    repo_path: PathBuf,
    feature_sha: String,
}

impl GitRepoFixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().expect("tempdir should exist");
        let repo_path = temp.path().join("repo");
        fs::create_dir_all(&repo_path).expect("repo dir should exist");

        let init = Command::new("git")
            .args(["init", "--no-bare", "-b", "main"])
            .current_dir(&repo_path)
            .output()
            .expect("git init should run");
        if !init.status.success() {
            panic!(
                "git init failed: {}",
                String::from_utf8_lossy(&init.stderr).trim()
            );
        }

        run_git(&repo_path, &["config", "user.name", "Routa Test"]);
        run_git(
            &repo_path,
            &["config", "user.email", "routa-test@example.com"],
        );

        write_file(&repo_path, "README.md", "# Test Repo\n");
        run_git(&repo_path, &["add", "README.md"]);
        run_git(&repo_path, &["commit", "-m", "chore: initial commit"]);
        run_git(&repo_path, &["tag", "v0.1.0"]);

        run_git(&repo_path, &["checkout", "-b", "feature/log-panel"]);
        write_file(&repo_path, "feature.txt", "feature branch change\n");
        run_git(&repo_path, &["add", "feature.txt"]);
        run_git(&repo_path, &["commit", "-m", "feat: add git panel"]);
        let feature_sha = run_git(&repo_path, &["rev-parse", "HEAD"]);

        run_git(&repo_path, &["checkout", "main"]);
        write_file(&repo_path, "main.txt", "main branch only\n");
        run_git(&repo_path, &["add", "main.txt"]);
        run_git(&repo_path, &["commit", "-m", "chore: main line"]);

        Self {
            _temp: temp,
            repo_path,
            feature_sha,
        }
    }

    fn encoded_repo_path(&self) -> String {
        urlencoding::encode(self.repo_path.to_string_lossy().as_ref()).into_owned()
    }
}

fn run_git(repo_path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false"])
        .args(args)
        .current_dir(repo_path)
        .output()
        .unwrap_or_else(|error| panic!("git {args:?} failed to start: {error}"));

    if !output.status.success() {
        panic!(
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }

    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn write_file(repo_path: &Path, relative_path: &str, content: &str) {
    let path = repo_path.join(relative_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent directory should exist");
    }
    fs::write(path, content).expect("file should be written");
}

#[tokio::test]
async fn git_read_routes_require_repo_path_and_valid_sha() {
    let fixture = ApiFixture::new().await;

    let refs_response = fixture
        .client
        .get(fixture.endpoint("/api/git/refs"))
        .send()
        .await
        .expect("refs request should succeed");
    assert_eq!(refs_response.status(), StatusCode::BAD_REQUEST);
    let refs_json: Value = refs_response.json().await.expect("decode refs error");
    assert_eq!(refs_json["error"].as_str(), Some("repoPath is required"));

    let repo = GitRepoFixture::new();
    let commit_response = fixture
        .client
        .get(fixture.endpoint(&format!(
            "/api/git/commit?repoPath={}&sha=oops",
            repo.encoded_repo_path()
        )))
        .send()
        .await
        .expect("commit request should succeed");
    assert_eq!(commit_response.status(), StatusCode::BAD_REQUEST);
    let commit_json: Value = commit_response.json().await.expect("decode commit error");
    assert_eq!(commit_json["error"].as_str(), Some("sha is invalid"));
}

#[tokio::test]
async fn git_read_routes_expose_refs_log_filters_and_commit_detail() {
    let fixture = ApiFixture::new().await;
    let repo = GitRepoFixture::new();
    let repo_path = repo.encoded_repo_path();

    let refs_response = fixture
        .client
        .get(fixture.endpoint(&format!("/api/git/refs?repoPath={repo_path}")))
        .send()
        .await
        .expect("refs request should succeed");
    assert_eq!(refs_response.status(), StatusCode::OK);
    let refs_json: Value = refs_response.json().await.expect("decode refs");
    assert_eq!(refs_json["head"]["name"].as_str(), Some("main"));
    assert!(refs_json["local"]
        .as_array()
        .expect("local refs array")
        .iter()
        .any(|git_ref| git_ref["name"].as_str() == Some("feature/log-panel")));
    assert!(refs_json["tags"]
        .as_array()
        .expect("tags array")
        .iter()
        .any(|git_ref| git_ref["name"].as_str() == Some("v0.1.0")));

    let branch_log_response = fixture
        .client
        .get(fixture.endpoint(&format!(
            "/api/git/log?repoPath={repo_path}&branches={}",
            urlencoding::encode("feature/log-panel")
        )))
        .send()
        .await
        .expect("branch log request should succeed");
    assert_eq!(branch_log_response.status(), StatusCode::OK);
    let branch_log_json: Value = branch_log_response.json().await.expect("decode branch log");
    let branch_commits = branch_log_json["commits"]
        .as_array()
        .expect("branch log commits array");
    assert!(branch_commits
        .iter()
        .any(|commit| commit["summary"].as_str() == Some("feat: add git panel")));
    assert!(branch_commits
        .iter()
        .all(|commit| commit["summary"].as_str() != Some("chore: main line")));

    let search_response = fixture
        .client
        .get(fixture.endpoint(&format!(
            "/api/git/log?repoPath={repo_path}&search={}",
            urlencoding::encode("git panel")
        )))
        .send()
        .await
        .expect("search log request should succeed");
    assert_eq!(search_response.status(), StatusCode::OK);
    let search_json: Value = search_response.json().await.expect("decode search log");
    assert_eq!(search_json["total"].as_u64(), Some(1));
    assert_eq!(
        search_json["commits"][0]["summary"].as_str(),
        Some("feat: add git panel")
    );

    let commit_response = fixture
        .client
        .get(fixture.endpoint(&format!(
            "/api/git/commit?repoPath={repo_path}&sha={}",
            repo.feature_sha
        )))
        .send()
        .await
        .expect("commit detail request should succeed");
    assert_eq!(commit_response.status(), StatusCode::OK);
    let commit_json: Value = commit_response.json().await.expect("decode commit detail");
    assert_eq!(
        commit_json["commit"]["summary"].as_str(),
        Some("feat: add git panel")
    );
    assert!(commit_json["files"]
        .as_array()
        .expect("files array")
        .iter()
        .any(|file| {
            file["path"].as_str() == Some("feature.txt") && file["status"].as_str() == Some("added")
        }));
}
