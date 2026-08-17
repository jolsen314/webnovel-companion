# CLAUDE.md — Webnovel Companion (operating manual)

This file auto-loads into every context window. It's the **operating manual**. The other two docs:
- **[README.md](README.md)** — the design doc (what & why, data model, roadmap tiers).
- **[PLAN.md](PLAN.md)** — the living build tracker (work packages WP-00…WP-26, status, priority order, changelog).

Read PLAN.md's "Current focus" first to see what's active.

---

## Working agreements (always on)

1. **Skill-first.** Before acting (including clarifying questions or exploring files), check whether a skill applies
   and invoke it — process skills before implementation skills. See the playbook below. (`superpowers:using-superpowers`)
2. **TDD for all `lib/` logic.** No production code without a failing test first; red → green → refactor; watch each
   test fail for the right reason. (`superpowers:test-driven-development`)
3. **Verify before claiming done.** No completion/"passing"/"fixed" claim without *fresh* command output in the same
   message — run `npm test` + `npm run typecheck`, read exit codes, then claim. (`superpowers:verification-before-completion`)
4. **Stop at every WP boundary and check in** with the user before picking up the next work package. Don't chain WPs.
5. **Keep `lib/` pure and Next-free** — no `next`/`prisma`/`fs`/network imports in `src/lib/**`; route handlers stay
   thin and call `server/services`. (Design rule from the README.)
6. **Update PLAN.md as work lands** — flip WP status, add a changelog line, set the next `NEXT`.

---

## Skill playbook (task → skill)

Invoke via the Skill tool (or the named Agent for agent-type entries). Where duplicates exist, the **primary** is
marked; use it unless there's a reason not to.

### Process & discipline (reach for these first)
| When | Skill |
|------|-------|
| Starting any task — confirm the right skill | `superpowers:using-superpowers` |
| Feature/bugfix, test-first | `superpowers:test-driven-development` **(primary TDD ritual)** · `mattpocock-skills:tdd` (TS-flavored alt) |
| About to claim done / commit / PR | `superpowers:verification-before-completion` |
| A bug, test failure, or weird behavior | `superpowers:systematic-debugging` · `mattpocock-skills:diagnosing-bugs` |
| Greenfield / "let's build X" design questions | `superpowers:brainstorming` |
| Multi-step work needs a written plan | `superpowers:writing-plans` (PLAN.md is our tracker) |
| Several independent tasks at once | `superpowers:dispatching-parallel-agents` / `subagent-driven-development` |
| Wrapping up a branch | `superpowers:finishing-a-development-branch` |

### TypeScript & module design (Matt Pocock set — our TS authority)
| When | Skill |
|------|-------|
| Designing/deepening a module's interface (e.g. `lib/*` seams, testability) | `mattpocock-skills:codebase-design` |
| Pinning domain terms / the Prisma model vocabulary | `mattpocock-skills:domain-modeling` |
| Investigating a hard TS bug or perf regression | `mattpocock-skills:diagnosing-bugs` |

### Database & persistence (WP-04 — ⏸ PAUSE before starting)
| When | Skill |
|------|-------|
| Modeling the domain / invariants before schema | `mattpocock-skills:domain-modeling` |
| Schema, migrations, repository patterns | `ai-toolkit:database-patterns` · `ai-toolkit:spartan:migration` — **verify Prisma/Postgres fit**; several ai-toolkit DB skills assume Kotlin/Exposed or company rules |

> **Standing instruction:** do not begin WP-04 (Prisma schema/migrations) without first pausing to pick DB skills
> and checking in with the owner. See PLAN.md → WP-04.

