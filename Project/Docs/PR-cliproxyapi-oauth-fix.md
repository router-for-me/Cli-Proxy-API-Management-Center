---
date: 2026-05-11
description: CLIProxyAPI PR #3345 — Claude OAuth /api-call 修复方案
---

# CLIProxyAPI PR: Fix Claude OAuth chat through /api-call

**Target Repo**: router-for-me/CLIProxyAPI
**Branch**: dev
**Title**: `fix: add Claude OAuth token refresh and Anthropic header injection in /api-call`

## Problem Description (User Perspective)

When using Claude OAuth authentication through the proxy, quota requests (`/api/oauth/usage`) work correctly but chat requests routed through `/api-call` to `api.anthropic.com/v1/messages` fail with 401 authentication errors. Other OAuth providers (Codex, Antigravity) work fine for both quota and chat.

## Root Cause

Two issues in `internal/api/handlers/management/api_tools.go`:

**1. Missing Claude OAuth refresh (lines 251-267)**

`resolveTokenForAuth` has dedicated OAuth token refresh logic for `gemini-cli` and `antigravity`, but the `claude` case falls through to `tokenValueForAuth(auth)` which returns the token as-is without ever refreshing. When the access token expires, stale tokens produce 401 errors. The Claude executor (`claude_executor.go:700-726`) already has the refresh implementation via `claudeauth.NewClaudeAuthWithProxyURL`.

**2. Missing Anthropic header injection in APICall handler (lines 145-184)**

Anthropic's Messages API requires `x-api-key` header (not `Authorization: Bearer`) and `anthropic-beta: oauth-2025-04-20` for OAuth tokens. The generic `/api-call` handler does generic `$TOKEN$` substitution but applies no Anthropic-specific processing. The Claude executor (`claude_executor.go:930-978`) handles this correctly but the `/api-call` path bypasses it entirely.

## Fix

Two additive changes in `api_tools.go`:

1. Add `claude` case in `resolveTokenForAuth` after the `antigravity` block, calling `claudeauth.NewClaudeAuthWithProxyURL(h.cfg, auth.ProxyURL).RefreshTokensWithRetry(ctx, refreshToken, 3)`

2. In the `APICall` handler, after `$TOKEN$` substitution, detect `api.anthropic.com` destinations and inject `x-api-key` header + ensure `anthropic-beta: oauth-2025-04-20`

## Safety

- Changes are additive (new case in existing switch, header auto-injection guarded by URL+token pattern)
- Reuses existing `claudeauth` package (already imported)
- Existing test file: `api_tools_test.go`
- No change to non-Anthropic provider behavior
