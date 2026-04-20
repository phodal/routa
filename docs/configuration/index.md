---
title: Configuration Overview
hide_table_of_contents: true
---

# Configuration

Configuration in Routa is mainly about making execution available and predictable.

The most important configuration areas are:

- providers
- models
- role defaults
- environment variables

## Recommended Setup Order

1. Make one provider available.
2. Add or pick one model if that provider needs an explicit model target.
3. Bind defaults for the roles you care about.
4. Return to a workspace and run a `Session`.

## Start Here

- [Providers and Models](/configuration/providers-and-models)
- [Environment Variables](/configuration/environment-variables)

## Fast Setup Path

<div className="routa-start-grid">
  <div className="routa-start-card">
    <span className="routa-start-card__badge">Required</span>
    <h3>Providers And Models</h3>
    <p>Make one provider available and point one role at one working model.</p>
    <a className="routa-inline-link" href="/routa/configuration/providers-and-models">Open Providers And Models</a>
  </div>
  <div className="routa-start-card">
    <span className="routa-start-card__badge">Optional</span>
    <h3>Environment Variables</h3>
    <p>Use this when local runtime wiring or deployment needs explicit env values.</p>
    <a className="routa-inline-link" href="/routa/configuration/environment-variables">Open Environment Variables</a>
  </div>
</div>

## Product Context

In the product UI, the configuration surface currently centers on:

- `Providers`
- `Registry`
- `Role Defaults`
- `Models`

Those settings determine which provider is available, how a model endpoint is resolved, and
which defaults Routa uses for roles like `ROUTA`, `CRAFTER`, `GATE`, and `DEVELOPER`.

## Practical Rule

Do not try to configure every provider before your first run. One working provider and one
working model path are enough.
