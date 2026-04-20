---
title: "ACP permission request cards collapse rich request payloads into a generic UI"
date: "2026-04-08"
status: resolved
severity: medium
area: ui
tags: ["acp", "ui", "permission", "codex", "chat"]
reported_by: "Codex"
related_issues: ["https://github.com/phodal/routa/issues/401"]
github_issue: 401
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/401"
resolved_at: "2026-04-08"
---

# ACP permission request cards collapse rich request payloads into a generic UI

## What Happened

The chat UI rendered ACP `request-permissions` tool calls as a generic `请求权限` card even when the payload already contained a richer nested structure:

- `toolCall.title` with the concrete command summary
- `toolCall.rawInput.reason` with the actual approval prompt
- `options[]` with explicit allow-once / allow-always / reject labels

The card therefore hid the real operation being approved and showed generic controls instead of the option labels sent by the adapter.

## Expected Behavior

- show the nested `toolCall.title` as the primary permission request title
- show the nested `toolCall.rawInput.reason` as the approval reason
- render action labels from `options[]` instead of generic save/cancel wording
- preserve compatibility with the legacy top-level `permissions` payload shape

## Reproduction Payload Shape

Observed waiting tool call payload:

```json
{
  "toolKind": "request-permissions",
  "toolRawInput": {
    "toolCall": {
      "title": "Run gh api repos/phodal/routa/pulls?head=phodal:issue/670c06ff&state=open",
      "rawInput": {
        "reason": "Do you want to allow checking GitHub for an existing PR so I don’t create a duplicate?",
        "proposed_execpolicy_amendment": ["gh", "api"]
      }
    },
    "options": [
      { "optionId": "approved-for-session", "name": "Always" },
      { "optionId": "approved", "name": "Yes" },
      { "optionId": "abort", "name": "No, provide feedback" }
    ]
  }
}
```

## Why This Happened

`PermissionRequestBubble` only looked for legacy top-level fields like:

- `rawInput.reason`
- `rawInput.permissions`

It did not interpret the ACP-standard nested `toolCall` and `options` fields, so the UI fell back to a generic permission card.
