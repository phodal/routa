# Spring Boot Feature Surface Overlay

Use this spec only when repository evidence shows a Spring Boot web application.

## Signals

- `@Controller`, `@RestController`
- `@RequestMapping`, `@GetMapping`, `@PostMapping`, and related annotations
- returned template names, `Model`, `ResponseEntity`
- service classes, repository interfaces, entities, DTOs

## Surface Mapping

- Treat MVC handlers returning templates as page surfaces.
- Treat REST handlers returning JSON or `ResponseEntity` as API surfaces.
- Follow class-level request mappings and method-level mappings together before deciding the final route path.

## Workflow Grouping

- Group controller methods with their services and repositories when they support the same user journey.
- If template rendering and form submissions belong to the same business flow, keep them in one feature.
- Use domain entities and repositories to decide whether multiple endpoints belong to one broader capability.

## Data And Side Effects

- Use JPA entities, repositories, transactional service methods, and DTO mapping as `DATA` evidence.
- Use outbound REST clients, mail senders, message brokers, storage, and schedulers as `OUTBOUND` evidence.
- Include security configuration or interceptors in `sourceFiles` when they materially explain access control.

## Common Pitfalls

- Do not create a feature per controller if several controllers serve the same workflow.
- Do not ignore class-level route prefixes.
- Do not treat purely technical configuration as a feature unless it creates a visible user workflow.
