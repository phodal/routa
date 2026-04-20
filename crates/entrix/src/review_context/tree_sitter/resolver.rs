use super::{collect_repo_files, resolve_repo_relative_path};
use std::path::Path;

pub(super) fn resolve_query_target_file(repo_root: &Path, target: &str) -> Option<String> {
    let candidate = if target.contains(':') {
        target.split(':').next().unwrap_or(target)
    } else {
        target
    };
    resolve_repo_relative_path(repo_root, candidate)
}

pub(super) fn resolve_relative_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    if !import_path.starts_with('.') {
        return None;
    }
    let base_dir = repo_root.join(relative_path).parent()?.to_path_buf();
    let candidate = base_dir.join(import_path);
    let suffix = Path::new(relative_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{ext}"));
    let mut extensions = Vec::new();
    if let Some(suffix) = suffix {
        extensions.push(suffix);
    }
    for fallback in [".ts", ".tsx", ".js", ".jsx", ".py", ".rs"] {
        if !extensions.iter().any(|ext| ext == fallback) {
            extensions.push(fallback.to_string());
        }
    }

    let mut candidates = vec![candidate.clone()];
    if candidate.extension().is_none() {
        for ext in &extensions {
            candidates.push(candidate.with_extension(ext.trim_start_matches('.')));
            candidates.push(candidate.join(format!("index{ext}")));
        }
    }

    for path in candidates {
        if path.is_file() {
            if let Some(relative) = resolve_repo_relative_path(repo_root, &path.to_string_lossy()) {
                return Some(relative);
            }
        }
    }
    None
}

pub(super) fn resolve_python_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    let leading_dots = import_path.len() - import_path.trim_start_matches('.').len();
    let relative_part = import_path.trim_start_matches('.').replace('.', "/");
    let mut anchor = repo_root.join(relative_path).parent()?.to_path_buf();
    for _ in 0..leading_dots.saturating_sub(1) {
        anchor = anchor.parent()?.to_path_buf();
    }
    let candidate = if relative_part.is_empty() {
        anchor
    } else {
        anchor.join(relative_part)
    };
    for path in [
        candidate.with_extension("py"),
        candidate.join("__init__.py"),
    ] {
        if path.is_file() {
            if let Some(relative) = resolve_repo_relative_path(repo_root, &path.to_string_lossy()) {
                return Some(relative);
            }
        }
    }
    None
}

pub(super) fn resolve_go_import(
    repo_root: &Path,
    relative_path: &str,
    import_path: &str,
) -> Option<String> {
    let import_path = import_path
        .trim()
        .trim_matches(&['"', '\'', '`'][..])
        .to_string();
    if import_path.is_empty() {
        return None;
    }

    let relative_anchor = repo_root.join(relative_path).parent()?.to_path_buf();
    let candidates = if import_path.starts_with('.')
        || import_path.starts_with("./")
        || import_path.starts_with("../")
        || import_path == "."
        || import_path == ".."
    {
        vec![relative_anchor.join(import_path)]
    } else if import_path.contains('/') || import_path.contains('.') {
        vec![repo_root.join(import_path.replace('.', "/"))]
    } else {
        Vec::new()
    };

    for candidate in candidates {
        if let Some(resolved) =
            resolve_import_file_reference(repo_root, &candidate, "go", Some("_test.go"))
        {
            return Some(resolved);
        }
    }
    None
}

pub(super) fn resolve_java_import(
    repo_root: &Path,
    _relative_path: &str,
    import_path: &str,
    is_static_import: bool,
) -> Option<String> {
    let mut import_path = import_path.trim().trim_end_matches(';').trim().to_string();
    if import_path.is_empty() {
        return None;
    }
    if import_path.starts_with("java.")
        || import_path.starts_with("javax.")
        || import_path.starts_with("kotlin.")
        || import_path.starts_with("scala.")
    {
        return None;
    }

    if is_static_import {
        let mut parts = import_path.split('.').collect::<Vec<_>>();
        if parts.len() > 1 {
            parts.pop();
            import_path = parts.join(".");
        }
    }

    if import_path.ends_with(".*") {
        import_path = import_path.trim_end_matches(".*").to_string();
    }
    if import_path.is_empty() {
        return None;
    }

    let package_path = import_path.replace('.', "/");
    let class_file = repo_root.join(format!("{package_path}.java"));
    let package_dir = repo_root.join(&package_path);
    let mut candidates = vec![class_file.to_path_buf(), package_dir.to_path_buf()];
    candidates.push(
        repo_root
            .join("src/main/java")
            .join(format!("{package_path}.java")),
    );
    candidates.push(repo_root.join("src/main/java").join(&package_path));
    candidates.push(
        repo_root
            .join("src/test/java")
            .join(format!("{package_path}.java")),
    );
    candidates.push(repo_root.join("src/test/java").join(&package_path));

    for candidate in candidates {
        if let Some(found) =
            resolve_import_file_reference(repo_root, &candidate, "java", Some("_test.java"))
        {
            return Some(found);
        }
    }

    let target_suffix = format!("{package_path}.java");
    collect_repo_files(repo_root)
        .into_iter()
        .find(|repo_file| repo_file.ends_with(&target_suffix))
}

