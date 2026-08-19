# The Langsys MCP server

With the MCP connected, this skill can **create the organization, the project and the API key for you**. Without it, those are manual steps you do in the Translation Manager and paste back.

Everything else in the skill works either way. The MCP removes the copy-paste, and the setup step that most often stalls an integration halfway.

## Add it

```bash
claude mcp add --scope=user --transport http langsys https://mcp.langsys.dev/mcp
```

**Use `--scope=user`.** It registers the server for your account rather than one project, so it is available in every project you open — which is what you want, since the moment you need it is the moment you are starting a *new* integration somewhere else.

Other hosts use the same HTTP endpoint:

| Host | How |
|---|---|
| Claude Code | the command above |
| Claude Desktop | `claude_desktop_config.json` → `mcpServers.langsys` = `{ "type": "http", "url": "https://mcp.langsys.dev/mcp" }` |
| Cursor / Windsurf | HTTP transport, URL `https://mcp.langsys.dev/mcp` |

## Authenticate

**Browser sign-in is the default and the one to use.** The first tool call returns an authorization challenge, your client opens a browser, you approve, and that is it — OAuth 2.1, no secret pasted into a config file.

Headers exist for automation, where no browser can open:

```bash
--header "Authorization: Bearer YOUR_API_TOKEN"     # add X-Device-Id if required
--header "X-Authorization: YOUR_API_KEY"            # API key instead
```

Prefer browser sign-in for a developer machine. A token in a shell command lands in shell history and in any config you commit.

## Check whether you have it

Before the setup steps, look at whether Langsys MCP tools are available in this session.

- **Tools present** → do the setup below. Do not ask the user for a project ID and key they may not have created yet.
- **Tools absent** → say so once, give the `claude mcp add` line, and offer both paths: add it now, or paste an existing project ID and key. **Do not stall the integration on it** — the skill works fully without the MCP, and someone who already has credentials does not need it.

## What it unlocks

The server exposes the Langsys API as tools — organizations, projects, API keys, translatable items, translations and machine translation — plus the documentation as browsable resources.

For an integration, the useful sequence is:

1. Confirm or create the **organization**
2. Create the **project**, and set its base locale to the one the profile settled on
3. Create **two API keys** — a write key for development, a read-only key for production
4. Write them into `.env` with the prefix the bundler requires (see [secrets.md](./secrets.md))

**Create two keys, not one.** This is the moment it costs nothing. A single key ends up in both environments, and a write key in production registers phrases from live user traffic — the pollution is permanent and shared, and nobody notices until a translator asks about the catalog. See [invariants.md](./invariants.md).

Confirm the base locale with the user before creating the project. `en-GB` and `en-US` are different catalogs, and the choice is not reversible by editing a config file.

## What it does not change

- **Phrase discovery is still runtime.** The MCP creates the project; your running app registers the phrases. There is no "upload my strings" step, and reaching for one means something has been misunderstood.
- **The primitive decision is still yours.** No tool chooses between `t()`, `<Phrase>` and `<Translate>`.
- **Machine translation is not review.** The MT tools produce a draft. For anything user-facing, a human should see it before it ships.

## Ask before you create

Creating an organization or a project is durable, shared, and visible to everyone on the account. Confirm the names with the user first, and prefer an existing project over a new one when a plausible match already exists — a duplicate project with half the phrases in it is worse than no project.
