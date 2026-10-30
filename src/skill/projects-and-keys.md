# The project, the keys, and whether anything registers

True for every Langsys SDK in every language. Each core skill adds its own API for these; none
of them restates the rules below.

A Langsys project is identified by a **project UUID** and accessed with an **API key**. Both
go in every SDK's init. The project owns one catalog, shared by every SDK that connects to it —
which is why the rules here are not per-language.

---

## The three key types

| Key | Registers new content |
|---|---|
| `read` | Never. Fetches translations only |
| `write` | In any session the server lets write. Keep it out of anything you ship publicly |
| `ip_write` | Only from an address on the key's allow-list; read-only everywhere else |

`ip_write` is what you ship in a public production site: visitors' browsers read, while your
own allow-listed machines register.

**A write key in production registers whatever your users' browsers encounter**, including
anything rendered from user data. Combined with a built phrase string, that is unbounded
catalog growth driven by production traffic, in shared state, permanently.

---

## The key is not the whole answer

On current SDKs — base SDK **0.7+** and PHP SDK **2.0+** — **the server decides whether a
session may register, per session.** It answers when init authorizes and again with every
catalog it serves, so a session follows a change without re-initializing.

Four consequences, and each one surprises someone:

1. **An answer without a write decision is read-only** — including for a `write` key. There is
   no "assume yes".
2. **An `ip_write` key registers nothing off its allow-list.** Same key, same code, different
   machine, different outcome.
3. **Write grants are per user.** An app behind a login makes its own users' sessions
   write-enabled with a short-lived token the backend mints. Because the decision is then
   per-user, a server process that renders for many users cannot hold one.
4. **The SDK never infers it from the key type and never caches it.**

On older SDKs — base SDK 0.6.x, which is what the React and Vue bindings install, and PHP SDK
1.x — the key's type is the whole decision, read once from the validation response. See
[sdk-versions.md](./sdk-versions.md) for which applies here.

### Reporting a page is not registering it

A session that cannot write still tells Langsys **where** untranslated content is, never what
it says: on a miss it reports the page's URL and nothing else, and Langsys records it.

**A recorded URL is a list of pages known to hold untranslated content.** It tells you where
to look. Nothing on that list registers by itself.

Content reaches the catalog only when a **write-enabled session renders the page**. In
practice that is one of:

- an allow-listed machine using an `ip_write` key — a staging pass, a crawl, a developer with
  the app open;
- a signed-in user whose session carries a write grant.

So an integration whose only write path is "a visitor hits the page" registers nothing, and
the reported pages stay reported. Decide which of the two routes above the project uses, and
say so in the plan.

Reporting is gated on the key's own discovery policy. Tracking parameters are stripped first,
and a URL carrying a credential-shaped parameter is never reported at all. A session that
**can** write registers and never reports. Nothing is reported from a server render.

---

## "Nothing is registering" — what to check, in order

The most common fault on current SDKs, and the one that reading your own code will not
explain: the key is right, the code is right, and the server said no.

```
Phrases are not appearing in the Translation Manager
│
├─ Did init succeed?                 check what init returned. A refused authorization
│                                    is reported there and nowhere else
│
├─ Is the session write-enabled?     the SDK exposes the server's answer; each core skill
│  │                                 names it (writeEnabled / canWrite())
│  ├─ never answered  ──────────────▶ init never authorized. Back to the line above
│  ├─ false, one warning logged ────▶ a write or ip_write key the server refused:
│  │                                  off an ip_write allow-list, or a grant that is
│  │                                  not arriving. The warning is logged outside debug
│  └─ false, no warning ────────────▶ a read key. Expected. Nothing will register;
│                                     the reported URLs need a write-enabled visit
│
├─ Is anything visiting write-enabled?  a read-only session only reports. See above
│
├─ Does the framework need a build step?  Svelte's langsysPreprocess() is the live case:
│                                     without it, blocks render translations and register
│                                     nothing. Ask the framework's own skill
│
└─ All of the above fine? ──────────▶ not a capability problem. Go to verify.md and
                                      inspect the registered phrase set
```

Order matters: every row below a failing row will look broken for the row above's reason.

---

## Environment variables

**The single most common misconfiguration.** The variable must carry the prefix the bundler
exposes to client code, or it is `undefined` at runtime with no build error.

| Stack | Prefix | Access |
|---|---|---|
| Vite (React/Vue/Svelte SPA) | `VITE_` | `import.meta.env.VITE_LANGSYS_PROJECT_ID` |
| SvelteKit (client) | `PUBLIC_` | `import { PUBLIC_LANGSYS_PROJECT_ID } from '$env/static/public'` |
| Next.js (client) | `NEXT_PUBLIC_` | `process.env.NEXT_PUBLIC_LANGSYS_PROJECT_ID` |
| Nuxt (client) | `NUXT_PUBLIC_` | `useRuntimeConfig().public.langsysProjectId` |
| Create React App | `REACT_APP_` | `process.env.REACT_APP_LANGSYS_PROJECT_ID` |
| **Rollup, webpack** | **none injected** | wire it yourself — `@rollup/plugin-replace`, `DefinePlugin` |
| Node / server-only | *(none)* | `process.env.LANGSYS_PROJECT_ID` |
| PHP | *(none)* | `getenv('LANGSYS_PROJECT_ID')` |

**Rollup and webpack have no convention.** `process.env` does not exist in a browser bundle,
so an unprefixed variable there is not "server-only" — it is `undefined`, with no build error.

**Server-side code has no prefix requirement.** In Next.js, Nuxt and SvelteKit, keep the key
unprefixed when only server code reads it; that keeps it out of the client bundle entirely,
which is strictly better.

---

## Client-side keys are public

Anything in a client bundle is readable by users. For a `read` key that is expected — it
exposes only your translation catalog, which ships in the page anyway. But:

- **Never ship a `write` key to the client.** Anyone could register phrases into your project.
- `ip_write` is the public-site answer, because the allow-list, not the secrecy of the key, is
  what gates writing.
- **Prefer server-side init** where the framework allows it, seeding the catalog to the client.

## Never commit keys

```gitignore
.env
.env.local
.env.*.local
!.env.example
```

Provide a checked-in `.env.example`:

```bash
# Write key in development; read-only or ip_write in production
VITE_LANGSYS_PROJECT_ID=your-project-uuid
VITE_LANGSYS_API_KEY=your-api-key
```

**A write grant is not an env var.** It is short-lived — minutes — so a build-time value is
one that has already expired. The app fetches one at runtime from your own backend.

## Checklist

- [ ] Prefix matches the bundler, or it is wired explicitly (Rollup, webpack)
- [ ] `read` or `ip_write` key in production config, never `write`
- [ ] Debug diagnostics off in production
- [ ] `.env` gitignored, `.env.example` committed
- [ ] No key literal anywhere in source
- [ ] No write grant in `.env` or any build-time config
- [ ] The project has a decided write path: an allow-listed machine, or grants for signed-in users
