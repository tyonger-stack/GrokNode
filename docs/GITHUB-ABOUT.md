# GitHub description and metadata

Copy-ready text for the repository About panel. All variants were written to
match what the tree actually contains.

## Description (GitHub About field, 350 character limit)

Use this for the About description:

```text
Unofficial source-oriented reconstruction of the shipped Grok Bot 0.18.0 macOS app into readable TypeScript, plus an inference router for Cursor, Claude Code, Codex and OpenRouter, an optional local Docker sandbox, and local usage tracking. Research only; not affiliated with Anysphere.
```

That is 286 characters, comfortably under the limit. The current live description is
`Unofficial source-oriented reconstruction and extension of Grok Bot 0.18.0 for
macOS`, which is accurate but says nothing about what the repository adds.

## Topics

```text
grok-bot, anysphere, cursor, electron, typescript, macos, reverse-engineering, reconstruction, inference-router, docker, mcp, research
```

## Short tagline

For a social preview, a release header, or a link card:

```text
Grok Bot 0.18, rebuilt from the shipped binary into readable TypeScript, with a swappable inference router and a local sandbox.
```

## Longer blurb

For a project page, a submission form, or a first paragraph in a write-up:

> This project reconstructs the publicly shipped Grok Bot 0.18.0 macOS
> application at source level. It reads the distributed artifact, recovers the
> Electron, host, coordinator, protocol and renderer boundaries as readable
> TypeScript, and rebuilds a working application from those sources. On top of
> the reconstruction it adds an inference router that sends new turns to Cursor,
> Claude Code, Codex or OpenRouter, an optional local Docker sandbox that
> replaces the remote box, and local tracking of request and token usage.
>
> It is an unofficial research project. It is not Anysphere's source, not an
> official release, and it grants no license over the upstream application.

## README subtitle

If the README H1 needs a supporting line, the existing opening paragraph already
carries it. The sharpened version, one sentence shorter:

```text
An unofficial, source-oriented reconstruction of the publicly shipped Grok Bot
0.18.0 macOS application, extended with an inference router, a local Docker
sandbox and local usage tracking. Research only.
```
