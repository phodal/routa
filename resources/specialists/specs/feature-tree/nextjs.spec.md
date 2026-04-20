# Next.js Feature Surface Overlay

Use this spec only when repository evidence shows a Next.js App Router or related Next.js runtime.

## Signals

- `src/app/**/page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`
- `src/app/**/route.ts`
- server actions, `generateMetadata`, `generateStaticParams`
- API contracts or fetch helpers colocated with route handlers

## Surface Mapping

- Treat each `page.tsx` route segment as a user-facing page surface.
- Treat `route.ts` handlers as API surfaces, even when they sit under the same route tree as pages.
- Treat `loading.tsx`, `error.tsx`, and `not-found.tsx` as supporting surfaces for the owning workflow, not as standalone features.
- Treat `layout.tsx` as shared shell evidence unless it clearly introduces a dedicated workflow.

## Workflow Grouping

- Merge a page, its server action, and its colocated `route.ts` handlers when they serve the same user journey.
- When a page depends on backend calls through fetch wrappers or API clients, include those clients in `sourceFiles` only when they materially explain the workflow.
- Prefer product workflows such as onboarding, dashboard management, or content authoring over route-by-route grouping.

## Data And Side Effects

- Use server actions, loaders, database calls, and cache invalidation as `DATA` evidence.
- Use outbound HTTP clients, search providers, payments, storage, or email integrations as `OUTBOUND` evidence.
- Treat `revalidatePath`, `revalidateTag`, and similar cache invalidation as supporting behavior, not standalone features.

## Common Pitfalls

- Do not collapse every page into “web pages” if domain entities and mutations clearly define multiple workflows.
- Do not treat route handlers as separate features when they only support the same page workflow.
- Do not invent pages from shared components alone; the route tree must support the surface.
