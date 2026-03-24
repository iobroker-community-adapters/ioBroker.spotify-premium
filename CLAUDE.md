# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ioBroker adapter for Spotify Premium playback control. JavaScript-based, uses the Spotify Web API v1 via axios with manual OAuth2 authentication (client_id/client_secret + redirect URI flow). Runs as a daemon-mode ioBroker adapter.

## Development Commands

```bash
npm run lint           # ESLint with flat config (eslint.config.mjs)
npm test               # Run all tests (JS + package validation)
npm run test:js        # Run Mocha tests only
npm run test:package   # Validate package/io-package structure
npm run test:integration  # Integration tests via @iobroker/testing
npm run translate      # Generate i18n translations for admin UI
```

No build step needed — `main.ts` runs directly.

## Architecture

### Source Files

- **main.ts** (~2900 lines) — The entire adapter: Spotify API communication, OAuth2 authorization flow (via local HTTP server on redirect URI), state management, and 40+ ioBroker state change listeners (play, pause, skip, shuffle, volume, device transfer, etc.). Uses a global `adapter` variable.
- **lib/cache.js** (~390 lines) — Tree-structured in-memory cache mirroring the ioBroker state hierarchy. Supports regex/string-based listeners and syncs state changes externally via `setExternal()`/`setExternalObj()`.
- **lib/utils.js** (~40 lines) — Helper for safe state loading with defaults (`loadOrDefault`).

### Polling Architecture

Three independent polling loops with configurable intervals:
- **Status polling** (default 10s) — current playback state
- **Device polling** (default 5min) — available Spotify Connect devices
- **Playlist polling** (default 60min) — user playlists

### Key Patterns

- DNS lookup caching (`dns-lookup-cache`) to avoid rate-limit issues on repeated API calls
- HTTP 429 handling with backoff
- Sentry error reporting (DSN configured in io-package.json)
- State changes are buffered through the cache system before being written to ioBroker
- OAuth2 tokens are obtained via a local HTTP server that listens on the configured redirect URI

### Admin UI

- `admin/jsonConfig.json` — Config UI with client_id/secret fields, polling intervals, behavior toggles
- `admin/i18n/` — Translations for 11 languages. Run `npm run translate` after changing jsonConfig labels.
- `widgets/` — VIS widgets for playback control (play/pause, skip, shuffle, repeat, device/playlist selection)

### ioBroker Conventions (from .github/copilot-instructions.md)

- Use 4-space indentation
- Use `adapter.log.debug/info/warn/error()` for logging, never `console.log`
- Clean up all timers and resources in `unload()` method
- Use `@iobroker/testing` framework for integration tests
- Changelog entries go under `## **WORK IN PROGRESS**` during development
- Translation files in `admin/i18n/` must stay synchronized with `admin/jsonConfig.json` labels

## CI

GitHub Actions (`.github/workflows/test-and-release.yml`): lint-first, then adapter tests across Node 20/22/24 on Ubuntu/Windows/macOS. NPM publish via Trusted Publishing on `v*.*.*` tags.

## Release

Uses `@alcalzone/release-script` with ioBroker plugins (configured in `.releaseconfig.json`).
