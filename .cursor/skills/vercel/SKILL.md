---
name: vercel
description: Manage Vercel projects and deployments using MCP tools. Use when the user asks to deploy to Vercel, inspect deployments, debug build/runtime logs, access protected Vercel URLs, or look up Vercel docs.
---

# Vercel Operations

## Use This Skill When

- User asks to deploy the current project to Vercel.
- User asks why a Vercel deploy failed.
- User asks to inspect recent deployments, project config, or runtime logs.
- User shares a `.vercel.app` URL returning `401`/`403`.
- User asks Vercel platform/documentation questions.

## Core Rules

1. Always identify `teamId` and `projectId` first for project-scoped operations.
2. Prefer reading `.vercel/project.json` when present to discover `orgId` and `projectId`.
3. If IDs are missing, call `list_teams` then `list_projects`.
4. For protected Vercel URLs, use `web_fetch_vercel_url` or generate a temporary link with `get_access_to_vercel_url`.
5. For failed deployments, check both deployment metadata and build logs before suggesting fixes.

## Standard Workflow

### 1) Resolve Project Context

1. Read `.vercel/project.json` if it exists.
2. If missing or incomplete:
   - Call `list_teams`
   - Pick `teamId`
   - Call `list_projects` with `teamId`
   - Pick `projectId`

### 2) Deploy

- Call `deploy_to_vercel` for the current project.
- Then verify with `list_deployments` or `get_deployment`.

### 3) Debug Failed Deployments

1. Call `get_deployment` using deployment URL or ID.
2. Call `get_deployment_build_logs` with `idOrUrl` + `teamId`.
3. Summarize root cause and map it to concrete code/config fixes.

### 4) Debug Runtime Issues

- Call `get_runtime_logs` with:
  - `projectId`
  - `teamId`
  - optional `environment`, `level`, `query`, `since`, `limit`
- Start narrow (`since: "1h"`, `level: ["error"]`) then widen if needed.

### 5) Access Protected URLs

- First try `web_fetch_vercel_url` for direct content retrieval.
- If a browser-accessible share link is needed, call `get_access_to_vercel_url` and return the generated URL.

## Tool Quick Reference

- `deploy_to_vercel`: Trigger deploy for current linked project.
- `list_teams`: Discover available teams.
- `list_projects`: Discover projects for a `teamId`.
- `get_project`: Retrieve project details (`projectId`, `teamId`).
- `list_deployments`: List deployments for project/team.
- `get_deployment`: Get deployment by URL or ID.
- `get_deployment_build_logs`: Retrieve build logs for failures.
- `get_runtime_logs`: Retrieve runtime execution logs.
- `web_fetch_vercel_url`: Fetch protected Vercel URLs.
- `get_access_to_vercel_url`: Generate temporary access link.
- `search_vercel_documentation`: Retrieve authoritative Vercel docs by topic.
- `check_domain_availability_and_price`: Check domain availability/pricing.

## Response Pattern

When reporting results:

1. Current state (success/failure, deployment URL/ID, environment).
2. Evidence (key log lines or deployment fields).
3. Root cause hypothesis.
4. Exact next action (command, config change, or code change).

## Examples

### Example: Deploy + Verify

1. Resolve `teamId`/`projectId`.
2. Run `deploy_to_vercel`.
3. Run `list_deployments` for latest status.
4. Share deployment URL and status.

### Example: Build Failure Triage

1. Run `get_deployment`.
2. Run `get_deployment_build_logs` (`limit: 200`).
3. Identify first actionable error and propose minimal fix.

### Example: 403 on Preview URL

1. Run `web_fetch_vercel_url` for the provided URL.
2. If shareable access is needed, run `get_access_to_vercel_url`.
3. Return working URL and expiry note (temporary access).
