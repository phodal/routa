# Gin Feature Surface Overlay

Use this spec only when repository evidence shows a Go Gin web application.

## Signals

- `gin.Default()`, `gin.New()`
- `router.GET(...)`, `router.POST(...)`, `router.DELETE(...)`
- `router.Group(...)`, nested groups, middleware attached to groups
- `c.HTML(...)`, `c.JSON(...)`, `c.Redirect(...)`
- GORM models, repositories, database setup

## Surface Mapping

- Treat `c.HTML(...)` handlers as page surfaces when they back user-visible templates.
- Treat form submissions, JSON responses, redirects, uploads, and admin actions as API or action surfaces.
- Expand `router.Group(...)` prefixes and middleware to determine the true workflow path and access boundary.

## Workflow Grouping

- Group public browsing routes, admin CRUD routes, auth flows, and moderation flows by user journey rather than by controller file alone.
- When a route group shares middleware such as auth or CSRF protection, include that middleware in the owning feature if it materially explains the flow.
- Treat scheduled jobs and feed generation as supporting capabilities; attach them to a product workflow unless they truly stand alone.

## Data And Side Effects

- Use GORM models, seed logic, migrations, and persistence operations as `DATA` evidence.
- Use sessions, cookies, OAuth callbacks, and uploads as key workflow evidence.
- Use RSS, sitemap generation, email, storage, or external OAuth providers as `OUTBOUND` evidence.

## Common Pitfalls

- Do not miss GET routes in `main.go` or router bootstrap files just because handlers live elsewhere.
- Do not output admin features with no route evidence when the route table is explicit.
- Do not treat every route group as a standalone feature if the data model shows one broader workflow.
