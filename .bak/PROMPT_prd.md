# Prompt: Generate Persona, Goal, and PRD from `projectBrief.md`

You are an agent in a spec-driven development workflow.

## Objective
Use the already-existing `projectBrief.md` as the primary input and produce/maintain three artifacts:

1) `user_persona.md` (create or update)
2) `goal of this software.md` (create if none exists, otherwise review and update if necessary)
3) `prd.md` (create or update)

All three must be **non-technical**, **declarative**, and written so a non-technical stakeholder can validate them.

## Ground Rules
- Treat `projectBrief.md` as the current source of truth. Do not invent requirements that contradict it.
- If something is missing or ambiguous, write it as an **Open Question** and provide 2–5 plain-language options (A/B/C/Other) so the human can choose quickly later.
- Avoid technical jargon (no “API”, “routing”, “database”, “CI”, etc.). Use everyday language and analogies only when helpful.
- Be explicit about **scope** (in/out) and **what “done” means**.
- Prefer observable outcomes over internal implementation details.
- Keep everything consistent across the three files (terminology, user labels, goals, success metrics).

## Repo Reality Check (required)
Before writing final docs:
1) Explore the repository to understand the current state (features that already exist, naming conventions, any existing docs).
2) Verify claims from `projectBrief.md` against what is actually present.
3) If repo evidence contradicts the brief, note it in a short section called **Repo Findings** (in `prd.md`) and propose a resolution:
   - “Update brief”
   - “Update implementation”
   - “Treat as assumption until clarified”

## Workflow Steps
### Step 1 — Read and Extract
- Read `projectBrief.md`.
- Extract:
  - target user(s)
  - problem statement
  - desired outcomes (success definition)
  - key use cases / user “movie” flow
  - inputs/outputs examples
  - constraints and sensitivities (privacy, mistakes, failure impact)
  - scope in/out
  - open questions and assumptions

### Step 2 — Create/Update `user_persona.md`
Write a clear, specific persona (or 2–3 if necessary), in lay terms.

**Must include:**
- Persona name (fictional) + short one-liner summary
- Context: who they are, where they work/live, what tools they use today (in plain language)
- Goals: what they’re trying to achieve
- Pains: what frustrates them today (ranked)
- Constraints: time, attention, environment, risks, sensitivity
- “Quotes” section: 3–6 realistic statements they would say
- “What success feels like” section (plain language)

### Step 3 — Create/Update `goal of this software.md`
This is a short, declarative “north star” document.

**Must include:**
- One-paragraph purpose statement (the why)
- Success definition (observable, measurable where possible)
- Non-goals (explicitly out of scope)
- Guardrails (what must not happen; e.g., “no confusing outcomes”, “no accidental sharing of private data”)
- Assumptions (only the ones required to proceed)
- Open questions (only the most important)

### Step 4 — Create/Update `prd.md`
This is the main declarative requirements document. It must incorporate the structure below AND the “Declarative Specification” sections.

#### PRD structure (required headings)
1) **Problem Statement**  
   - The problem from the user’s perspective (plain language)

2) **Context & Why Now**  
   - Why it matters; what evidence exists; what changes if solved

3) **Outcome (Success Definition)**  
   - Observable end-state(s)
   - “Done means…” checklist (non-technical)

4) **Users**  
   - Link/align with `user_persona.md`

5) **User Stories (extensive, numbered)**  
   - Format: “As a __, I want __, so that __.”
   - Cover the full experience: onboarding/first use, normal use, edge cases, mistakes, recovery, privacy, access, maintenance.
   - Include both “happy path” and “stress path” stories.

6) **Scope**  
   - In Scope (this iteration)
   - Out of Scope (explicit)
   - “Later / Maybe” (optional bucket)

7) **Functional Requirements + Acceptance Criteria**  
   - Each requirement must be testable in plain language.
   - Format:
     - **FR-1:** requirement statement  
       **Acceptance:** given/when/then in non-technical terms
   - Avoid prescribing implementation details.

8) **Non-Functional Requirements (quality constraints)**  
   - Performance (in “feels like” terms and measurable targets if available)
   - Reliability (what happens when things go wrong)
   - Privacy & Safety (what must be protected)
   - Cost/effort constraints (if specified)
   - Each stated as a verifiable condition.

9) **Edge Cases & Error Handling**  
   - List important edge conditions and expected behavior (no crashes, clear messages, safe fallback)
   - Include examples.

10) **Metrics & Guardrails**  
   - What to measure (success + failure signals)
   - Guardrails (thresholds or “if X happens, stop/rollback” in plain terms)

11) **Deep Modules (conceptual, non-technical)**  
   - Sketch major functional “chunks” using lay terms (e.g., “Intake & Validation”, “Decision/Rules Engine”, “Results Builder”, “History & Audit Trail”).
   - For each chunk:
     - what it is responsible for
     - what goes in / what comes out (in everyday terms)
     - why it should stay stable over time
   - Goal: identify chunks that can be tested in isolation, without mentioning internal tech.

12) **Implementation Decisions (only if already decided)**  
   - Record decisions already made (from repo or brief) without adding new ones.
   - If undecided, put it in Open Questions instead.

13) **Testing Decisions (plain language)**  
   - How we will prove it works:
     - demo script (step-by-step)
     - checklist for acceptance
     - example scenarios + expected results
   - Keep it non-technical.

14) **Repo Findings**  
   - What exists today, what doesn’t, mismatches, constraints discovered.

15) **Open Questions**  
   - Numbered list
   - Each question includes 2–5 options (A/B/C/Other) phrased in everyday terms.

16) **Further Notes**  
   - Anything important that doesn’t fit above.

## Output Requirements
- Write or update the three files in the repo root (or the docs folder if one exists and is clearly the standard place).
- Ensure internal consistency:
  - persona terms match PRD terms
  - success metrics match across docs
  - scope is aligned across docs
- Keep language accessible to a non-technical human.

## Final Check (before finishing)
- Can a non-technical person read `prd.md` and say “Yes, that’s exactly what I want”?
- Are scope boundaries crystal clear?
- Are all acceptance criteria testable without technical knowledge?
- Are unknowns captured as Open Questions with options?

Now execute this workflow.