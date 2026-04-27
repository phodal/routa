This directory keeps the Tauri `bundle.resources` glob present in source checkouts.

`scripts/prepare-frontend.mjs` writes the real bundled `feature-tree-generator.mjs`
here for desktop packaging. The placeholder exists so local `cargo clippy` and
pre-push validation do not fail before that build step has run.
