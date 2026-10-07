# T-019: Documentation (README, SETUP, RUNBOOK, etc.)
Sprint: 4 | Epic: E8 Documentation and Handover | Points: 3 | Depends on: T-018

## User story
As a stranger (reviewer, operator, future junior), I want the README to take me from clone to a
working simulated system — and SETUP/RUNBOOK plus the written submission items — so I can run,
operate and hand over the project without asking anyone.

## Workplan references
- Section 13 — submission items A (brief), B (architecture diagram + page), E (cost/feasibility),
  F (risk/security), G (runbook), H (handover & 90-day plan).
- Section 16 — Operations Runbook outline (translated to WhatsApp-only).
- Section 17 — Handover and 90-day plan.
- README must disclose AI tools and contain no secrets.

## Acceptance criteria
- [x] README explains how to obtain, use and rotate the staff API key: exact generate command,
  every protected endpoint, the `x-api-key` header, and the 401 behaviour.
- [x] README explains simulated vs live: how to run the simulation (simulate endpoint,
  signed-webhook script, outbound log, failure hooks) and the complete switch-to-live checklist
  (Cloud API values, ngrok, subscribe to `messages`), including how to switch back.
- [x] README carries a stage-by-stage workflow guideline naming the specific endpoints per stage
  (bring-up → inbound → pipeline → orders → tickets → monitoring).
- [ ] `SETUP.md`: from-scratch setup (clone → install → env → Mongo → seed → run → verify) for
  both Docker and no-Docker paths, no prior context assumed.
- [ ] `RUNBOOK.md`: start / monitor / troubleshoot / maintain (§16 translated to WhatsApp-only),
  with the known failure modes and their checks (`/health`, failure counters, overdue tickets).
- [ ] Written items drafted: A, B (one diagram + one page), E (naira figures with stated FX
  assumption), F (T-018 output polished), G = RUNBOOK, H (90-day plan).
- [ ] No secrets anywhere; AI-tools disclosure present (already satisfied — keep it true).

## Implementation notes
- Files: `README.md` (sections done in the sprint-setup pass), `SETUP.md` (repo root,
  standalone), `RUNBOOK.md` (repo root), written items under `docs/`.
- Keep tables as the primary format — they survive skimming. Duplicate the critical commands in
  SETUP.md rather than linking (the reviewer may open a single file).
- README's "Obtaining keys and secrets" stays the deep reference; the new sections link to it
  instead of repeating it.

## Tests required
- Docs-only; verify by copy-pasting the critical path once (fresh clone → quick start →
  simulate → complaint → dashboard) and checking every internal link/anchor resolves.

## Explain-it notes
- README as the product's front door: the first 60 seconds decide whether it gets run at all.
- Why SETUP duplicates README commands on purpose — single-file readers.
- What fails first: examples and counts drifting from behaviour — update docs in the same change
  that moves the code.

## Status log
- 2026-10-07: Sprint-setup documentation pass delivered: staff API key how-to (generate / use /
  rotate + protected-endpoint list + 401 behaviour), new "Simulated vs live mode" section
  (simulation kit + step-by-step switch-to-live checklist), new "The workflow, stage by stage"
  section (endpoint table per stage), plus TOC / quick-start / status / roadmap touch-ups.
  Remaining: SETUP.md, RUNBOOK.md, written items A/B/E/F/H.
