---
id: p00012
title: "p00012 — `.github/agents.md` root manifest for the orchestrator"
kind: feat
status: done
type: proposal
track: export-to-postman
date: 2026-07-31
related:
    - p00005 # the agents themselves
    - p00006 # the contract doc
    - p00011 # the lint rule
---

> **Cerrada 2026-08-06.** `.github/agents.md` escrito: arquitectura, gate, dónde tocar cada cosa, las 6 reglas que rompen el build y los 4 tools.

# p00012 — `.github/agents.md` root manifest for the orchestrator

## Goal

Add a single `.github/agents.md` file at the repo root that gives the
mcp-vertex orchestrator a one-pager overview of:

- What the package does.
- Which 4 agents drive the workflow (per p00005) and their order.
- Which 4 plugin tools are available.
- Which proposals are `ready` and what slice is next.
- The hard rules (no `process.cwd()` in tools, idempotent builds,
  no shell, etc.).

This is the **reading assignment** for any orchestrator that wakes up
on this repo. It is small enough to fit in a single context window
and acts as a "RAG cache" for the rest of the proposal system.

## why

Right now the orchestrator must read at minimum:

- `README.md` (600 lines).
- `plugins/postman-exporter/README.md` (50 lines).
- `plugins/postman-exporter-testing/README.md` (50 lines).
- The proposal overview (4 to 10 docs).
- `.github/copilot-instructions.md` (the pointer).

That's 800+ lines of context for a single decision. The manifest
brings it down to <100 lines.

## non-goals

- Replacing the README or the contract docs. The manifest is a
  cached overview, not a substitute.
- A second copy of the proposals. The manifest links to them.
- A status dashboard. The status is in the proposals tree.

## slice

### S1 — `.github/agents.md` manifest
- **Status**: ready
- **Files**: `.github/agents.md` (new).
- **Gate**: `wc -l .github/agents.md < 100`.

- Sections (in order):
  1. **Package role** — 4 lines, what the package does.
  2. **Agents** — table of 4 agents (`onboarding`, `builder`,
     `validator`, `tester`) and their lane.
  3. **Tools** — table of 4 plugin tools (`postman_exporter_*`)
     and the input/output contract.
  4. **Proposals** — links to each `ready/` proposal with id +
     title.
  5. **Hard rules** — bullet list of 5 non-negotiable rules.
  6. **Next slice** — one line pointing to the next open
     proposal.
- **Acceptance**:
  - Reads in <100 lines.
  - Cross-references every plugin tool and every agent.
  - The "next slice" line is updated by the orchestrator on close
    (out of scope for v0.1; tracked via a TODO).

## acceptance

A new orchestrator that starts on this repo can answer the
question "what is the next slice?" in 1 turn reading the manifest
+ the proposals it links to.
