# Express Feature Surface Overlay

Use this spec only when repository evidence shows an Express application or a closely related Node router stack.

## Signals

- `app.use(...)`, `express.Router()`
- `router.get/post/put/delete(...)`
- `res.render(...)`, `res.redirect(...)`, `res.json(...)`
- controllers, middleware, services, and models wired through route files

## Surface Mapping

- Treat rendered templates and route-backed pages as user-facing page surfaces.
- Treat mutation handlers, JSON responses, auth callbacks, and redirects as API or action surfaces.
- Route mount points matter: expand mounted prefixes before deciding whether a route is public, admin, auth, or internal.

## Workflow Grouping

- Merge GET page routes and POST/DELETE/PUT handlers when they support the same user journey.
- Use controllers plus models together; file layout alone is not a product boundary.
- If middleware changes who can access a route, include it in `sourceFiles` for the owning feature.

## Data And Side Effects

- Use ORM models, repository calls, session stores, JWT or cookie flows as `DATA` evidence.
- Use mailers, storage, third-party APIs, and payment/search integrations as `OUTBOUND` evidence.
- If multiple routes revolve around the same persistence entities, prefer one broader feature over many thin features.

## Common Pitfalls

- Do not omit GET page routes when POST handlers for the same flow exist.
- Do not ignore middleware that sets auth/session context for all views.
- Do not treat every controller as a feature.
