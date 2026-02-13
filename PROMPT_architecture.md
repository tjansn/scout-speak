# Prompt: Derive Architecture + Tech Stack + Algorithms + Assumptions from `prd.md` (with Mandatory Human Clarification Loop)

You are an agent in a spec-driven workflow. You now move from **what** (PRD) to **how** (design), while keeping the design as simple as possible.

## Objective
Using the already existing `prd.md` as the source of truth, create or update these artifacts:

1) `techstack_and_frameworks.md`
2) `system_architecture_and_data_flow.md`
3) `algorithm_and_data_structures.md`
4) `assumptions.md`

**Critical rule:** You must explicitly surface your assumptions to the human, ask clarifying questions, and then:
- update the three design documents based on the answers, and
- delete all clarified assumptions from `assumptions.md` (only unresolved assumptions remain).

## Ground Rules
- `prd.md` is authoritative. Do not contradict it.
- Prefer **KISS**: simplest design that satisfies the PRD.
- Favor well-documented, widely used, well-maintained tools/frameworks.
- Do not over-engineer. If uncertain, propose a minimal path and list alternatives.
- Every design decision must map to a PRD requirement (traceability).
- If you must guess, write it into `assumptions.md` and ask the human to confirm.

## Required Workflow (must follow in order)

### Step 1 — Read PRD and Extract Constraints
Read `prd.md` and extract:
- user-facing requirements and acceptance criteria
- scope in/out
- quality constraints (performance, privacy, reliability, etc.)
- key user flows
- data inputs/outputs
- any explicit constraints on environment, hosting, budget, timeline, team skills

Write a short internal checklist (not a file) of “design drivers”.

### Step 2 — Repo Reality Check (required)
Explore the repository to determine:
- current language(s), frameworks, and structure
- existing modules/components you must integrate with
- existing deployment approach (if any)
- existing patterns (logging, config, testing, error handling)
- constraints that effectively force certain choices

If repo reality conflicts with PRD, record the mismatch in `assumptions.md` and propose resolution options.

### Step 3 — Draft Design Documents (Version 0)
Create/update the three design docs using ONLY what is known from PRD + repo findings.
Anything not known must be written as an assumption (and not silently decided).

#### 3A) `techstack_and_frameworks.md` (required contents)
- **Decision summary** (what stack you recommend right now)
- **Selection criteria** (why this fits the PRD + repo reality)
- **Options considered** (2–4 viable alternatives)
- **Decision log** (table: Decision | Chosen | Why | Trade-offs | PRD link)
- **Versioning notes** (pin versions only if repo already does; otherwise state intent)
- **Operational simplicity notes** (how choices reduce complexity)

Avoid generic statements. Make each choice defensible.

#### 3B) `system_architecture_and_data_flow.md` (required contents)
- **High-level architecture** (main building blocks and responsibilities)
- **Data flow**: describe “what goes where” in steps
- **Trust boundaries** (what is trusted/untrusted; what must be validated)
- **Error handling strategy** (how failures behave for users; retries; fallback)
- **State & storage** (describe what must be remembered over time and why)
- **Interfaces** (inputs/outputs between components, described plainly + with structured bullets)
- **Diagram**: provide a simple ASCII diagram (no images required)

Keep boundaries clean. Identify “deep modules” (stable interfaces, testable in isolation).

#### 3C) `algorithm_and_data_structures.md` (required contents)
- **Core algorithms** (only if needed; otherwise say “none beyond standard CRUD/filtering”)
- For each algorithm:
  - goal
  - simplest approach that meets requirements
  - complexity considerations (big-O only if it matters)
  - failure/edge cases
- **Key data structures / domain models**
  - list entities and relationships
  - include invariants (what must always be true)
- **Validation rules** (what inputs are rejected/normalized)
- **Alternatives** (if there are 2+ approaches, list trade-offs)

### Step 4 — Create `assumptions.md` (strict rules)
Create/update `assumptions.md` as the single place for unresolved assumptions.

Format as a numbered list. For each assumption include:
- **Assumption statement** (clear, testable)
- **Why it matters** (impact on design/scope)
- **Proposed default** (what you’d do if user doesn’t care)
- **Options** (A/B/C/Other), phrased so a human can answer quickly
- **Where it affects docs** (which file/section will change)

Assumptions must include (when not explicitly specified in PRD/repo):
- deployment/hosting environment expectations
- traffic/load expectations
- data volumes/limits
- privacy/sensitivity requirements beyond PRD
- authentication/access model expectations
- reliability expectations (acceptable downtime; recovery)
- integrations availability (what external systems exist)
- target platforms (web/mobile/desktop), browsers, devices
- any “must use” constraints (language, cloud, vendor)
- timeline or milestones (if relevant)

### Step 5 — Mandatory Human Clarification (blocking step)
Before finalizing design, ask the human to answer the assumptions.

**You must:**
- present the assumptions as a compact questionnaire
- for each, provide 2–5 options (A/B/C/Other)
- ask the human to respond using the option letters plus any notes

**Do not proceed** to finalizing design docs without collecting answers.
If the human refuses to decide, apply your “Proposed default” and record it as a decision in the relevant doc, not as an assumption.

### Step 6 — Apply Answers and Update Documents
After receiving the human’s answers:
1) Update `techstack_and_frameworks.md`, `system_architecture_and_data_flow.md`, `algorithm_and_data_structures.md` to reflect clarified decisions.
2) Move clarified items out of `assumptions.md`:
   - If resolved → remove from `assumptions.md` and record as a decision where it belongs.
   - If still unresolved → keep in `assumptions.md` with updated context/options.

### Step 7 — Final Consistency Pass
- Ensure no design doc contradicts `prd.md`.
- Ensure design docs do not contain “hidden assumptions”; everything uncertain is either clarified or remains in `assumptions.md`.
- Ensure each key PRD requirement is covered by architecture/stack choices.
- Keep documents concise and actionable.

## Output Requirements
- Write/update all four files in the repo root (or the established docs folder).
- Use clear headings and bullet lists.
- Include explicit trade-offs and alternatives for major decisions.
- Keep the design minimal, testable, and modular.

Now execute the workflow starting at Step 1.