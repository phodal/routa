# Egg.js Feature Surface Overlay

Use this spec only when repository evidence shows an Egg.js application.

## Signals

- `app/router.js` or router declarations under Egg conventions
- controller files under `app/controller`
- services under `app/service`
- models under `app/model`
- `ctx.render(...)`, `ctx.body`, `ctx.service`

## Surface Mapping

- Treat rendered templates as page surfaces.
- Treat controller actions returning JSON, performing mutations, or acting as callbacks as API surfaces.
- Expand router prefixes and RESTful helpers such as `router.resources(...)` before grouping.

## Workflow Grouping

- Use controller plus service plus model evidence together to define product workflows.
- Keep admin/public distinctions when router prefixes or middleware clearly create them.
- Prefer user workflows such as account, content, moderation, or platform operations over code-layer naming.

## Data And Side Effects

- Use Egg models, service-layer database access, and session/auth state as `DATA` evidence.
- Use outbound HTTP clients, mailers, storage, payments, or queues as `OUTBOUND` evidence.
- Include middleware or plugin configuration in `sourceFiles` when it materially changes the workflow.

## Common Pitfalls

- Do not stop at router declarations; read the controller action and the service it calls.
- Do not create one feature per service or controller file.
- Do not ignore app-level conventions that hide routing or auth behavior behind framework structure.
