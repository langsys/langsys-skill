# API keys and environment variables

## Two key types

| Key | Registers new phrases | Use in |
|---|---|---|
| **Write** | ✅ yes | Development, staging |
| **Read-only** | ❌ no | **Production** |

The SDK detects which it has from the validation response — you do not configure this. With a read-only key, new phrases are silently skipped (no errors); untranslated content falls back to the base language.

**Why it matters:** a write key in production means every phrase your users' browsers encounter gets registered — including anything rendered from user data. Combined with a pre-formatted phrase ([invariants.md §0](./invariants.md)), that is unbounded catalog growth driven by production traffic.

---

## Env var prefix by bundler

**The single most common misconfiguration.** The variable must carry the prefix the bundler exposes to client code, or it is `undefined` at runtime with no build error.

| Stack | Prefix | Access |
|---|---|---|
| Vite (React/Vue/Svelte SPA) | `VITE_` | `import.meta.env.VITE_LANGSYS_PROJECT_ID` |
| SvelteKit (client) | `PUBLIC_` | `import { PUBLIC_LANGSYS_PROJECT_ID } from '$env/static/public'` |
| Next.js (client) | `NEXT_PUBLIC_` | `process.env.NEXT_PUBLIC_LANGSYS_PROJECT_ID` |
| Nuxt (client) | `NUXT_PUBLIC_` | `useRuntimeConfig().public.langsysProjectId` |
| Create React App | `REACT_APP_` | `process.env.REACT_APP_LANGSYS_PROJECT_ID` |
| Node / server-only | *(none)* | `process.env.LANGSYS_PROJECT_ID` |
| PHP | *(none)* | `getenv('LANGSYS_PROJECT_ID')` |

**Server-side code has no prefix requirement.** In Next.js/Nuxt/SvelteKit, keep the key unprefixed when it is only used in server code — that keeps it out of the client bundle entirely, which is strictly better.

---

## Client-side keys are public

Anything in a client bundle is readable by users. This is expected for Langsys — a read-only key exposes only your translation catalog, which ships in the page anyway.

But:

- **Never ship a write key to the client.** Anyone could register phrases into your project.
- **Prefer server-side init** where the framework allows it, with the catalog seeded to the client via `initialTranslations`.

## Never commit keys

```gitignore
.env
.env.local
.env.*.local
!.env.example
```

Provide a checked-in `.env.example`:

```bash
# Write key for development — read-only key in production
VITE_LANGSYS_PROJECT_ID=your-project-uuid
VITE_LANGSYS_API_KEY=your-api-key
```

## Checklist

- [ ] Prefix matches the bundler
- [ ] Read-only key in production config
- [ ] `debug: false` in production
- [ ] `.env` gitignored, `.env.example` committed
- [ ] No key literal anywhere in source