### Quality gating & review (ai-toolkit for gates)
| When | Skill / Agent |
|------|------|
| Quality gate at a WP boundary / before merge | `ai-toolkit:spartan:gate-review` (dual-agent) · `ai-toolkit:phase-reviewer` (agent) |
| Review a diff (standards + spec) | `mattpocock-skills:code-review` **(primary)** · built-in `/code-review` |
| Simplify recently-changed code (no bug hunt) | built-in `/simplify` · `code-simplifier:code-simplifier` (agent) |
| JS/TS dependency & supply-chain security | `ai-toolkit:js-security-audit` · built-in `/security-review` |

### Frontend / UI (arrives with WP-06, WP-10, WP-18)
| When | Skill / Agent |
|------|------|
| Building or reshaping UI — aesthetic direction, typography | `frontend-design:frontend-design` **(primary)** |
| Avoiding AI-generic patterns; design tokens/system | `ai-toolkit:design-workflow` · `ai-toolkit:ui-ux-pro-max` |
| Design review / critique | `ai-toolkit:design-critic` (agent) |
| Any chart/graph/stat tile (comprehension %, streaks — Tier 3) | `dataviz` |

### Next.js scaffolding & E2E (WP-06+, WP-11)
| When | Skill |
|------|-------|
| Scaffolding the Next app / a new feature | `ai-toolkit:spartan:next-app` · `ai-toolkit:spartan:next-feature` |
| Browser QA / E2E (Playwright MCP is available) | `example-skills:webapp-testing` · `ai-toolkit:browser-qa` |

### Python NLP sidecar (WP-25, later — the one non-TS service)
| When | Skill |
|------|-------|
| FastAPI endpoints / structure / async | `ai-toolkit:python-best-practices` · `ai-toolkit:python-api-endpoint-creator` |
| Python test setup (pytest-asyncio) | `ai-toolkit:python-testing-strategies` |

### Writing, docs & memory
| When | Skill |
|------|-------|
| README/docs/UI copy/commit messages — tighten prose | `elements-of-style:writing-clearly-and-concisely` |
| Co-authoring a longer doc | `example-skills:doc-coauthoring` |
| "Did we decide/discuss X before?" | `episodic-memory:remembering-conversations` |
| Deep multi-source research | `deep-research` · `mattpocock-skills:research` |

---

## Not applicable to this project (don't get lured in)

The installed ai-toolkit/spartan surface is huge and mostly built for a different context. **Skip** unless the
project pivots: Terraform/AWS/infra (`tf-*`, `sre-architect`, `infrastructure-expert`), Kotlin/Micronaut
(`kotlin-*`, `micronaut-backend-expert`, `testcontainer`), the startup/investor pipeline (`kickoff`, `validate`,
`pitch`, `fundraise`, `outreach`, `lean-canvas`, `idea-killer`), and Terraform cost/drift tooling. This is a
**personal, single-user TypeScript PWA** (Next.js + Vercel + Postgres, plus one small Python sidecar later).

---

## Stack & commands (quick ref)

- **Stack:** Next.js (App Router) + TS strict · Tailwind · Postgres + Prisma · web-push (VAPID) · rss-parser ·
  Vercel + Vercel Cron · Vitest (unit + integration) · Playwright (later) · Python + FastAPI + kiwipiepy (later).
- **Test:** `npm test` (Vitest, unit project) · **Typecheck:** `npm run typecheck` · **Watch:** `npm run test:watch`.
- Vitest projects: `unit` (fast, `tests/unit/**`) and `integration` (serialized single-fork, `tests/integration/**`).

---

## Note on skill authorities (duplicates resolved)

Multiple plugins ship overlapping skills. Decisions, so we stay consistent:
- **TDD ritual:** `superpowers:test-driven-development` is primary (it's what we've been running). `mattpocock-skills:tdd`
  is a fine TS-flavored alternative but don't mix both mid-task.
- **Frontend design:** `frontend-design:frontend-design` (identical content ships as `example-skills:frontend-design`).
- **Code review:** `mattpocock-skills:code-review` for branch/diff review; `ai-toolkit:spartan:gate-review` for the
  dual-agent quality gate at WP boundaries.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
