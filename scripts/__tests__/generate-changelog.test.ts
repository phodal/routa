import { describe, expect, it } from "vitest";

const changelog = await import("../release/generate-changelog.mjs");

const minimalRange = { from: "v0.2.5", to: "v0.2.6", logRange: "v0.2.5..v0.2.6" };

describe("generate-changelog", () => {
  it("parses conventional commits and breaking markers", () => {
    expect(changelog.parseCommitHeader("feat(kanban): add lane history")).toEqual({
      breaking: false,
      description: "add lane history",
      scope: "kanban",
      type: "feat",
    });

    expect(changelog.parseCommitHeader("fix(api)!: remove old session field")).toMatchObject({
      breaking: true,
      description: "remove old session field",
      scope: "api",
      type: "fix",
    });
  });

  it("classifies commits into Keep a Changelog sections", () => {
    expect(changelog.classifyCommit({ type: "feat", description: "add desktop updater", breaking: false })).toBe("Added");
    expect(changelog.classifyCommit({ type: "fix", description: "patch auth bypass", breaking: false })).toBe("Security");
    expect(changelog.classifyCommit({ type: "feat", description: "replace API", breaking: true })).toBe("Breaking Changes");
  });

  it("renders a technical changelog with scoped areas and commit links", () => {
    const markdown = changelog.renderTechnicalChangelog([
      {
        hash: "abc1230000000000000000000000000000000000",
        shortHash: "abc1230",
        type: "feat",
        scope: "desktop",
        description: "add auto-generated release notes",
        breaking: false,
        subject: "feat(desktop): add auto-generated release notes",
        section: "Added",
      },
    ], "phodal/routa");

    expect(markdown).toContain("## Technical Changelog");
    expect(markdown).toContain("### Added");
    expect(markdown).toContain("**desktop:** add auto-generated release notes");
    expect(markdown).toContain("https://github.com/phodal/routa/commit/abc1230000000000000000000000000000000000");
  });

  it("filters release self-bump commits from generated changelogs", () => {
    expect(changelog.shouldIncludeCommit({
      subject: "chore: release v0.16.0",
    })).toBe(false);

    expect(changelog.shouldIncludeCommit({
      subject: "fix(release): publish generated release notes",
    })).toBe(true);
  });

  it("includes an AI summary when provided to the release renderer", () => {
    const output = changelog.renderReleaseNotes({
      aiSummary: "## Summary\n\nA curated desktop release summary.",
      changedFiles: ["scripts/release/generate-changelog.mjs"],
      commits: [],
      range: minimalRange,
      repo: "phodal/routa",
      version: "0.2.6",
    });

    expect(output).toContain("# Routa Desktop v0.2.6");
    expect(output).toContain("## Summary");
    expect(output).toContain("A curated desktop release summary.");
    expect(output).toContain("## Install");
  });

  it("writes release notes and a standalone changelog from the CLI", () => {
    expect(changelog.parseArgs([
      "--from",
      "v0.2.5",
      "--to",
      "v0.2.6",
      "--out",
      "dist/release/release-notes.md",
      "--changelog-out",
      "dist/release/CHANGELOG.generated.md",
    ])).toMatchObject({
      changelogOut: "dist/release/CHANGELOG.generated.md",
      from: "v0.2.5",
      out: "dist/release/release-notes.md",
      to: "v0.2.6",
    });
  });

  it("renders a standalone changelog entry for a tag range", () => {
    const output = changelog.renderStandaloneChangelog({
      commits: [
        {
          hash: "abc1230000000000000000000000000000000000",
          shortHash: "abc1230",
          type: "fix",
          scope: "release",
          description: "publish generated release notes",
          breaking: false,
          subject: "fix(release): publish generated release notes",
          section: "Fixed",
        },
      ],
      date: "2026-04-09",
      range: minimalRange,
      repo: "phodal/routa",
      version: "0.2.6",
    });

    expect(output).toContain("# Changelog");
    expect(output).toContain("## [v0.2.6] - 2026-04-09");
    expect(output).toContain("### Fixed");
    expect(output).toContain("Range: `v0.2.5..v0.2.6`");
    expect(output).not.toContain("## Technical Changelog");
  });

  it("renders deterministic summaries as release highlights instead of raw commit excerpts", () => {
    const output = changelog.renderReleaseNotes({
      aiSummary: null,
      changedFiles: [
        "src/client/components/kanban-card-detail.tsx",
        "crates/routa-core/src/acp/process.rs",
        ".github/workflows/tauri-release.yml",
      ],
      commits: [
        {
          hash: "1111111111111111111111111111111111111111",
          shortHash: "1111111",
          type: "feat",
          scope: "kanban",
          description: "show committed changes in card detail",
          breaking: false,
          subject: "feat(kanban): show committed changes in card detail",
          section: "Added",
        },
        {
          hash: "2222222222222222222222222222222222222222",
          shortHash: "2222222",
          type: "fix",
          scope: "desktop",
          description: "make macOS signing optional in release workflow",
          breaking: false,
          subject: "fix(desktop): make macOS signing optional in release workflow",
          section: "Fixed",
        },
      ],
      range: minimalRange,
      repo: "phodal/routa",
      version: "0.2.6",
    });

    expect(output).toContain("## Summary");
    expect(output).toContain("### Highlights");
    expect(output).toContain("**Kanban and task delivery:**");
    expect(output).toContain("**Desktop and release:**");
    expect(output).toContain("### Upgrade Notes");
    expect(output).toContain("No breaking changes were identified");
  });
});
