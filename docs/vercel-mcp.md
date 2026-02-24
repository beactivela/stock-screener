# Vercel MCP integration

This project is wired for the **Vercel MCP** in Cursor. The MCP is already enabled as `user-Vercel`.

## What it does

- **Deploy**: Deploy the current project to Vercel (no CLI needed from you).
- **Status**: List teams → projects → deployments; get a specific deployment by ID or URL.
- **Debug**: Fetch build logs or runtime logs for a deployment (e.g. failed builds).
- **Docs**: Search Vercel documentation from the agent.

## How you use it

- Ask in chat, e.g. “Deploy to Vercel”, “Why did my last Vercel build fail?”, “Show me recent deployments”, “Get build logs for [deployment url]”.
- The agent will use `call_mcp_tool` with server `user-Vercel` and the right tool.

## Project config

- **vercel.json** — Build command, output directory (`dist`), SPA rewrites, serverless function limits.
- **.vercel/project.json** — Created after linking (e.g. `vercel link`). Contains `orgId` (team) and `projectId`; the MCP uses these when you don’t pass team/project explicitly.

## Cursor rule

`.cursor/rules/vercel-mcp.mdc` tells the agent to use the Vercel MCP when you’re in `vercel.json` or `.vercel/` or when the request is about deploying/status/logs. The rule lists tool names and typical workflows so the agent can call the right tool with the right arguments.

## Tool reference (for the agent)

| Tool | Purpose |
|------|--------|
| `list_teams` | Get team IDs |
| `list_projects` | Get projects (needs teamId) |
| `list_deployments` | List deployments (projectId, teamId) |
| `get_deployment` | One deployment by id/url |
| `get_deployment_build_logs` | Build logs (debug failures) |
| `get_runtime_logs` | Runtime logs |
| `deploy_to_vercel` | Deploy current project |
| `get_project` | Project details |
| `search_vercel_documentation` | Search Vercel docs |

Team/project IDs can come from `.vercel/project.json` after `vercel link`.
