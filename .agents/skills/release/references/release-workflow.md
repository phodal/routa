# Release Workflow

Use this reference when the task goes beyond generating notes and needs the full publish path.

## Prepare artifacts

```bash
node scripts/release/prepare-release-artifacts.mjs <version>
```

This updates version fields and writes:

- `docs/releases/v<version>-release-notes.md`
- `docs/releases/v<version>-changelog.md`
- `dist/release/changelog-summary-prompt.json`

Add `--from <tag>` if git cannot infer the previous release cleanly. Add `--ai --ai-provider <provider>` when an ACP provider is available for the release summary specialist.

## Publish paths

### Scripted publish

```bash
./scripts/release/publish.sh <version>
```

Use this when the user explicitly wants the helper to create the release commit, tag it, and optionally push.

### Manual publish

Use the manual path when the user wants tighter control over the final commit/tag step:

```bash
git diff
git add -A
git commit -m "chore: release v<version>"
git tag v<version>
git push origin main --tags
```

### Workflow dispatch

Use the GitHub Actions UI or `gh workflow run` only when the user prefers workflow dispatch instead of tag-push release triggering. See `docs/release-guide.md` for the publish matrix and verification steps.
