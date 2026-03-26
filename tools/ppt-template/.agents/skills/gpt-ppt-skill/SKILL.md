---
name: gpt-ppt-skill
description: Create or edit slide decks under tools/ppt-template with the local PptxGenJS generators, shared theme helpers, and validation workflow.
---

# GPT PPT Skill

Use this skill for work inside `tools/ppt-template/`.

## Load First

- When working inside `tools/ppt-template/`, read `CLAUDE.md`.
- Inspect `package.json` and the existing generators in `src/`.

## Core Rules

- Use the local `PptxGenJS` generators in this directory. Do not invent a second workflow.
- Reuse `src/ppt-theme.mjs` and `src/color-tokens.mjs`; do not copy helper logic into a new file.
- Prefer an existing generator over creating a new one.
- Do not add a new `src/generate-*.js` file or a new `package.json` script unless the user explicitly asks for a new reusable deck generator, or you have verified that none of the existing entrypoints can satisfy the request.
- For one-off deck generation, prefer running or lightly adapting an existing generator instead of expanding the toolchain.

## Entry Point Selection

Match the request to the closest existing generator first:

- Project or system architecture, technical overview, engineering intro: `npm run generate:architecture`
- Product showcase, screen walkthrough, feature tour: `npm run generate:showcase`
- Release summary, changelog, shipped features: `npm run generate:release:v0.2.7`
- Template, palette, brand sample deck: `npm run generate`

If the prompt is vague, choose the closest existing generator instead of creating a new one. State which generator you picked.

## When Editing Code

- Change the smallest relevant file first.
- If you need layout or content changes shared across decks, edit `src/ppt-theme.mjs` or `src/color-tokens.mjs`.
- If you need deck-specific changes, edit the existing generator for that deck.
- Keep output paths deterministic under `output/`.

## Validation

After source changes:

1. Run the affected `npm run generate:*` command from `tools/ppt-template/`.
2. Confirm the target file in `output/` was rewritten.
3. Do a basic artifact check:
   - `qlmanage -t -s 1600 -o /tmp output/<deck>.pptx`
   - `unzip -l output/<deck>.pptx`
4. If content fidelity matters and `markitdown` is available, extract text and check for placeholders.

## Output Quality

- Preserve the local visual system from existing decks.
- Avoid generic title-plus-bullets slides.
- Use deliberate contrast, cards, grids, screenshots, or stat blocks.
- Keep the deck grounded in repository reality; do not fill slides with generic product copy if local project material already exists.
