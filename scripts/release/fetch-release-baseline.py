#!/usr/bin/env python3

from __future__ import annotations

import argparse
import http.client
import io
import json
import os
import ssl
import sys
from urllib.parse import urlparse
import zipfile
from pathlib import Path

ALLOWED_GITHUB_HOSTS = {"api.github.com"}


class GitHubRequestError(RuntimeError):
    def __init__(self, status: int, url: str):
        super().__init__(f"GitHub request failed ({status}): {url}")
        self.status = status
        self.url = url


def ensure_allowed_github_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname not in ALLOWED_GITHUB_HOSTS:
        raise ValueError(f"Refusing to fetch non-GitHub HTTPS URL: {url}")
    return url


def github_request(url: str, token: str) -> bytes:
    parsed = urlparse(ensure_allowed_github_url(url))
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"

    connection = http.client.HTTPSConnection(
        parsed.hostname,
        timeout=30,
        context=ssl.create_default_context(),
    )  # nosemgrep: python.lang.security.audit.httpsconnection-detected.httpsconnection-detected
    connection.request(
        "GET",
        path,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    response = connection.getresponse()
    payload = response.read()
    if response.status >= 400:
        raise GitHubRequestError(response.status, url)
    return payload


def github_get(url: str, token: str) -> dict:
    return json.loads(github_request(url, token).decode("utf-8"))


def github_download(url: str, token: str) -> bytes:
    return github_request(url, token)


def find_artifact_download_url(
    repo: str,
    workflow: str,
    artifact_name: str,
    token: str,
    exclude_run_id: int | None,
) -> str | None:
    runs_url = (
        f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/runs"
        "?status=success&per_page=20"
    )
    try:
        runs = github_get(runs_url, token).get("workflow_runs", [])
    except GitHubRequestError as error:
        if error.status in {403, 404}:
            print(
                f"Skipping baseline fetch after GitHub API returned {error.status} for workflow runs.",
                file=sys.stderr,
            )
            return None
        raise
    for run in runs:
        run_id = run.get("id")
        if exclude_run_id is not None and run_id == exclude_run_id:
            continue
        artifacts_url = f"https://api.github.com/repos/{repo}/actions/runs/{run_id}/artifacts?per_page=100"
        try:
            artifacts = github_get(artifacts_url, token).get("artifacts", [])
        except GitHubRequestError as error:
            if error.status in {403, 404}:
                print(
                    f"Skipping baseline fetch after GitHub API returned {error.status} for run artifacts.",
                    file=sys.stderr,
                )
                continue
            raise
        for artifact in artifacts:
            if artifact.get("expired"):
                continue
            if artifact.get("name") == artifact_name:
                return str(artifact.get("archive_download_url"))
    return None


def extract_manifest(zip_bytes: bytes, out_path: Path) -> bool:
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        for member in archive.namelist():
            if member.endswith(".json"):
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(archive.read(member))
                return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the latest successful release manifest artifact.")
    parser.add_argument("--repo", required=True, help="owner/repo")
    parser.add_argument("--workflow", required=True, help="Workflow file name, e.g. cli-release.yml")
    parser.add_argument("--artifact-name", required=True, help="Artifact name to fetch")
    parser.add_argument("--out", required=True, help="Where to write the extracted manifest JSON")
    parser.add_argument(
        "--github-token",
        help="GitHub token (defaults to ROUTA_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN env)",
    )
    parser.add_argument("--exclude-run-id", type=int, help="Current run id to skip")
    args = parser.parse_args()

    token = (
        args.github_token
        or os.environ.get("ROUTA_GITHUB_TOKEN", "")
        or os.environ.get("GITHUB_TOKEN", "")
        or os.environ.get("GH_TOKEN", "")
    )
    if not token:
        print("No GitHub token available, skipping baseline fetch.", file=sys.stderr)
        return 0

    download_url = find_artifact_download_url(
        args.repo,
        args.workflow,
        args.artifact_name,
        token,
        args.exclude_run_id,
    )
    if not download_url:
        print("No baseline manifest artifact found.", file=sys.stderr)
        return 0

    try:
        zip_bytes = github_download(download_url, token)
    except GitHubRequestError as error:
        if error.status in {403, 404}:
            print(
                f"Skipping baseline manifest download after GitHub API returned {error.status}.",
                file=sys.stderr,
            )
            return 0
        raise
    out_path = Path(args.out)
    if not extract_manifest(zip_bytes, out_path):
        print("Downloaded artifact did not contain a JSON manifest.", file=sys.stderr)
        return 0

    print(f"Fetched baseline manifest to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
