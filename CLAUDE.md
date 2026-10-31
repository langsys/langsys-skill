# langsys-skill

The **entry skill** for the Langsys skill set, and the **installer** for the skills that ship
inside each SDK. `src/skill/` is the payload; everything else exists to keep it true.

## What belongs here, and what does not

The skill set is a tree. Each node ships in the repo it describes, released in the same commit
as the code it documents:

```
langsys                    this package
├── langsys-typescript     in langsys-js-typescript
│   ├── langsys-svelte     in langsys-js-svelte
│   ├── langsys-react      in langsys-js-react
│   └── langsys-vue        in langsys-js-vue
└── langsys-php            in langsys/langsys-php
    └── langsys-laravel    in langsys/langsys-php-laravel
```

**Here:** what is true in every language — what Langsys is, choosing the SDKs, projects and
keys, categories, the MCP, the tools, projects rendering through two SDKs, the shared
acceptance criteria, and the `preamble.md` template every other skill carries.

**Not here:** any SDK's own API. If a guide would describe `t()`'s signature or a framework's
components, it belongs in that package's skill.

**`pinned/` is the exception, and it is temporary.** An SDK that has not yet shipped its own
skill keeps a guide here, pinned to **one published version**, exact — not a floor. Outside that
version, `doctor` routes the agent to the package's README. A guide one minor behind reads as
authoritative and is wrong exactly where Langsys fails silently, so "close" is not a pass.
Delete a pinned guide when its SDK ships a skill; a stale copy here outranks the real one,
because this payload installs whether or not the SDK's skill does.

## The rule everything else follows

**Verify against the published artifact, never a sibling working tree.** `npm pack pkg@version`
or `git archive <rev>`, not `../pkg/src`. A working tree's declared version can lag the behavior
its source implements, and `VERIFIED.md` records how that trap was walked into. Every claim
names the version it was checked against.

Prefer **executing** a claim to reading it. Several entries in `VERIFIED.md` exist because
reading the signature gave the wrong answer and running it gave the right one.

## Checks

```bash
npm test                              # the suite — must be green before a commit
npm run lint                          # ast-grep over the payload's own examples
node src/lint/markup-check.mjs src/skill/
npm run contract                      # the shared preamble + inbound links from SDK skills
npm run drift                         # re-verify claims against published SDKs (hits npm)
node src/bin/changelog-coverage.mjs . --strict
node src/lint/generate-rules.mjs      # regenerate rules; CI fails if output differs
```

`skill-contract` has two modes and they differ deliberately. `--source=<dir>` is a lane gating
its **own unreleased** skill, so a link naming a directory **fails**. The bare aggregate run
sweeps **already-published** packages, which cannot be edited and which Docs backstops with a
per-directory index, so it **reports** instead. A missing path fails in both. Exit 2 means it
found nothing to check — that is not a pass.

## Releasing

Commit, push and publish each need the **human's** word. The **Reviewer tab** decides the
*order* releases go out across repos — the two approvals are not interchangeable.

1. Suite green, then one read-only review of the whole branch. Every finding you fix gets a test
   that fails without the fix; verify that by reverting the fix and watching its own test go red.
2. Re-run `skill-contract --source=` against an **archive of each SDK skill's release commit**
   (`git archive <rev> skill | tar -x`), not their working trees.
3. Bring `main` to the reviewed commit, push, and tag `vX.Y.Z` **at that commit**, since the
   tarball records `gitHead`. Cleanup commits go after the tag, never before.
4. **Publish by creating the GitHub release for that tag.** `.github/workflows/publish.yml`
   runs the suite, asserts the tarball's contents, and publishes with `--provenance` over OIDC
   trusted publishing — no token, no OTP, nothing for the human to run. `gh release create
   vX.Y.Z --notes-from-tag`, or the equivalent in the web UI.
5. Confirm with `npm view <pkg> dist-tags` and `npm view <pkg>@<version> dist.attestations`.
   **A published version with no attestation did not go through CI.**

**Do not run `npm publish` by hand.** It is not the path this package releases on. It works,
but it costs the provenance attestation every other version carries, and it is the only path
that hits the account's 2FA — so it reads as "an agent cannot publish here", which is false.
`0.3.0` and `0.3.1` are the two versions missing an attestation, for exactly that reason.

### Two things that look like failures and are not

- **npm returns `PUT 202`, not 201**, with "may take a few minutes to become available". A
  registry read straight afterwards still shows the **old** `latest`. That is not a failed
  publish — the log's `202` plus `exit 0` is the evidence. 0.3.0 surfaced in about 30 seconds.
- **npm's local packument cache then serves stale metadata**, so `npx pkg@newversion` can fail
  with `ETARGET no matching version` while the registry is already serving it. Use
  `--prefer-online`.

A `404 Not Found - PUT` during a hand publish means **unauthenticated**, not "package missing";
`npm whoami` answering `401` is the same cause. Neither arises on the CI path, which carries no
token to expire.

Confirm what landed with `npm view <pkg> dist-tags`, not the publish output — a refused publish
prints the same tarball summary as a successful one.