pub(super) fn resolve_rust_import(
    repo_root: &Path,
    relative_path: &str,
    import_text: &str,
) -> Option<String> {
    let path_text = import_text
        .trim()
        .trim_start_matches("pub ")
        .trim_start_matches("use")
        .trim()
        .trim_end_matches(';')
        .trim();
    if !path_text.contains("::") {
        return None;
    }

    let crate_root = rust_crate_root(repo_root, relative_path)?;
    let parts = rust_import_parts(path_text);
    if parts.is_empty() {
        return None;
    }

    let current_dir = repo_root.join(relative_path).parent()?.to_path_buf();
    let compact_path = path_text.split_whitespace().collect::<String>();
    let mut anchors = Vec::new();
    if compact_path.starts_with("crate::") {
        anchors.push(crate_root.clone());
    } else if compact_path.starts_with("super::") {
        if let Some(parent) = current_dir.parent() {
            anchors.push(parent.to_path_buf());
        }
    } else if compact_path.starts_with("self::") {
        anchors.push(current_dir.clone());
    } else {
        anchors.push(crate_root.clone());
    }

    let module_parts = if parts.len() > 1 {
        parts[..parts.len() - 1].to_vec()
    } else {
        parts.clone()
    };
    for anchor in anchors {
        for candidate in rust_module_candidate_paths(&anchor, &module_parts, &crate_root) {
            if candidate.is_file() {
                if let Some(relative) =
                    resolve_repo_relative_path(repo_root, &candidate.to_string_lossy())
                {
                    return Some(relative);
                }
            }
        }
    }
    None
}

fn resolve_import_file_reference(
    repo_root: &Path,
    candidate: &Path,
    extension: &str,
    skip_test_suffix: Option<&str>,
) -> Option<String> {
    if candidate.extension().is_none() {
        if candidate.is_dir() {
            let file = first_source_file_in_directory(candidate, extension, skip_test_suffix)?;
            return resolve_repo_relative_path(repo_root, &file);
        }
        let as_file = candidate.with_extension(extension);
        if as_file.is_file() {
            return resolve_repo_relative_path(repo_root, &as_file.to_string_lossy());
        }
        return None;
    }
    if candidate.extension().and_then(|ext| ext.to_str()) == Some(extension) && candidate.is_file()
    {
        return resolve_repo_relative_path(repo_root, &candidate.to_string_lossy());
    }
    None
}

fn first_source_file_in_directory(
    dir: &Path,
    extension: &str,
    skip_test_suffix: Option<&str>,
) -> Option<String> {
    let mut preferred = Vec::new();
    let mut skipped = Vec::new();
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_none_or(|ext| ext != extension)
        {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        if skip_test_suffix.is_some_and(|suffix| file_name.ends_with(suffix)) {
            skipped.push(path);
            continue;
        }
        preferred.push(path);
    }
    preferred.sort();
    if let Some(path) = preferred.first() {
        return Some(path.to_string_lossy().to_string());
    }
    skipped.sort();
    skipped
        .first()
        .map(|path| path.to_string_lossy().to_string())
}

fn rust_crate_root(repo_root: &Path, relative_path: &str) -> Option<std::path::PathBuf> {
    let mut current = repo_root.join(relative_path).parent()?.to_path_buf();
    loop {
        let src_dir = current.join("src");
        if src_dir.join("lib.rs").is_file() || src_dir.join("main.rs").is_file() {
            return Some(src_dir);
        }
        if !current.pop() {
            break;
        }
    }
    None
}

fn rust_import_parts(path_text: &str) -> Vec<String> {
    let normalized = if let Some((prefix, _)) = path_text.split_once('{') {
        prefix.trim().trim_end_matches("::").to_string()
    } else {
        path_text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .split(" as ")
            .next()
            .unwrap_or(path_text)
            .trim_end_matches("::*")
            .trim()
            .to_string()
    };
    normalized
        .split("::")
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .filter(|part| !matches!(*part, "crate" | "self" | "super"))
        .map(ToString::to_string)
        .collect()
}

fn rust_module_candidate_paths(
    anchor: &Path,
    module_parts: &[String],
    crate_root: &Path,
) -> Vec<std::path::PathBuf> {
    if module_parts.is_empty() {
        return Vec::new();
    }
    let joined = module_parts
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join("/");
    let mut candidates = vec![
        anchor.join(format!("{joined}.rs")),
        anchor.join(&joined).join("mod.rs"),
    ];
    if anchor == crate_root && module_parts.first().is_some_and(|part| part == "src") {
        let rest = module_parts[1..]
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join("/");
        if !rest.is_empty() {
            candidates.push(crate_root.join(format!("{rest}.rs")));
            candidates.push(crate_root.join(rest).join("mod.rs"));
        }
    }
    candidates
}
