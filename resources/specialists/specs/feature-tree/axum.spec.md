# Axum Feature Surface Overlay

Use this spec only when repository evidence shows a Rust Axum application or Axum-backed server runtime.

## Signals

- `Router::new()`, `.route(...)`, `.nest(...)`, `.merge(...)`
- handler functions returning `impl IntoResponse`
- `axum::extract::*`, shared `State`, request parts, middleware layers
- multiple routers composed into one backend surface

## Surface Mapping

- Treat each explicit route registration as an inbound HTTP surface.
- Follow nested routers and merged routers before naming features; the feature boundary may be defined at the composed service level rather than in a single file.
- Treat fallback handlers, static file handlers, and desktop shell routes as supporting surfaces unless they introduce distinct product behavior.

## Workflow Grouping

- Group handlers by user workflow and shared domain state, not by module name alone.
- If multiple handlers share the same state object, service, or repository layer around one entity, that is usually one feature.
- In mixed runtimes such as Next.js plus Axum, keep the backend feature aligned with the page or API workflow it serves rather than treating the Rust side as a separate product.

## Data And Side Effects

- Use repository calls, SQL execution, persistence structs, and state mutations as `DATA` evidence.
- Use HTTP clients, queues, file/storage access, or background jobs as `OUTBOUND` evidence.
- Include extractors, middleware, and auth layers in `sourceFiles` when they materially explain access control or lifecycle behavior.

## Common Pitfalls

- Do not stop at router declarations; read through the handlers into state and persistence layers.
- Do not create one feature per handler if the handlers are CRUD slices of the same workflow.
- Do not mistake technical fallback routes for product features.
