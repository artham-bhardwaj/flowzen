# Implementation Log

This file records completed changes to Flowzen. Add a dated entry here whenever functionality, dependencies, or visible behavior changes.

## 2026-10-20 — Interview simulator: adaptive follow-ups, whiteboard review, timed mocks, changing requirements, playback, targeted practice

This upgrade extends the existing Interview section; it does not replace it. Everything still runs in the browser, with rule-based logic only: no AI service, API key, backend, authentication or new dependency. The UI never describes itself as an AI interviewer.

Reused pieces: the problem definitions, session drafts and immutable records, the deterministic evaluator, the canvas, static validation, the isolated lab-worker runs, component guides, LLD designs and lessons.

The **URL Shortener** is the fully upgraded interview (definition v2). The engine features work for all 12 problems; see Known limitations for what is URL Shortener only.

### 1. Adaptive follow-up engine (`src/interview/adaptive.ts`, `followups.ts`)

- **Triggers are data.** In addition to `always`, `hasKind`, `lacksKind` and `mentions`, a trigger can now be:
  - `omits`: a stage has answers but never mentions something;
  - `reached`: the user has reached a stage;
  - composites `all` / `any`;
  - branches `after` a submitted answer, optionally only when that answer scored **below** or **at least** a threshold, or **left out specific expected concepts** (`ifMissing`).
- **New shared questions (8):**
  - probes, when an answer leaves something out: "A hot key expires" (a cache-miss answer without stampede protection), "Detecting a repeat" (a duplicates answer without a dedupe key);
  - a deeper question after a solid answer: "Partitioning the data tier" (after ≥ 3/4 on 10× traffic);
  - omission probes: "Average or peak?" (estimates never mention peak) and "Protecting the write API" (no rate limiting in the API);
  - a read-replica chain: which reads go to replicas → replication lag → the primary fails (measurable outage).
- **Each follow-up carries:** trigger, question, competency, expected considerations, common mistakes, its assessment rule (shown after submission: "How the answer is assessed"), related resources, and its possible next questions with their conditions ("Where this can lead").
- **Branching waits for submission.** Typing does not change the questions; "Submit answer" does. Answers stay editable, and the current answer is what is evaluated.
- **No irrelevant or repeated questions:**
  - components that carry no traffic do not trigger questions;
  - one question per topic (for example, after "Database unavailable", "The primary fails" is held back);
  - a question is not asked when a single deep-dive answer already covers every point it would probe. Its branches still open, judged on that answer.
  - at most 5 opening questions, by priority.
  - Held-back questions are listed with the reason.
- **Recorded reasoning:** every asked question stores the reason and the rule that fired, in the session and the record.

### 2. Whiteboard review (`src/interview/whiteboard.ts`)

- **Built from:** the architecture, its static validation (which connections the simulator actually uses) and isolated runs of exactly that design.
- **Areas:** requirement coverage (requirement → role → component in the request path), request-flow connectivity, component suitability, the traced request path, bottlenecks, failure handling, scaling, consistency, and trade-off justification.
- **Every finding is labelled:**
  - **structural fact**: read from the diagram;
  - **measured**: from a run of this exact design (runs of earlier versions are never used);
  - **reasoned risk (unverified)**: not run, or not modelled.
- **No credit for presence:** a component outside the request path is a problem, not coverage.
- **Honest about the simulator:** a "What the simulator does not model" list is always shown (data values/staleness, failover and health checks, client retries, gradual slowdowns, other load-balancing strategies, cost).
- **Actions and links:** problems carry a suggested action and links to lessons, guides, LLD and experiments. In a running mock interview, actions and links stay hidden until the report.

### 3. Reasoning rubric (`src/interview/reasoning.ts`)

- **Structured explanations:** each major decision (a component that fills a role) has fields for problem, chosen approach (the existing decision note), alternatives considered, trade-offs, failure modes, and evidence or assumptions.
- **Six checks, one per field:**
  - written (problem and approach, ≥ 5 words);
  - an alternative named (any component or a documented alternative from the guide);
  - a cost stated;
  - failure behaviour stated;
  - evidence: a number within 25% of the user's own estimates or measured runs (**arithmetic**), or an explicitly stated assumption (recorded as **unverified**).
- **Scoring and review:** a new criterion, "Reasoning behind major decisions", is marked **Needs your review**: the rules check presence and grounding, not correctness. Long explanations that meet few checks are flagged uncertain. Suggestions come from the component guide and are labelled "suggestions, not requirements".

### 4. Timed mock interviews (`session.ts`, `workflow.ts`, `SessionView`, `shared.tsx`)

- **Durations:** 30, 45 or 60 minutes.
- **Stage plans:** every definition provides its own stage allocation. The plan is computed in whole minutes that add up exactly, shown before starting, and fixed into the session when it starts.
- **Side panel:** time spent per stage against the plan (with a progress bar), plus optional pacing warnings ("This stage has taken…", "Behind schedule…", "Time is up…"), which can be turned off.
- **Expiry:** when time runs out, the expiry is recorded once (time and stage). Nothing is locked; a banner offers "Finish and review" or "Keep working", and the report shows the overtime.
- **Recovery:** the timer commits every 5 s and when the page is hidden. Time runs only while the interview is open; a reload pauses it and shows "Resumed at …".
- **Modes:** practice stays untimed with hints; mock hides hints, references and suggested actions until the report.

### 5. Changing requirements and checkpoints

- **URL Shortener changes (5):**

  | Change | Kind | How it is checked |
  |---|---|---|
  | Five times the redirect traffic | traffic | measured: 5× load |
  | The link store goes down at peak | dependency failure | measured: 2 s store outage, ≥ 90% success target |
  | A 20 ms latency target | latency | measured: benchmark against the new target |
  | Links become editable | consistency | hypothetical |
  | Near-real-time click counts | backlog | hypothetical: a side path cannot be load-tested alongside redirects |

  Each defines the changed requirement, why it matters, expected considerations (its rubric), contradictions, mistakes, what the simulator can and cannot show, suitable alternatives and resources.
- **Changing requirements stage:** a new stage, shown only for problems that define changes.
  - Taking on a change saves the current design as the **original** checkpoint; the user revises the working design and saves the **revision**.
  - Both can be run under the change in isolation. Measurements are compared only when each run belongs to its checkpoint's exact architecture; otherwise the comparison says why it is not comparable.
  - Structural differences are always shown. Hypothetical changes are labelled as such.
- **Change scoring:** keyword considerations. A measured revision that still misses the changed targets is capped at 2. Hypothetical changes are marked for review.
- **Checkpoints:**
  - saved manually; automatically when leaving the design stage with a changed design; and for every change;
  - restoring one first saves the current design, so nothing is lost;
  - limit 40 (change checkpoints are always kept).

### 6. Playback and reference solutions

- **Playback view** (`PlaybackView.tsx`, opened from the report or history) shows:
  - time per stage against the plan;
  - a filterable timeline (stages, questions, checkpoints, changes, measurements, help);
  - requirements, assumptions, clarifications and estimates;
  - every checkpoint as a diagram, with its decision notes;
  - follow-ups in order, with why each was asked and its score;
  - requirement changes with their comparison;
  - every measured run and the benchmark settings recorded with it;
  - the findings, final score and competencies.
- **Load as a new draft:** any checkpoint (or the final design) can be loaded into a **new** editable draft. The record, other drafts, challenge attempts and Playground work are untouched.
- **Versioned reference solutions** (`references.ts`):
  - records store `referenceVersion`;
  - the URL Shortener reference is v2 and adds **why it works**, **low-level design considerations** and **when an alternative is the better choice**. v1 is kept in `referenceHistory`, so a record graded against it still shows it.
  - The report states which version it shows, and that designs are not graded by diagram matching.

### 7. Targeted practice (`src/interview/drills.ts`, `DrillView.tsx`)

- **14 drills, 2 per skill:** capacity estimation, API design, data modeling, component selection, bottleneck identification, failure analysis and trade-offs.
- **Grading by task type:**
  - numbers: arithmetic (±25% full credit, within 2× half);
  - choices: documented best/acceptable/wrong verdicts with reasons;
  - text: keyword considerations;
  - bottlenecks: **measured**. On submission the drill's design is simulated, and the answer is compared with the measured busiest component, not a stored answer.
- **Recommendations** come only from evidence: competencies averaging below 2.5/4 in completed interviews, or a latest drill under 70%. With no history, there are none.
- **Storage:** attempts are deep-frozen and stored under their own key, `flowzen-interview-practice-v1`. They never change interview records or statistics.

### 8. Data integrity (`store.ts`, `session.ts`)

- **Versions:** session v2, record v2, state v2. Evaluator (rubric) version 2 adds the reasoning and change criteria and stores the whiteboard review, decision assessments and change comparisons in the evaluation.
- **What a completed record holds:** the definition, rubric and reference versions; answers; all checkpoints; follow-up history with reasons; the session timeline; time per stage and the plan; the expiry; help used; every measured run; and the benchmark settings and requirement changes as defined at the time. All deep-frozen.
- **Migration:** version 1 drafts and records migrate in memory. New fields get empty defaults; answered follow-ups count as submitted. Stored evaluations are never recomputed.
- **Unreadable entries:** damaged entries, or entries written by a newer version, are kept verbatim in `unreadable` and saved back unchanged instead of being dropped. The dashboard lists them and offers deletion only on an explicit confirmation.
- **Bundle split:** session operations moved to `workflow.ts`, so they load with the Interview pages. The main chunk stays at 496 kB.

### Tests

- **New unit file:** `src/interview/upgrade.test.ts` (32 tests). It covers:
  - follow-up branching on missing concepts, scores and omissions;
  - submission gating;
  - the replica chain and topic de-duplication;
  - coverage only from a single deep-dive answer (scattered words do not count);
  - dead components and the opening-question cap;
  - whiteboard evidence labels, no credit for presence, no stale or absent measurements;
  - plans for every problem at 30/45/60 minutes;
  - expiry recorded once, pacing, and reload recovery with v1 migration;
  - change checkpoints, measured comparison and caps, hypothetical changes;
  - restore without loss and checkpoint limits;
  - frozen records, loading a historical checkpoint as a new draft, reference versioning;
  - unreadable and future entries kept verbatim;
  - evaluation transparency and grounded evidence;
  - drill grading (including measured bottlenecks), storage isolation and evidence-only recommendations.
- **Existing unit tests:** four updated for intended changes: branching now needs a submitted answer, asked questions carry reasons, mock budgets come from the problem's plan, and the URL Shortener is v2.
- **Browser suite `interview-smoke.mjs`:** extended from 43 to 72 checks. New checks cover:
  - nine stages;
  - whiteboard labels and the measured bottleneck;
  - a full six-part explanation grounded in the user's estimate;
  - a manual checkpoint;
  - the fired rule, typing vs submitting, and a probe question;
  - held-back questions;
  - a requirement change measured on the original and the revised design;
  - report sections, manual review and the reference version;
  - playback (timeline filter, checkpoint diagram, load as draft);
  - 30/45/60 plans and pacing;
  - expiry across a reload, with work kept and overtime reported;
  - a measured bottleneck drill stored separately;
  - report and playback fit 1,440 and 390 px.
- **Bugs these tests caught, fixed:**
  - the stage-plan rounding stopped early (28 of 30 minutes);
  - number parsing read "p95" as 95 and "ms" as millions;
  - "already covered" pooled words from unrelated notes;
  - the rubric table was 3,536 px wide.
  - On the report at 390 px, resource chips and action rows did not wrap, and hidden table labels widened the page. The chip and action-row overflow was present before this change; now fixed.

### Results (all run on 2026-10-20, after the last change)

- `npm run typecheck`: passed (exit 0); also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **359 passed, 0 failed** (18 files; was 327 in 17).
- `npm run build`: passed with no chunk-size warning. Main chunk 496.26 kB; the Interview page chunk is 205.34 kB.
- `npm run test:browser`: challenge 54/54, design 65/65, lab 29/29, learn 53/53, interview 72/72; no console errors.
- **Screenshots reviewed:** follow-ups with rules and a measured scenario, the expiry banner, playback, and a measured drill. Reviewing them, plus a layout probe, led to the rubric-width and 390 px fixes above.

### Known limitations

- **URL Shortener only:** requirement changes, requirement-to-component coverage and the extended v2 reference. The other 11 problems get the adaptive follow-ups, whiteboard review, reasoning rubric, checkpoints, own stage plans, playback and targeted practice. They have no changes stage and keep their v1 references.
- **Rules, not understanding:**
  - free-text checks recognise vocabulary, not understanding;
  - the reasoning rubric checks that each part is present and grounded, not that it is right;
  - such criteria are marked uncertain or for review, and can be corrected.
- **Timer:** it measures active time with the interview open, not wall-clock time. Closing the tab pauses it, and a reload can lose up to 5 s of timing (never answers).
- **Simulator limits:** staleness, failover, retries and analytics lag are not simulated; the related findings and changes are labelled as reasoned or hypothetical.

## 2026-10-20 — One catalog-style UI for every tab, and a shape for every component

Every tab now follows the layout pattern of Codecademy's catalog pages (for example its Python catalog). Flowzen keeps its own name, logo and colours; only the layout patterns are reused.

### Shared catalog system (`src/components/catalog/Shell.tsx`)

- **Building blocks:**
  - **hero band:** breadcrumb, large heading, intro, a "Tell me more" disclosure, a **Related topics** link list, and a progress or start card;
  - **filter sidebar:** search plus checkbox facets with counts and "Clear filters"; it collapses behind a Filters button on narrow screens;
  - **results bar:** count and sort;
  - **catalog card:** patterned art band, type label, status, title, description, check-mark metadata, tags and a full-width action;
  - **related resources** cards;
  - **site footer** with link columns. Every link navigates inside Flowzen; there are no placeholder links.
- **`DetailHero`** gives detail pages the same navy band and breadcrumbs.
- **Challenges** now renders through these components, with the same class names; its behaviour is unchanged.
- **Learn overview** is now a catalog: 100 lesson cards (10 written, 90 planned and not openable).
  - Facets: status, simulator support and module. Sort: curriculum order, in progress first, shortest first.
  - Below the grid: modules, knowledge checks, experiments, optional practice, related resources and the footer.
  - Lesson, module and component-guide pages keep the curriculum sidebar and open with the navy detail band.
- **Interview dashboard** is now a catalog: hero with a start card, a continue strip, and 12 problem cards. Facets: level, status, average time and category; sort includes "Best for this skill".
  - Preparation statistics, skill practice, related resources and the footer follow.
  - The problem detail, history and report pages use the detail band.

### Visual language for all tabs (design-system layer at the end of `styles.css`)

- **Tokens:** a navy ink, a single strong accent, and a yellow call to action. Light is a white page with navy text; dark is navy surfaces. Both themes are tuned separately.
- **Navigation:** the main navigation is bold text tabs with a heavy underline on the current section.
- **Controls:** square-cornered (4 px) buttons, inputs, chips, tabs and alerts. Primary buttons lift with a hard offset shadow; reduced-motion users get no movement.
- **Cards:** catalog cards have 1 px ink borders and a 6 px offset shadow on hover; content cards in lessons, experiments, quizzes, reports and the Lab share one border treatment.
- **Toolbar fit:** the editor toolbar was re-fitted for the bolder navigation. It now drops the wordmark, the range slider, button labels and the project-name field progressively, and fits 1,440, 1,280 and 1,024 px (now a browser check). The wordmark stays on catalog pages above 900 px.

### Component shapes (`src/components/shapes.tsx`)

- **Outlines:** each of the 25 components has a recognisable outline, generated in real pixel coordinates (no distortion) with its own content padding:

  | Component | Shape |
  |---|---|
  | Client | monitor on a stand |
  | DNS | address pill |
  | CDN | cloud |
  | Load balancer | splitter with forked outputs |
  | Reverse proxy | two-way arrow |
  | API gateway | archway |
  | WAF | shield |
  | Server | rack with drive bays |
  | Container service | corrugated shipping container |
  | Serverless | slanted function tab |
  | Worker | gear |
  | SQL database | cylinder |
  | Read replica | copied cylinder |
  | NoSQL | stacked documents |
  | Object storage | bucket |
  | Search engine | magnifier |
  | Cache | memory chip with pins |
  | Distributed cache | stacked chips |
  | Message queue | pipe of messages |
  | Event stream | log tape |
  | Dead-letter queue | archive box |
  | Rate limiter | funnel |
  | Circuit breaker | fuse |
  | Metrics collector | chart |
  | Log aggregator | scroll |

- **Where shapes appear:**
  - canvas nodes: the shape is drawn behind the content at the node's measured height;
  - library items, which also say "Drawn as …";
  - the inspector header, component guides and the guide index;
  - catalog card art, the lesson related-components list;
  - lesson and reference diagrams.
- **States restyle the outline:** selected, live load and failure, warning, dead (dashed) and visual-only (dotted).
- **Initial zoom:** the canvas's initial fit zoom stays capped at 1×.

### Tests (all run on 2026-10-20)

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **327 passed, 0 failed** (17 files).
- `npm run build`: passed, with no chunk-size warning (main chunk 496 kB).
- `npm run test:browser`:
  - challenge 54/54;
  - design 65/65 (new checks: every node has a shape outline; five kinds have five distinct outlines; 25 library glyphs; toolbar fits at 1,440, 1,280 and 1,024 px);
  - lab 29/29;
  - learn 53/53 (overview checks rewritten for the catalog: hero topics, three facets, 100 results, 100 card glyphs, 90 planned cards disabled, facet filtering; module pages keep the sidebar);
  - interview 43/43 (catalog selectors updated);
  - no console errors.
- I reviewed screenshots of the canvas with shapes, the Learn, Interview and Challenges catalogs, a lesson, and a report in the dark theme. This review led to four fixes: invisible active nav text, card glyph placement, toolbar overflow, and the 390 px catalog toolbar.
- **Correction to the learning-platform entry:** the curriculum has 90 planned lessons, not 88 (corrected there).

### Known limitations

- **Simplified outlines:** shapes are simplified outlines drawn behind rectangular content; text always sits in the shape's main body.
- **Editor layout:** the editor workspace keeps its own three-panel layout (a catalog layout does not fit a canvas). It shares the visual language, not the catalog structure.
- **Fonts and branding:** Geist is kept as the typeface; the reference site's proprietary fonts and branding are not used.

## 2026-10-20 — Interview preparation section

A new main section, **Interview**: Learn · Playground · **Interview** · Challenges. It is a structured system design interview workflow with a deterministic, rule-based evaluation. It runs entirely in the browser: there is no AI service, API key, backend or new dependency, and the UI never claims to be an AI interviewer.

The work reuses existing parts:
- the canvas, validation and simulation engine;
- the lab worker runner, for isolated runs;
- component guides, LLD designs and learning-track lessons;
- the attempt-record patterns (deep-frozen, versioned records; per-record validation on load).

The simulator, challenge grading and attempt history are unchanged.

### Interview definitions (`src/interview/`, structured data)

- **Schema** (`types.ts`). Each definition has: id and version; statement; difficulty; categories and topics; duration; expected functional and non-functional requirements (keyword concepts, critical flags); clarifying questions with hidden answers; estimation quantities; API operations with considerations; entity and modelling expectations; architecture roles; unnecessary-complexity rules; an isolated benchmark; deep dives; follow-ups; trade-off concepts; common mistakes; per-stage hints; a reference design (with diagram); related lessons and LLD designs; and optional criterion weights.
  - Estimation quantities are assumptions or derived values. Formulas are data, and documented tolerances apply.
  - Architecture roles list documented alternative kinds and the concepts a decision note should explain.
- **Library: 12 problems** at all four difficulties, covering all nine categories. Each has 6–10 requirements, 5–7 clarifications, 5–7 estimates, API and data expectations, 4–6 roles, 2–4 deep dives, 1–2 problem-specific follow-ups plus 4–13 shared ones, mistakes, hints and a reference design:

  | Difficulty | Problems |
  |---|---|
  | Beginner | URL Shortener, Product Catalog |
  | Intermediate | Rate Limiter, Notification Service, File Storage |
  | Advanced | Checkout, Chat, Search Autocomplete, Video Processing |
  | Expert | News Feed, Ride Booking, Distributed Job Scheduler |

- **Schema validation** (`validateDefinition`) checks unique ids and critical requirements. It also checks that formulas reference known quantities, every component kind exists, follow-up chains are complete, and every lesson, component, LLD, experiment and interview link resolves. All 12 problems pass. Validation caught two incomplete follow-up chains during authoring.
- **Shared follow-up bank** (`followups.ts`, 14 questions):
  - a caching chain: what is cached → misses → invalidation → cache unavailable;
  - an asynchronous chain: retries → duplicates → backlog → ordering;
  - load and failure questions: 10× traffic, database unavailable, slow dependency, single instance, new consistency requirement, "why no cache?".

### Session workflow and modes (`session.ts`, `SessionView`)

- **Eight stages:** requirements, capacity estimation, API, data model, high-level design, deep dives, trade-offs and failures, final review. The problem statement stays visible in a side panel; stages can be revisited.
- **Requirements:** curated clarifying questions reveal their answer only when asked.
- **Estimation:** reference assumptions and tolerances appear only after submitting.
- **API and data:** structured editors (method, path, payloads, errors, auth/idempotency/pagination flags; entities with keys, fields, indexes, access patterns, consistency).
- **High-level design:**
  - opens the real canvas in an interview workspace with its own undo history;
  - starts with only a client: no reference architecture is ever built for the user;
  - autosaves into the session draft (debounced, and on leaving);
  - keeps an interview brief beside the canvas (problem statement, timer, a decision note per component).
  - The inspector shows alternatives in inspect-only mode.
  - Practice runs use the problem's benchmark. An **isolated benchmark run** on its own worker records measured evidence without touching the canvas, practice playback or challenges.
- **Follow-ups:** chosen by explicit rules from the user's architecture and answers. Each shows why it is asked; chains branch once the parent is answered. Questions already asked stay in the record.
  - Follow-ups whose scenario the simulator can test (traffic multipliers, outages of the affected kinds) are marked **Testable** and can be run on the user's design. The rest are marked **Hypothetical**.
- **Practice mode:**
  - no countdown (time is still recorded);
  - hints revealed one at a time;
  - reference considerations once an answer exists;
  - learning links.
- **Mock mode:**
  - configurable duration (10–180 min) with a suggested allocation per stage;
  - a visible timer;
  - no hints, and references only after submission;
  - finish early at any time.
  - When time runs out, nothing is locked or lost; the report marks the overtime.
- **Help usage** (hints, references viewed) is recorded and shown in the report. It never changes the scoring rules.
- **Timing** accrues only while the session is open and visible. It is committed every 10 s, on stage change and on unmount; reloads lose at most a few seconds of timing and no answers. Drafts are saved on edit (debounced) and immediately on `pagehide`/`visibilitychange`. Discarding a draft or finishing asks for confirmation.

### Deterministic evaluation (`evaluate.ts`)

- **Scale and bases.** Criteria are scored 0–4 on the stated scale; overall and per-competency results are weighted averages of assessed criteria. Each criterion lists its evidence, labelled by basis:

  | Basis | Source |
  |---|---|
  | Structural | the architecture, validation and filled fields |
  | Measured | isolated simulation |
  | Arithmetic | estimates checked against tolerances and the user's own inputs |
  | Keyword | required concepts recognised in free text |

  Not-assessed criteria (for example a benchmark never run, or run on an earlier architecture) are excluded and labelled.
- **Requirements:** expected requirements found anywhere in the requirement answers. A missed critical requirement caps the score at 2. Scope also counts the important clarifying questions asked.
- **Estimation:**
  - assumptions are accepted within the documented factor;
  - derived values must follow from the user's own inputs (±30%) and be within 10× of the reference, so alternative assumptions are accepted when used consistently;
  - "3.3 million", "2k" and "1,200" are understood.
- **API and data model:** required operations are matched by method and path words, then their considerations are checked; entities are matched by name and key fields; modelling and consistency concerns are checked.
- **Architecture (no credit for presence):**
  - present but carrying no traffic: 1 point;
  - in the request path (measured, or functional in validation) but unexplained: 2;
  - partly explained: 3;
  - explained: 4.
  - Passive components (DLQ, telemetry) are judged structurally.
  - Further criteria: validation issues; unjustified unnecessary components (which lower trade-offs); the measured benchmark against targets.
- **Free text:**
  - concepts covered map to 0–4;
  - answers under 8 words are capped at 1;
  - explicit contradictions (for example "exactly-once delivery", "never stale", check-then-insert) cap the score at 1 and are explained;
  - long answers that match few concepts are flagged **uncertain**, stating that keyword rules may miss phrasing;
  - for traffic scenarios that were run, an answer that does not name the measured bottleneck gets negative measured evidence and a cap of 3.
- **Corrections:** users can correct a score or mark it uncertain, with a note. Corrections are stored separately, the automatic result stays visible, and a labelled "with your corrections" total is shown.

### Records, report and analytics

- **Storage:** `flowzen-interviews-v1` holds drafts, immutable records and corrections, separate from challenges, the lab and learning progress.
- **Records** are deep-frozen. Each holds the definition id and version, evaluator version, mode, all answers, the architecture snapshot, timing, hints, references, follow-ups asked, scenario evidence and the full evaluation.
  - Damaged or unknown-version entries are dropped individually and listed.
  - Reopening a record never touches drafts. "New session from this one" copies answers and architecture into a new draft (evidence, timing and help usage start fresh).
- **Report:**
  - overall score and competency bars, strongest and weakest areas;
  - missed requirements, estimation table, architecture findings;
  - a **decision-level comparison with the reference** (same choice, documented alternative, missing, present but unused);
  - trade-offs not discussed, failure scenarios overlooked;
  - time per stage (with mock budgets), help used;
  - recommendations per weak competency (lessons, component guides, LLD designs, a Playground experiment, a suggested next interview);
  - every criterion with its evidence and correction controls;
  - the reference design, labelled "one reasonable design, not the only correct answer".
- **Dashboard:**
  - start practice or mock;
  - continue unfinished sessions;
  - library (search, difficulty and category filters), history (best results and all records);
  - practise a skill (competency → ordered problems and resources);
  - statistics: completed, average, competency averages and trends, recent, recurring mistakes (the same miss in two or more interviews), topics practised, needs improvement.

  With no history it shows an explicit empty state and no numbers.
- **Integration:** the Learn dashboard links to Interview preparation. Interview resources open lessons, component guides, LLD designs, Playground experiments and other interviews, and every draft is kept.
- **Bundle size:** the problem library and evaluator load with the lazy Interview page (98 kB). The main chunk stays at 489 kB, with no chunk-size warning.
- **Canvas default zoom:** the canvas's initial fit is now capped at 1× (manual zoom still reaches 2×). A one-node interview canvas previously opened at 2×. This also affects sparse challenge starters.

### Tests (all run on 2026-10-20)

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **327 passed, 0 failed** (17 files). New `src/interview/interview.test.ts` (42 tests):
  - **Definitions:** schema validation and invalid-definition detection.
  - **Sessions:** creation in both modes; stage transitions and completion; hint and reference gating; timer accrual, overtime without locking; new session from a record (deep copy, fresh evidence).
  - **Follow-up branching:** by architecture (cache vs no cache), by answers (chains with depth), by requirements text; asked questions retained; scenario applicability and inputs.
  - **Evaluation:** text scoring, contradictions, brevity, uncertainty; estimate tolerances, including a valid alternative assumption, inconsistent arithmetic and order-of-magnitude misses; a strong session ≥ 85% with evidence on every criterion.
  - **Alternatives:** three alternative URL-shortener architectures accepted.
  - **No credit for presence:** dangling cache = 1; no notes ≤ 2. Without read offloading the benchmark fails; stale evidence is not used; empty sessions score near zero; evaluation is deterministic; unjustified unnecessary components are penalised.
  - **Corrections:** stored separately.
  - **Immutability and isolation:** frozen records; storage keys separate from challenges; per-record dropping of damaged data.
  - **Analytics:** empty state; averages, trends and recurring mistakes; valid recommendations.
  - **Every problem:** each of 22 tuned reference solutions (at least one per problem, never loaded into a user's canvas) meets its benchmark and scores ≥ 85% with roles 4/4, and an empty session scores < 15%.
  - **Benchmarks discriminate:** six naive designs (no cache, no limiter, limiter below capacity, search-engine-only autocomplete, under-partitioned stream, under-provisioned checkout) fail.
- `npm run build`: passed, with no chunk-size warning.
- `npm run test:browser`, headless Chrome on Linux:
  - challenge 54/54;
  - design 59/59;
  - lab 29/29;
  - learn 50/50 (navigation check updated);
  - **interview 43/43** (new);
  - no console errors.

  The interview suite covers the full workflow: open Interview → empty state → library search and filters → practice session → requirements and clarifications → hint → estimates and reference → API and entity editors → canvas design with components added and connected (5 nodes, 4 edges), configuration and decision notes → isolated benchmark (measured pass) → deep dives and references → adaptive follow-ups (caching branch, chained question) → a testable 10× scenario → reload and continue → final review → report (rule-based disclaimer, evidence bases, reference comparison, help used) → correction stored separately with the record unchanged → dashboard statistics → history reopen → new session from the record → discard → mock interview (timer, no hints, references hidden, time saved per stage, finish early) → learning link → theme → 820 and 390 px.

  Challenge storage is checked byte-identical throughout.
- I reviewed screenshots of the library, requirements stage, canvas, follow-ups with measured scenario evidence, the report and the dark dashboard. This review led to two fixes: the initial canvas zoom, and checking scenario answers against the measured bottleneck.

### Known limitations

- **Keyword checks recognise vocabulary, not reasoning.** A correct answer phrased differently can score low (it is flagged uncertain when long), and a vocabulary-heavy but shallow answer can score well. Corrections exist for this; scores are guidance, not a verdict.
- **The simulator forwards requests along a server's first connection only.** Designs with separate read and write paths are modelled with one client per path, and benchmark traffic is split evenly across clients (stated in each benchmark).
- **Benchmarks are scaled-down, constant-rate workloads** with forced per-component costs. They measure capacity and bottlenecks, not production availability. Latency-increase and partial-failure scenarios are hypothetical (only traffic multipliers and outages are simulated).
- **API and data-model checks** match words in paths, names and fields; there is no OpenAPI or ER validation, and the data model has no graphical editor.
- **Timing** counts only while the session page is open and visible.
- **The interview canvas** offers alternatives for inspection only ("Try alternative" stays in the Lab).
- **Storage:** history is local (no sync) and capped at 100 records.
- **Browser coverage:** browser tests need a local Chrome or Chromium; Firefox, Safari and screen readers were not tested.

## 2026-10-20 — Learning platform: Learn, Playground and Challenges

Flowzen is now organised around three experiences: **Learn** (a structured System Design track and the new entry point), **Playground** (the Scaling Laboratory plus the free design canvas, with guided experiments and alternatives) and **Challenges** (unchanged, now optional practice linked to lessons). The intended loop is: read a concept → compare alternatives → see it in a design → run a controlled experiment → pass a knowledge check → complete a practical exercise → optionally attempt a challenge.

The simulator, grading engine, attempt history and LLD models are unchanged. Two small, backward-compatible extensions: the lab runner accepts per-input labels, and the LLD explorer has a `standalone` mode for use outside the canvas.

### Content model (`src/learn/`, structured data, no JSX)

- **Types** (`types.ts`): modules; written lessons and **planned** lessons (shown as planned, never as content); content blocks (paragraph, list, table, diagram, callout, formula, example); knowledge-check questions tagged by skill (why, when, trade-off, failure, estimate, concept); exercise tasks.
- **Every written lesson uses the standard format:**
  - A. Concept: definition, problem, why it occurs, how it works, an optional "Go deeper", terminology, a real-world example, diagrams, advantages and limitations.
  - B. Why and when: justification, useful when, unnecessary when, can make things worse, complexity, failure modes, evidence.
  - C. Alternatives: a comparison table and "when each fits". No option is labelled universally best.
  - D. Design example: diagram, upstream, downstream, flow, configuration, bottlenecks, failure.
  - E. Experiment, or an explicit reason there is none.
  - F. Knowledge check.
  - G. Practical exercise.
  - Each lesson also states its simulator support (simulated, partly simulated, theory only) with a note, plus related components, LLD designs and challenges.
- **Curriculum** (`curriculum.ts`): all 10 modules.
  - **Module 1 is complete** (9 lessons): approach, functional and non-functional requirements, latency/throughput/availability/reliability/scalability, capacity estimation, workload and bottlenecks, SLIs/SLOs/SLAs, horizontal vs vertical scaling, stateful vs stateless services, synchronous vs asynchronous communication.
  - **Module 4's first lesson** (Why caching exists) is also written, because it is the flagship experiment.
  - The other **90 lessons are listed as planned**, each with its expected simulator support.
- **Component knowledge** (`components.ts`): one decision guide per catalog component (all 25). Each covers why, problem, use when, avoid when, alternatives (with trade-offs), pros and cons, dependencies, failure modes, operations, metrics, concepts, and the simulator's models and limitations.
  - Identity, inputs and outputs, configuration and simulated behavior still come only from `app/catalog.ts`, so no description is duplicated.
  - `componentKnowledge(kind)` joins catalog, guide, LLD coverage and lessons. It powers the library, inspector, lessons and guide pages.
- **Experiments** (`experiments.ts`): 8 controlled templates, only for effects the engine simulates:
  - latency and throughput under load;
  - finding the bottleneck (servers vs database);
  - one big server vs four smaller ones (with an outage);
  - synchronous vs queue and worker;
  - worker count;
  - direct database vs single cache vs distributed cache;
  - rate limiting on and off;
  - circuit breaker on and off.

  Each template states its question, hypothesis, controlled variables, the one variable and its metrics. All variants share benchmark and seed; only declared workload variables differ. Conclusions are computed from measurements and kept separate from the **theory** (explanation, not measured) and the **limitations** (what the simulator does not model). Five experiments that cannot be simulated are listed with the reason instead of a fabricated result: load-balancing strategies, retries and backoff, stampedes and TTL, replication lag, bursty traffic.
- **Evaluation** (`evaluate.ts`, pure):
  - quizzes: exact-set grading, 70% to pass;
  - numeric answers: tolerance, with separators and units accepted;
  - classification tasks;
  - build tasks: the user's design runs under the exercise's own workload, with forced settings (for example per-request work), so lowering the work cannot pass. An incomplete run passes nothing.
- **Progress** (`progress.ts`): local storage key `flowzen-learn-v1`, separate from challenges and the lab.
  - A lesson is **read** once all four reading sections are opened. Quiz attempts and the best result are kept. Tasks are recorded on pass. The 5 newest records of each experiment are kept, frozen.
  - Completion = read + check passed + experiment run (if any) + exercise (if any). **A challenge is never required.**
  - Damaged records are dropped individually and reported.
  - Derived views: next lesson, module and track progress, challenge recommendations (ready after the linked lessons), and lessons for a failed criterion.

### UI

- **Navigation:** main navigation is Learn · Playground · Challenges, and the app opens on Learn. Playground has a Lab / Canvas mode switch and returns to the mode used last.
- **Learn page** (lazy-loaded):
  - a curriculum sidebar with statuses (planned lessons are not links);
  - a dashboard: track progress, recommended next lesson, module cards, knowledge-check results, experiments, optional practice and reference cards;
  - module pages;
  - lesson pages: a section stepper, completion checklist and pager, plus a related panel with components ("why" for each), LLD links and challenges;
  - a component guide index and pages, with an embedded **LLD explorer** (illustrative Java, not executed).
  - Diagrams are inline SVG on theme tokens, with title and description. The page is responsive (sidebar behind a button below 900 px).
- **Experiments run inline in lessons** on a lab worker (cancellable). The same `ExperimentPanel` is used in the Playground, which can also load any variant into the canvas (with confirmation; the lab benchmark is set to the variant's workload) and run "your design" as an extra, explicitly uncontrolled column.
- **Build exercises:** "Build it in the Playground" loads the starter as one undoable edit (with confirmation when a lab draft exists) and shows the task in a new **Guided** tab. "Check my design" runs the exercise workload without touching the lab benchmark, baseline, variants or challenges.
- **Why use this?:** the library detail and the inspector show the guide's one-line purpose and alternatives, with links to full guides.
  - **Try alternative** (Playground only) first saves the current design as a uniquely named variant, then swaps the component (same id, position and connections) as one undoable edit. If saving fails, nothing changes; given systems are never swapped.
- **Challenges:** the brief lists "Concepts tested" with lesson status. Failed criteria in results link to lessons. The catalog links to Learn. Opening a lesson keeps the challenge draft and attempts.
- **Smaller changes:**
  - The lab's old "Learn" tab is now "Hypotheses".
  - The library detail has a fixed height, so hovering never shifts the list under the pointer. A browser test caught this.
  - At ≤ 1100 px the toolbar hides dividers and the project name and compacts buttons (Resume and Reset labels stay available to screen readers), so it fits the 1,024 px minimum without overlap.

### Tests (run on 2026-10-20)

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **285 passed, 0 failed** (16 files). New `src/learn/learn.test.ts` (42 tests):
  - curriculum structure, unique ids, complete sections, valid diagrams and quiz keys;
  - quiz, numeric and classification grading;
  - every build task: the solution passes and the starter fails under real simulation, and overrides cannot be bypassed;
  - every experiment: shared seed and controls, a deterministic "supports" conclusion, "inconclusive" with missing or incomplete runs, compact frozen records;
  - component knowledge: consistent with catalog, LLD coverage, curriculum and challenges;
  - alternatives: swaps are pure, keep id and edges, refuse unlisted kinds and given systems;
  - progress: reading, requirements (never a challenge), best-of quiz, experiment history cap, persistence and per-record dropping, next lesson, challenge recommendations, criterion → lesson links.
- `npm run build`: passed, with no chunk-size warning. LearnPage 38.6 kB and ExperimentPanel 11.2 kB are lazy chunks; the main chunk is 474 kB (lesson data is needed in the main chunk for challenge links).
- `npm run test:browser`, headless Chrome on Linux, now four suites:
  - challenge 54/54;
  - design 59/59 (one new check: the app opens on Learn);
  - lab 29/29;
  - **learn 50/50** (new);
  - no console errors in any suite.

  The learn suite covers:
  - entry point and navigation; the curriculum and planned modules;
  - section rendering and reading progress;
  - an inline experiment with identical seeds and measured vs theory sections;
  - failing and passing knowledge checks; numeric tasks;
  - lesson → component guide → LLD;
  - a build exercise failing and then passing in the Playground, recorded in progress;
  - "Open in the Playground" and loading a variant with confirmation;
  - "Try alternative" saving the original as a variant, swapping, and Undo leaving the variant unchanged;
  - library "why" and links;
  - challenge "Concepts tested", failed criteria linking to lessons, with challenge draft and attempts preserved and learn progress unchanged;
  - persistence across reload; the other theme; 820 and 390 px.
- Existing suites were updated only for the new navigation (shared `navigate` helper) and the renamed "Hypotheses" tab.
- I reviewed screenshots of the dashboard, a lesson, the experiment result, the knowledge check, a component guide with LLD, the build check, "Why use this?" with alternatives, the dark theme, 390 px and 1,024 px. This review led to three fixes: neutral body text in conclusions, a standalone LLD mode without the misleading "Nothing sends to this component", and the toolbar overflow at 1,024 px.

### Known limitations

- **Written content:** only Module 1 and one Module 4 lesson are written. The other 90 lessons are planned entries with simulator-support labels.
- **Arrivals are perfectly regular.** Latency stays flat until capacity and then jumps. Lessons explain the gradual queueing curve of random arrivals as theory and label it as not simulated.
- **Experiments are prepared templates.** Users can load and modify variants and compare them in the lab (baseline vs variant), but cannot author new controlled templates.
- **"Local in-process cache"** has no component. The single cache node is the stated approximation.
- **Theory-only lessons** (stateful vs stateless, requirements, SLOs) have no experiment, and say why.
- **Try alternative** offers only alternatives that are catalog components with compatible connections. Others are explanation only. It is available in the Playground's Lab, not on the free canvas or in challenges.
- **Exercise focus:** an active exercise stays shown in the Guided tab until another lesson replaces it. There is no explicit "close exercise" action.
- **Storage:** learning progress is local only (no account sync). The 5 newest runs of each experiment are kept.
- **Browser coverage:** browser tests need a local Chrome or Chromium; Firefox, Safari and screen readers were not tested.

## 2026-10-20 — Challenge catalog redesign, four new challenges, detachable connections

### Bug fix: connections could not be detached easily

- **Cause.** The canvas never enabled React Flow's edge reconnection. Removing a connection meant selecting the arrow and pressing Delete, or using the inspector's trash button. There was no way to drag an arrow off a component.
- **The fix lets you:**
  - **drag either end of an arrow** off its component into empty space to detach it;
  - **drag either end onto another component's handle** to move the connection there;
  - drop an end back where it was, which changes nothing;
  - click the **× button** that a selected arrow now shows at its midpoint, which removes it.
  Each of these is one named, undoable edit ("Disconnect A → B", "Move connection A → B to A → C"). The logic is a pure, tested module (`src/app/edges.ts`).
- **Three further problems found while verifying in a real browser,** all fixed:
  - **A click deleted arrows.** On short arrows, the drag anchors at the ends cover most of the arrow, so a plain click registered as a reconnect that ended nowhere, and the arrow was deleted. Detaching now requires real pointer travel (more than 8 px), and the anchor radius went from 14 to 10 px.
  - **Short arrows could not be selected** for the same reason. A click on an end anchor now selects the arrow.
  - **The × button could not be clicked.** Selected arrows are raised above nodes (`elevateEdgesOnSelect`, so their end anchors can be grabbed), and that layer covered the button. The edge label layer now sits above it, and the particle-measuring path no longer receives pointer events.
- **Connection rules are one function** (`isAllowedConnection`): no self-loops and no duplicates. The arrow being dragged is not counted as a duplicate of itself.

### Four new challenges (10 in total)

Each is declarative, uses existing simulator metrics only, and has deterministic benchmarks, given systems, hints, learning objectives and related LLD designs. Reference designs pass, starters fail, and plausible wrong designs fail for the right reason (tested).

| # | Challenge | Level | Concept | Key criteria | Valid designs (tested) |
|---|---|---|---|---|---|
| 7 | Go Global | Easy | Edge caching / CDN | 600 req/s against a 200 req/s origin; p95 ≤ 80 ms; ≤ 25% of requests reach the origin | CDN in front; Cache in front |
| 8 | Read-Heavy Catalog | Medium | Read replicas | 1,000 req/s, primary 500 qps with 80% reads; primary utilization ≤ 70% | one larger replica; two default replicas |
| 9 | Fan-Out Notifications | Hard | Event streams | 400 events/s must be processed by both the Email Service and Analytics; accept p95 ≤ 30 ms | Event Stream fanning out to both |
| 10 | Black Friday Storefront | Expert | Capacity planning | 2,500 req/s; DB utilization ≤ 70%; ≤ 48 compute slots; p95 ≤ 60 ms | LB + two servers + Cache with enough slots; same with a Distributed Cache |

- **Rejected for the right reason:**
  - **Fan-out:** a Message Queue fails the Analytics criterion (a queue hands each message to one worker).
  - **Catalog:** a 30%-hit cache alone fails primary utilization.
  - **Go Global:** scaling out origin servers fails the origin-load criterion.
  - **Black Friday:** a single-slot cache becomes the measured main bottleneck.
- **Event budgets per workload.** Workloads can now declare `maxEvents`, an event budget for high-traffic benchmarks. Black Friday's 25,000 requests through five hops exceeded the engine's default of 100,000 events, and the grader correctly refused to grade the incomplete run. Black Friday now declares 1,000,000. Other challenges are unchanged, and the budget is stored in attempt records, so reproductions use it.

### Challenge catalog redesign (inspired by Codecademy's catalog page)

The layout follows the patterns of the reference catalog. It uses Flowzen's own name, mark and palette, not the reference site's branding.

- **Hero band:** breadcrumb (Flowzen / Challenges), a large heading, an intro, and a "Tell me more" disclosure explaining grading, practice vs submission, and unlocking. A progress card shows solved count, points, a progress bar and **Next up** (the challenge in progress, or the first unlocked unsolved one) with a call-to-action button.
- **Filter sidebar:**
  - search;
  - checkbox facets for Level (Beginner friendly / Intermediate / Advanced / Expert), Status, Average time to complete (under 15, 15–25, over 25 minutes) and Topic;
  - result counts per option, computed with the other active filters applied;
  - "Clear filters".
- **Results bar:** result count and Sort by (Recommended: in progress first, then open, solved, locked; Shortest first; Easiest first; Most points).
- **Card grid:** each card has a patterned header in its level's color with the main concept's component icon and number, a "CHALLENGE" type label and status pill, title, summary, checkmark metadata (level, about N minutes, graded on N measured criteria, points), topic tags, best attempt or unlock rule, and a full-width action (Start challenge, Continue, Practice again, Locked). Cards lift with a hard offset shadow on hover, which is disabled under reduced motion.
- **Related resources:** cards linking to the Scaling Laboratory and the design canvas.
- **Responsive.** The catalog is responsive (the editor keeps its 1,024 px minimum). Below 900 px the layout becomes one column, and the filters move behind a "Filters" button. Light and dark themes have their own hero tokens.
- **Testable logic.** Filtering, facet counts, sorting and "next up" are a pure, tested module (`src/challenges/catalog.ts`).

### Tests (run on 2026-10-20)

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **243 passed, 0 failed** (15 files). New tests:
  - `edges.test.ts` (5): detach, move, unchanged drops, validation that ignores the dragged edge, undo as one step;
  - `catalog.test.ts` (4): at least 10 challenges across all levels with unique ids and numbers; search and facets (OR within a facet, AND across facets); facet counts against other filters; recommended order, next up, shortest and points sort;
  - grading (4 more): the wrong-design cases above.
  The existing per-challenge tests (starter fails, references pass, exact threshold boundaries, determinism) now also cover the four new challenges. The unlock test derives its expectation from the definitions instead of hard-coding two Easy challenges.
- `npm run build`: passed, with no chunk-size warning.
- `npm run test:browser`, headless Chrome on Linux:
  - **challenge-smoke: 54/54 passed** (catalog checks rewritten for the new layout, plus responsive checks at 820 and 390 px);
  - **design-smoke: 58/58 passed** (6 new connection checks: clicking a short arrow keeps and selects it; the × button removes it; dragging an end into empty space detaches it; dragging onto another component moves it; each is undone in one step);
  - **lab-smoke: 29/29 passed**;
  - no console errors in any suite.
- I reviewed screenshots of the catalog in light and dark themes, on hover, and at 820 and 390 px.

### Known limitations

- **Card art** is generated from each challenge's main component icon and level color; there are no bespoke illustrations.
- **The editor workspace keeps its existing styling and 1,024 px minimum width.** Only the catalog adopts the new design.
- **Dropping an arrow's end on an invalid handle** (a duplicate connection or the same component) detaches it, because this React Flow version does not report where a reconnect ended. This is undoable.
- **New challenges, like the existing ones, use constant-rate traffic.**

## 2026-10-20 — Scaling Laboratory

A third workspace, **Lab** in the toolbar, next to Design and Challenges. Users set a baseline, change an experiment on the existing canvas, run deterministic experiments and traffic sweeps, and compare results against the baseline. It reuses the canvas, catalog, validation, simulation engine, worker, edit history, snapshot format and comparison rules from earlier work. Challenge grading is unchanged.

### Workspace and isolation

- **The lab canvas is the editable experiment.**
  - It has its own undo history (workspace `lab`), separate from the design canvas and from every challenge.
  - It is autosaved as the lab draft, and saved immediately when leaving the lab.
  - Entering the lab restores that draft, or copies the design canvas on first use.
- **Starting points** (Setup tab): the sample architecture, the design canvas, or any saved challenge draft. Each is loaded as a copy, so the original is never changed. Replacing a non-empty canvas asks first, and Undo restores the previous canvas.
- **What stays separate.** Each of these lives in its own storage and is never written by the others:
  - **Baseline:** an immutable run record.
  - **Experiment:** the canvas, plus the latest run record.
  - **Practice simulation:** the toolbar Run, using the lab benchmark, with playback only.
  - **Challenge submissions.**
  Lab data is in `localStorage` under `flowzen-lab-v1`; challenge progress stays in `flowzen-challenges-v1`. The browser suite checks that challenge storage is byte-identical after a whole lab session, and that lab edits never reach the design canvas.

### Records (`src/lab/lab.ts`, `src/lab/measure.ts`, `src/lab/store.ts`)

- **Run records.** A **lab run** stores:
  - the architecture snapshot (the same versioned format as challenge attempts);
  - the benchmark: traffic, traffic window, drain window, seed and injected failures;
  - the simulator revision and the exact engine input;
  - the measurements and the performance targets with their results.
  Records are deep-frozen. Replacing the baseline swaps the record out (with confirmation); nothing edits a record in place.
- **Measurements** are read from engine output and traces only:
  - offered vs completed requests, successful throughput, the share of offered requests that succeeded, error rate, and p50/p95/p99 (successful requests only);
  - failures by component and cause;
  - per-component busy fraction, capacity, peak queue, average wait, completed, rejected, and requests processed;
  - mean wait and processing time per successful request at each component, from spans;
  - cache lookups and hits; background jobs (completed, failed, pending, dead-lettered); compute slots;
  - the grader's findings, labelled heuristic.
- **Busy during the traffic window.** The engine reports utilization over the whole run, including the drain window. With 10 s of traffic and 2 s of drain, a fully saturated component would show only about 83%. The lab therefore also computes **busy during the traffic window** from the processing spans in the traces. A test checks it equals the span sum exactly, and the engine's whole-run figure is kept as `runUtilization`. Rankings and saturation thresholds use the traffic-window figure.
- **Performance targets** (configurable): p95 ≤ X ms, error rate ≤ Y%, ≥ Z% of offered requests succeed. A value that cannot be measured is "not measurable" and never counts as met.
- **Variants:** a named copy of the architecture and benchmark, plus the latest experiment run only if it was made for exactly that design and benchmark.
  - At most 20 variants. Names are unique, and an existing variant is never overwritten.
  - A variant can be loaded as a new editable draft (with confirmation), compared with the baseline, or deleted (with confirmation).
- **Loading saved data** (`loadLab`) validates each record separately. An unknown version or damaged record is dropped and listed in a warning in the lab panel; the rest still load, and nothing is substituted. If saving fails (quota), a warning is shown.

### Controlled experiments

- **Settings.** Only settings the engine models are offered, per component: instances, tasks, concurrency, connections, hit ratio, read share (only when replicas are connected), queue limit, deliveries, redelivery delay, partitions, worker slots and rate, rate-limit rate and burst, and breaker thresholds. Each edit is an ordinary undoable canvas edit.
- **Structural edits** (`src/lab/edits.ts`, pure and tested):
  - **Add replica:** copies a compute node behind the same load balancer or reverse proxy, with the same downstream connections. It is only offered when a router would actually spread traffic to the copy.
  - **Insert cache in front:** puts one Cache between every non-cache caller and a store.
- **Traffic and failures** are benchmark settings:
  - the request rate (1–5,000 req/s), traffic window (1–30 s), drain (0–10 s) and seed;
  - injected failures, which are the engine's scheduled outages of a component (its only failure model).
- **Comparability.** The Experiment tab says whether the current benchmark matches the baseline's, and offers "Use the baseline's benchmark".

### Traffic sweeps

- **Bounds:**
  - 2–8 levels per sweep, each 1–5,000 req/s;
  - at most 400,000 offered requests per sweep (checked before anything runs);
  - an engine limit of 1,500,000 events per level.
  Measured: a 100,000-request level takes about 1.3 s in Node.
- **Running:**
  - Levels run one at a time on a dedicated worker (`useLabRunner`). The worker returns measurements only, so large traces never cross threads.
  - **Cancel terminates the worker immediately.** Levels that did not run are stored as `cancelled` with no measurements. Engine errors are stored as `failed`.
  - A level that hits the event limit is stored as `incomplete`: its targets are "not measurable", and it is excluded from every conclusion and from the charts.
  - If no worker can be created, levels run on the main thread, cancellable between levels.
- **Results** for each completely simulated level:
  - offered and successful throughput, success share, p50/p95/p99, error rate;
  - the busiest component, the peak queue and its wait;
  - whether targets were met.
- **Charts:**
  - two charts on the offered-traffic axis (never a dual axis): latency percentiles with the p95 target line, and successful throughput with the y = x "every request succeeds" line;
  - only simulated levels are plotted, as dots, and the caption says that nothing between them was simulated;
  - a table lists every level, including cancelled or incomplete ones.
  The chart colors are the validated categorical slots 1–3 (checked with the data-viz palette validator in both themes: all checks pass in dark; in light, aqua is below 3:1 on the surface, so direct line-end labels and the table provide relief).
- **Breaking point.**
  - **Measured:** the last level that met every target and the first simulated level that missed one, with the measured values.
  - **Heuristic**, shown only when no simulated level failed and labelled "Heuristic estimate, not simulated": the busiest component's traffic-window utilization at the highest level, extrapolated linearly to full utilization.
  - **First to reach 85% busy**, per component, from simulated levels.
- **Success share.** The table notes that p95 covers successful requests only. It can fall at very high traffic when most requests are rejected, as in the sample sweep at 1,200 req/s, so it should be read with the success share.

### Baseline vs experiment (`compareRuns`, `explainComparison`)

- **Shared rules.** Comparisons reuse the attempt-comparison helpers (`diffSnapshots` and `simulationInputChanges`, extracted from `attempts.ts` without behavior change).
- **Benchmark differences** (traffic, windows, seed, injected failures, simulator revision) mark a comparison **not directly comparable**. Values are still shown side by side but are not presented as equivalent, and no change is credited.
- **The comparison shows:**
  - metric deltas classified as improved, regressed or unchanged;
  - target status before and after;
  - per-component busy share, peak queue and wait;
  - lists of improvements, regressions, new failure modes and failure modes no longer seen;
  - simulation-relevant architecture changes;
  - the busiest component before and after.
- **Attribution** follows the same rule as attempts: causal wording only when the benchmark is identical and exactly one simulation input changed. When nothing changed it says "had no measurable effect", not "the difference follows". With several changes, explanations are marked **Heuristic** and say they cannot attribute the result.
- **Near-ties.** A "shift" between two components that were within 2 points in the baseline is described as an existing co-bottleneck, not a new one. Screenshot review caught this with the sample's two equally loaded servers.
- **Explanations cite measurements:**
  - the components closest to capacity;
  - where a successful request spends its time;
  - queue build-up;
  - cache hits and how many requests reach the store behind the cache;
  - background jobs;
  - compute slots vs throughput (do replicas help);
  - database load before and after;
  - bottleneck shifts.
  Each is labelled Measured or Heuristic.

### Learning mode (`src/lab/lessons.ts`)

- **Five lessons**, each with a hypothesis, the steps of the experiment, what to look for, and a conclusion computed from the user's own baseline, selected run and sweep:
  1. Servers vs a database bottleneck.
  2. How caching changes database traffic and latency.
  3. How queues absorb load until the backlog outgrows the workers.
  4. Why more traffic degrades performance.
  5. How removing one bottleneck exposes the next.
- **Outcomes:**
  - "needs data" (it says what is missing);
  - "inconclusive" (for example, different benchmarks, an incomplete run, or no backlog formed);
  - "supports" or "does not support", with evidence and a caveat when several inputs changed.
- **Any design works.** Lessons accept any design that exercises the concept; tests cover both Cache and Distributed Cache for lesson 2.
- **Limitation of lesson 3.** The engine's traffic is constant-rate, so a "burst" is modelled as traffic above worker capacity for the traffic window, followed by the drain window.

### Engine and worker

- No engine changes. Determinism and grading semantics are unchanged; all challenge, attempt, LLD and undo tests still pass.
- The worker gains a `lab` request kind that returns measurements only. The existing request and response protocol is unchanged. The worker bundle grew from 18.5 to 25.9 kB.

### Tests (all run on 2026-10-20)

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **230 passed, 0 failed** (13 files). The new `src/lab/lab.test.ts` has 24 tests:
  - **Measurements:** equal to engine output; traffic-window busy share equal to the span sum; time breakdown sums to mean latency; benchmark validation; failure injection through outages.
  - **Sweeps:**
    - bounds are rejected before running; levels are sorted and de-duplicated;
    - runs are deterministic, with exactly the planned levels;
    - cancellation leaves levels unrun and never interpolates them, and the chart series contains only simulated levels;
    - event-limit runs are incomplete and excluded;
    - the measured breaking point is distinct from the heuristic estimate, whose value equals rps ÷ utilization;
    - sweep records are frozen.
  - **Comparisons:**
    - identical benchmarks with single-change attribution;
    - warnings for traffic, seed, simulator-revision and failure differences;
    - new failure modes and bottleneck shifts;
    - explanations cite the exact measured numbers;
    - several changes are marked heuristic; incomplete runs draw no conclusions;
    - "no measurable effect" wording; the near-tie shift.
  - **Persistence:** baseline isolation across draft, experiment, sweep and variant changes (frozen); variant persistence, duplicate and limit rejection; per-record dropping of damaged or unsupported data.
  - **Lessons:** all need data when empty; inconclusive with mismatched benchmarks; each lesson supported by at least one design (two cache kinds for lesson 2); honest non-support (compute-bound design, no backlog).
  - **Structural edits:** replica wiring and its precondition; cache insertion and its precondition.
- `npm run build`: passed, with no chunk-size warning. New chunks: LabPanel 39 kB and ScalingChart 4.8 kB. Recharts is now one shared `LineChart` chunk used by the metrics panel and the lab.
- `npm run test:browser`, headless Chrome on Linux (`/usr/bin/google-chrome`), now three suites:
  - **challenge-smoke: 46/46 passed**;
  - **design-smoke: 51/51 passed** (undo/redo, LLD and views regression);
  - **lab-smoke: 29/29 passed** (new);
  - no console errors in any suite.
  The lab suite covers:
  - a fresh lab history and the locked toolbar workload;
  - a baseline record with snapshot, benchmark, seed and revision;
  - only simulator-modeled controls offered; undoable edits;
  - like-for-like comparison with single-change attribution, and the baseline unchanged;
  - saving a variant with its matching run; refusing a duplicate name;
  - Undo not touching the variant; load-as-draft confirmation, with the variant and baseline unchanged;
  - a 5-level sweep with exactly the planned levels and seed, two charts, and the measured breaking point matched to the stored data (first miss at 600 req/s);
  - a cancelled sweep stored with unrun levels and shown as "Not run";
  - benchmark-difference warnings;
  - five lessons with statuses and full sections;
  - no leakage into the design canvas; challenge storage byte-identical;
  - persistence and restored results after reload; the other theme.
- I reviewed screenshots of the comparison, explanations, scaling curve and results in the other theme. This review led to two fixes: clipped chart axis labels, and overstated "shift" and "difference follows" wording.

### Known limitations

- **Workloads are constant-rate.** There are no bursts, ramps or random arrivals, so "burst" experiments are traffic above capacity for a window.
- **Failures are outages only.** Injected failures are scheduled outages: whole components, with no partial degradation.
- **Busy share is approximate for autoscaling.** It uses the peak capacity for Container Services that autoscale, which understates busy share while capacity was lower.
- **The saturation estimate is linear.** It assumes utilization grows in proportion to traffic. Queueing usually degrades latency earlier, and the estimate is never a measurement.
- **Sweeps.** A sweep re-simulates every level from scratch: no caching or incremental runs. Sweeps are capped at 8 levels and 400,000 offered requests; larger studies must be split.
- **Retention.** Only the latest experiment run and the latest sweep are kept, plus variants (each with at most one run). There is no run history beyond that, and no export.
- **Attribution** is limited to "single change vs several". It does not test changes one at a time.
- **Lab edits are not challenge submissions.** Challenge drafts loaded into the lab are copies, and nothing in the lab grades or records a challenge attempt.
- **Browser coverage.** The browser suites need a local Chrome or Chromium (`CHROME_PATH`) and exit with code 2 without one. Firefox, Safari and screen readers were not tested.

## 2026-10-20 — Attempt history: immutable snapshots, review, compare, reproduce

### Before this change

Each challenge kept up to 20 attempt *summaries*: the verdict, criteria met, measured values and latencies. They contained no architecture, benchmark, criteria definitions or explanations, so a past attempt could not be inspected, reloaded or compared. Last round's design/LLD/undo browser suite existed only in a scratch directory.

### Attempt records (`src/challenges/attempts.ts`)

- **Contents.** Every submission now stores a self-contained record next to its summary in `progress.challenges[id].history[n].record`:
  - **Architecture snapshot:** component ids, types, names, configurations, canvas positions, given-system flags and connections. It is captured with `structuredClone` **when Submit is pressed**, so edits made while grading runs do not reach it.
  - **Benchmark:** offered traffic, run length and traffic window, seed, pattern, scheduled faults, locked workload costs, and the exact engine input that was simulated (node settings after locks).
  - **Criteria definitions as graded:** metric, comparator, threshold, unit and advice. A later change to the challenge cannot rewrite how an old attempt was judged.
  - **Result:** pass or fail, invalid reason, per-criterion results (measured value, threshold, status, missed by), the measured performance summary, the heuristic findings, and validation.
  - **Identity:** challenge id and title, attempt number, time, and simulator revision.
- **Immutability.**
  - Records are deep-frozen when built and again when loaded from storage. Recording, saving drafts, Undo/Redo and new submissions only ever create new objects.
  - Reviewing, comparing, reproducing and loading read copies. The browser suite compares the stored JSON of attempt #1 before and after each of these actions.
- **Retention.** The existing policy is unchanged: at most `HISTORY_SIZE` = 20 attempts per challenge, oldest dropped first. The summaries behind best, last and previous stay small (they carry the attempt `number`, not the record), so the best attempt is still known after its record has been dropped.
- **Schema versioning.**
  - **Two versions:** `ATTEMPT_SCHEMA_VERSION` (the record) and `ARCHITECTURE_SCHEMA_VERSION` (the snapshot). Both are 1.
  - **Reading:** `parseAttemptRecord` returns one of four outcomes:
    - `ok`: the record, frozen;
    - `missing`: an attempt saved before records existed;
    - `unsupported`: an unknown record or snapshot version, for example one written by a newer Flowzen;
    - `invalid`: the data fails structural validation (unknown component type, non-string config value, duplicate ids, a connection to a missing component, missing benchmark, malformed criterion).
  - **No substitution:** nothing is repaired or substituted. The UI shows missing, unsupported and invalid attempts as **summary only**, with the reason. It offers no review of the architecture, no loading, no reproduction and no comparison for them, and never shows the current architecture in their place.
  - **Future versions:** a later schema must add a migration from version 1 inside `parseAttemptRecord` before bumping the version.
  - **Storage:** `flowzen-challenges-v1` is unchanged. Records are an optional field, so older progress, including legacy summary-only attempts, loads as before.
- **`SIMULATOR_REVISION` (= 1)** is stored with each record. Bump it when an engine change alters results for the same input. Reproducing a record from another revision is labelled as possibly different.

### Reviewing past attempts (`src/components/AttemptsDialog.tsx`, lazy-loaded)

- **Opening it.** The brief's "Your attempts" list shows all retained attempts (the latest 5, then "Show all"), numbered #n, with a **Review** link. Summary-only attempts show **Summary** instead. The results dialog adds **Review attempt #n** and **Compare with previous**.
- **Review shows:**
  - a **"Historical result"** banner: recorded at grading time, not re-simulated, read-only;
  - the submitted architecture, drawn at its original positions, with a table of each component's simulated settings and its connections;
  - the benchmark as run (traffic, windows, seed, failures, simulator revision);
  - the acceptance criteria as graded;
  - the simulator's measurements;
  - **"Bottleneck explanations · heuristic · derived from the measurements above"**, labelled separately from the measurements;
  - failed requirements with the amount missed and the stored advice.
- **Load as new draft.** It replaces the challenge's current draft with an editable copy of the snapshot.
  - Unless the canvas already equals the snapshot, an explicit confirmation step comes first ("Replace draft" or "Keep current draft").
  - The load is one named history entry ("Load attempt #n as draft"), so **Undo restores the replaced draft**.
  - The record itself is never changed.
- **Reproduce run.** It simulates the record's exact engine input (original workload, seed and locked settings) and grades it against the stored criteria, even if the challenge definition has changed since.
  - It reports either "Every measurement and criterion result matches the recorded attempt" or a list of differences, noting when the simulator revision differs.
  - The reproduction runs on its own worker. It is not recorded as an attempt and does not touch the practice run.

### Comparing attempts (`compareAttempts`, deterministic and pure)

- **Inputs.** Pick any two attempts that have readable records. The default is the two most recent.
- **Measured** (simulator output of each attempt's own run):
  - p50, p95 and p99 latency, successful throughput and error rate, with signed changes (differences between percentages in points);
  - per-component utilization;
  - each criterion's measured value and status, with "result changed" flagged.
- **Structural** (read from the two snapshots):
  - components added, removed or changed;
  - renames and moves, marked cosmetic;
  - configuration changes. Each is marked as either descriptive (not simulated) or "overridden by a benchmark lock, no effect on the run" when the value the simulator used did not change;
  - connections added or removed.
- **Attribution** follows only what the comparison supports:
  - **Benchmarks differ** (traffic, windows, seed, faults, locked costs or simulator revision): the measurements are not directly comparable, and no change is credited.
  - **Same simulation inputs:** the differences are cosmetic.
  - **One simulation input changed:** the benchmark was identical and the simulator is deterministic, so the measured differences follow from that change, in this benchmark only.
  - **Several inputs changed:** the comparison states it cannot tell which change, or which combination, produced a difference.
- Everything is sorted, and the records are only read. Comparing round-tripped (JSON) copies gives byte-identical output.

### Browser tests

- **New shared harness (`e2e/harness.mjs`).** It serves `dist/` with Vite preview on a free port and drives the local Chrome through puppeteer-core with a fresh profile. It records checks, fails on console errors, and saves screenshots when `SMOKE_SCREENSHOTS` is set.
- **New runner (`e2e/run-all.mjs`)** runs each suite in its own process and prints the totals even when one fails. `npm run test:browser` now builds and runs both suites.
- **Design suite moved into the repo** as `e2e/design-smoke.mjs`, ported from last round's scratch script. Its fragile assertion that the brief contained exactly two lists now checks what the brief says: the topic, a functional requirement, a non-functional requirement and a learning objective. The challenge suite's "exactly two criteria lists" assertion was replaced the same way: it now checks the requirement text, the Runtime and Architecture groups, and the pass rule.
- **15 new checks in the challenge suite:**
  - the stored record's schema, snapshot, seed and criteria;
  - later edits (Undo to 2 instances) do not reach attempt #1's snapshot;
  - Review shows the historical banner, the original architecture (14 instances) and the seed;
  - measurements are labelled separately from the heuristic explanations;
  - Reproduce matches the record and leaves the practice run untouched;
  - loading over a different draft asks for confirmation, and declining keeps the draft;
  - confirming loads the snapshot as a draft with a named undo entry, the record is unchanged, and Undo restores the replaced draft;
  - Compare attributes the change to the single changed input ("Profile API · Instances: 14 → 2") and separates measured from structural differences;
  - review and compare never change a stored attempt; records survive a reload unchanged;
  - an injected legacy attempt is summary-only, with no snapshot, no Load button and no current architecture shown.
- **Mutation check:** forcing load-as-draft to skip confirmation made 2 checks fail ("asks for confirmation first", "Declining keeps the current draft"). The code was restored afterwards.

### Test results (all run on 2026-10-20)

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **206 passed, 0 failed** (12 files). The new `attempts.test.ts` has 17 tests:
  - snapshot contents and deep-copy isolation;
  - record contents (benchmark, seed, locked engine input, criteria definitions, frozen);
  - independence from later challenge changes;
  - 20-entry retention with consistent numbering and no edits to recorded attempts;
  - storage round trips, with legacy entries read as `missing`;
  - versioning: current accepted; record and snapshot versions unsupported; 9 damage cases invalid, never with a substituted record;
  - load-as-draft returns an independent copy, and draft → canvas → snapshot reproduces the original exactly;
  - reproduction is identical for the first three challenges, uses stored criteria and workload after a definition change, and reports differences when there are any;
  - comparison: single-change attribution, refusal with several changes, names, positions, descriptive fields and lock-overridden edits treated as non-simulation changes, different benchmarks flagged, deterministic and non-mutating.
- `npm run build`: passed, with no chunk-size warning. The new `AttemptsDialog` chunk is 20.4 kB.
- `npm run test:browser`, headless Chrome on Linux, local `/usr/bin/google-chrome`:
  - **challenge-smoke: 46/46 passed**;
  - **design-smoke: 51/51 passed**;
  - no console errors in either.
- I reviewed screenshots of the review dialog and the compare dialog.

### Known limitations

- **Storage size.** Records live in `localStorage`. A record is a few kilobytes (small architectures), so 20 per challenge fit comfortably. Very large designs could reach the browser's quota, in which case saving fails and the in-memory session keeps working (`saveProgress` returns false). There is no export or import yet.
- **Reproduction depends on the simulator.** Reproduction is exact only while the engine behaves as it did when the attempt was graded. `SIMULATOR_REVISION` must be bumped by hand when engine semantics change; nothing detects that automatically.
- **Attribution** is limited to "one simulation input changed versus several". It does not test changes in isolation, for example by re-simulating each change on its own.
- **Legacy attempts** saved before this change have no snapshot and stay summary-only permanently. Their attempt numbers fall back to their position in the retained list.
- **Snapshot diagram.** It is a static drawing at the submitted positions, with no zoom or pan. Large designs are scaled down to fit.
- **Browser coverage.** The browser suites need a local Chrome or Chromium (`CHROME_PATH`) and exit with code 2 without one. Firefox, Safari and screen readers were not tested.

## 2026-10-19 — Challenge Mode: grading isolation, explanations, progression and browser smoke tests

### Starting point

Challenge Mode already had a library, a workspace, a deterministic grader, a results dialog and `localStorage` progress (see the entries below). I checked it against the new specification and fixed or added only what was missing. Existing grading, benchmarks and challenges were kept, apart from the changes listed here.

### Fixed

- **Grading no longer overwrites the interactive simulation.**
  - Before: a submission replaced the practice run and started playing the benchmark, so the visible results, metrics and playback changed.
  - Now: submissions run on a separate runner and worker. The graded run is stored with that result only.
  - The practice run, its playback and its metrics stay exactly as they were. The browser suite checks this with the practice run's recorded event count. Reintroducing the old behavior makes that check fail (6,510 → 9,000 events).
  - "Load benchmark run into playback" in the results dialog loads the graded run into playback only when the user asks, and its tooltip says it replaces the practice run.
- **The right panel no longer leaves the challenge brief unexpectedly.** All tab changes go through `src/app/rightPanel.ts`.
  - Only explicit inspection switches to the Inspector: selecting a component or connection, opening a request trace, or "Review issues".
  - These never move the panel: changing HLD/LLD/Unified, undo/redo, submitting, results arriving, and React Flow re-reporting an unchanged selection. Before, switching to LLD with a component selected moved the panel off the brief.
  - While the Inspector is open in a challenge, a strip above it shows the challenge, the criteria passed in the last practice run, and a **Brief** button.
- **Drafts could lose recent edits.** Drafts autosave 400 ms after an edit. Leaving a challenge within that time dropped the last edits. Leaving a challenge (to the list or to Design) now saves its draft immediately.
- **An unmeasurable requirement was removed.** "Payments captured exactly once" was an informational, unsupported criterion of Reliable Checkout, and the simulator cannot measure it. Following the specification, it is no longer part of the challenge set. The grader still handles `unsupported` metrics safely: they never pass, and a mandatory one blocks the pass. Tests use a synthetic challenge to check this.

### Challenge definitions (`src/challenges/definitions.ts`, declarative, no UI code)

- **New fields:**
  - `estimatedMinutes`, shown as an estimate;
  - `learningObjectives`;
  - `relatedDesigns`: component kinds whose LLD illustrates the concepts.
  The fields from earlier entries remain: statement, scenario, difficulty, topics, functional and non-functional requirements, fixed workload (rate, traffic window, run length, pattern, seed, faults, locked costs), acceptance criteria (metric, comparator, threshold, unit, mandatory, advice), given systems, hints and starter.
- **New metric `utilization`.** It is the engine's busy fraction of one component. Cache It Right gains **"Orders DB utilization ≤ 70%"**:
  - the starter measures ~100% and fails;
  - the reference cache designs measure ~45% and pass;
  - a missing Orders DB makes the criterion unavailable, never passed.
- **Hints.** Async Processing has a new hint that refers to separation of concerns and the Message Queue's LLD. Hints stay progressive, hidden by default and separate from grading.

### Grader (`src/challenges/grading.ts`, `src/challenges/submission.ts`)

- **Criterion results:**
  - Each has a `category`: **runtime** (measured from the benchmark run) or **architecture** (dead components, given systems, compute budget).
  - Each has `missedBy`, the gap to the threshold for a failed criterion. Gaps between percentages are reported in percentage points.
- **Findings explain why the run behaved as it did,** using engine output only:
  - failures by component and cause, with their share of requests, and utilization, backlog and wait at that component (plus the outage window for scheduled faults);
  - saturated components (≥ 85% busy), with utilization, slots, peak backlog and average wait;
  - backlogs (≥ 10 waiting);
  - cache effectiveness from traces: lookups, hits, the share of requests reaching the component behind the cache, and requests that bypassed it. A cache nothing passes through is reported as receiving no requests;
  - pending and dead-lettered jobs.
  `mainBottleneck` is the most severe finding that limits performance. Invalid runs produce no findings.
- **Grades are frozen.** `deepFreeze` freezes grades, so a graded result cannot be edited. Their validation is a copy. The simulation result is not frozen, so it can still be played back.
- **Submission flow:**
  - `prepareSubmission` copies the user's architecture, so the fixed workload and locked settings apply only to the simulated copy.
  - `gradeSubmission` is pure. It grades the run and reports the previous and best attempts as they were before this submission.

### Progress (`src/challenges/progress.ts`)

- Each challenge keeps a **history** of up to 20 attempts (oldest dropped), in addition to best, last and previous. Attempts are frozen when recorded and when loaded from storage. Recording a new attempt, saving a draft or undoing an edit never changes an earlier attempt.
- The storage format is unchanged (`flowzen-challenges-v1`); the new fields are optional, so existing saved progress still loads.
- Points, tier unlocking, the rule that a solve is never revoked, and per-challenge drafts are unchanged.

### UI

- **Challenges page:**
  - topic filters next to search (search also covers learning objectives);
  - each card shows estimated time and the number of acceptance criteria;
  - solved, attempted and locked states as before.
- **Brief:**
  - estimated time, topics, "What you'll learn", and functional and non-functional requirements;
  - the fixed benchmark, with a note that toolbar traffic and duration are ignored;
  - acceptance criteria split into **Runtime** and **Architecture**, with the pass rule stated;
  - a Submit state ("Grading…") separate from practice runs, and grading errors;
  - your last 5 attempts (pass or fail, criteria met, p95, time, best marked), and hints;
  - **Related designs**: chips that select that component and open its LLD. A chip is disabled, with an explanation, until such a component is on the canvas. A note states that the illustrative Java does not change simulation results.
- **Results dialog:**
  - PASS or FAIL;
  - "Why it performed this way": the main bottleneck first, then the other findings, each with its evidence;
  - Runtime and Architecture tables with measured value, requirement, result, "missed by", and change versus the previous and the best attempt;
  - p50/p95/p99, successful versus offered throughput, error rate, and component utilization;
  - static architecture validation, kept separate from runtime failures;
  - "How to improve", with the amount missed and advice for each failed criterion;
  - a retry action that keeps the architecture.
- **Results are scoped to their challenge.** A graded result belongs to the challenge it was submitted for, and opening another challenge never shows it. The last result is kept until the next submission, including after restoring the starter or leaving and returning.

### Tests

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **189 tests passed** (15 new or extended).
  - **Grading (16):**
    - starters fail and reference solutions pass. There are now two designs each for The Slow API, Cache It Right, Scale the Backend (new: Container Service) and Async Processing (new: Event Stream), plus Protect the Ledger;
    - grading is deterministic;
    - exact threshold boundaries for every measured criterion, including the new utilization criterion;
    - measured values, thresholds, `missedBy` and categories;
    - invalid and incomplete runs; the shipped set has no unsupported criteria; unsupported metrics are handled safely; missing metrics are unavailable;
    - utilization equals the engine's value;
    - findings come from evidence: a bypassed cache, a working cache's hit share, failure counts equal to the failed traces, no high-severity findings for a passing design, none for invalid runs;
    - presence alone does not pass;
    - user edits to locked settings are ignored;
    - grades are frozen, and the architecture, run and validation are not mutated.
  - **Submission (3):** the fixed benchmark is graded no matter what the interactive settings are; a deep-frozen architecture is copied, not modified; a practice run is left unchanged; previous and best come from before the submission and nothing is recorded; identical submissions give identical grades.
  - **Progress (7):** the capped history; recorded attempts are immutable across new attempts and draft saves; attempts are frozen on load; drafts are independent per challenge; plus the earlier persistence, solve, best-attempt and unlocking tests.
  - **Right panel (3):** the brief stays through view changes, undo/redo, submission, results and re-reported selections; only explicit inspection switches to the Inspector; explicit tab choices are honored.
  - **History (24):** a new test checks that undo histories stay independent when switching between challenges.
- `npm run build`: passed, with no chunk-size warning.
- **Browser smoke suite (new, in the repo):** `npm run test:browser` builds, starts Vite's preview server on a free port, and drives a local Chrome through `puppeteer-core` (`e2e/challenge-smoke.mjs`). **Result: 30 of 30 checks passed, with no console errors.**
  - Library: groups, topic filter, locked tier.
  - Brief contents; empty history on a new challenge; a practice run fills the criteria.
  - Switching HLD/LLD/Unified keeps the brief; selecting a component opens the Inspector with the strip; the strip returns to the brief.
  - Undoable configuration edit.
  - PASS submission; the practice run is untouched; the architecture is kept; the attempt is saved as solved.
  - Undo after submitting reverts the edit and leaves the recorded attempt unchanged; the brief stays open.
  - FAIL submission shows missed-by amounts, a main bottleneck with evidence, and comparisons with the previous and best attempts; a fail never revokes the solve; the brief lists both attempts.
  - Related design opens the LLD.
  - Leaving within the autosave delay saves the draft; another challenge has its own architecture and history; returning restores the right draft and undo history; the other challenge's draft is intact.
  - Persistence across reload.
  - A mutation run (grading result loaded into playback again) made the interactive-state check fail, as intended.
  - `SMOKE_SCREENSHOTS=<dir>` saves screenshots; `CHROME_PATH` selects the browser.
- The 51-check design, LLD and undo suite from the previous entry, still in a scratch directory and not in the repo, was rerun: 50 of 51 passed. The one failure is that script's outdated expectation of exactly two requirement lists in the brief ("What you'll learn" adds a third), not a regression.
- I reviewed screenshots of the library (topic filters, estimates, locked tiers) and of the FAIL results dialog.

### Dependencies

- Added the dev dependency `puppeteer-core@23.10.4` (exact version) for the reproducible browser suite. It downloads no browser and uses the locally installed Chrome. No runtime dependencies were added.

### Known limitations

- The browser suite needs a local Chrome or Chromium (set `CHROME_PATH` if it is not in a standard location); it exits with code 2 if none is found. It runs in Chrome only. Firefox, Safari and screen readers were not tested.
- Findings use fixed thresholds: saturated at ≥ 85% utilization, backlog at ≥ 10 waiting, a cache counted as bypassed when more than half of the requests reaching its downstream skipped it. They describe this simulator's behavior, not production systems.
- Cache hit detection assumes one cache per request path: the engine records a single cache outcome per request.
- Attempt history keeps the last 20 summaries per challenge. It does not store the submitted architecture, only its measurements and the outcome of each criterion.
- Estimated times are rough guidance and are not measured.
- Practice runs and submissions use the same benchmark, so a practice run still predicts the grade exactly. Only submissions are recorded.

## 2026-10-19 — Undo/redo, low-level design mode, HLD–LLD connection

### Starting point

Challenge Mode already existed (see the entry below): six challenges, including the five requested, deterministic grading on the real engine, results, progress in `localStorage`, and a workspace that reuses the canvas. That work was kept as it was. This milestone adds the missing pieces: undo/redo, a real LLD mode, the HLD–LLD connection, and two gaps in the challenge brief.

### Undo and redo (`src/app/history.ts`, `src/app/useArchitectureHistory.ts`)

- **One history mechanism.** `EditHistory<T>` is a pure, framework-free linear stack. `ArchitectureHistory` connects it to the canvas. App calls one observer after every state change, so every edit path (React Flow changes, inspector fields, validation fixes, bulk actions) is recorded the same way. No edit has its own history hook.
- **What is recorded.** Snapshots hold only the architecture: component id, kind, name, configuration, position, given-system locks, and connections. Selection, measured sizes, drag-in-progress state, simulation results, playback and metrics never create entries and are never rewound.
- **Supported edits:** add or delete a component (deleting restores its connections and configuration), move, connect or disconnect, configuration changes, renaming, validation fixes, Load sample, Clear canvas, and Restore starter architecture.
- **Grouping:**
  - Changes made while any component is being dragged are ignored, so a whole drag (one or several components) becomes one "Move" entry when it ends.
  - Continuous typing into one field, or a rename, is merged into one entry while edits arrive within 1 s of each other.
  - If a merged group returns to its starting value (for example through the field's own undo), the entry is dropped, so there are no empty undo steps.
- **Redo.** A new edit after an undo clears the redo branch.
- **Limits.** History keeps 100 entries per workspace and drops the oldest first.
- **Workspaces.** The design canvas and each challenge have separate histories. Switching to Challenges and back keeps the design history, including its redo entry. A challenge reopened from a draft keeps its history only if the draft still matches.
- **Bulk actions.** Load sample, Clear canvas and Restore starter are single, named, undoable entries. Restore starter's confirmation now says it can be undone. Simulation Reset clears only results and is not an edit.
- **Restoring snapshots.**
  - Connections are restored only when both components exist.
  - Given systems keep their `fixture` flag, non-deletable state and locked settings.
  - Components that still exist stay selected, so undoing a config edit does not move the inspector.
  - App now ignores React Flow selection callbacks that do not change the selection. Previously, replacing node objects (as undo does) could switch the right panel from the Challenge brief to the Inspector.
- **Toolbar.** Undo and Redo buttons have clear disabled states. Tooltips name the edit and the shortcut, e.g. "Undo Move Load Balancer (Ctrl+Z)" or "Nothing to redo (Ctrl+Shift+Z or Ctrl+Y)". The tooltip sits on a wrapper so it still shows when the button is disabled.
- **Shortcuts.**
  - Ctrl+Z / ⌘Z undoes. Ctrl+Shift+Z / ⇧⌘Z redoes. Ctrl+Y also redoes on Windows/Linux; it is not bound on macOS.
  - The shortcuts are ignored in inputs, textareas, selects, contenteditable regions and anything marked `data-native-undo`, so text fields keep the browser's own undo.
  - They are disabled on the challenge list and while the pre-run review or the results dialog is open.
- **Attempts are separate.** Edit history is independent of submitted attempts. Undo never touches progress, recorded attempts or the last graded result.

### Low-level design model (`src/lld/`)

- `types.ts` defines one structured model per component. It contains:
  - an overview: responsibility, inputs, outputs, collaborators, state and behavior;
  - `canvasRole`: how upstream and downstream canvas neighbors map onto the code's collaborators;
  - classes, each with kind, file, responsibility, UML member summaries and a diagram layer;
  - typed relations: implements, extends, uses, owns and creates;
  - Java files;
  - principle claims, each with all five required explanations;
  - design decisions with alternatives and when to prefer them;
  - interactive design choices;
  - a before/after refactoring;
  - config bindings;
  - a statement of what Flowzen actually simulates.
- **Covered components (9):** Load Balancer, API Gateway, Application Server, Cache, SQL Database, Message Queue, Worker, Rate Limiter and Circuit Breaker. Every other kind shows an explicit "No low-level design for … yet" state; nothing is generated from a component's name. `coverage.ts` is a small index the canvas uses without loading the models, and a test keeps it in sync.
- **Principles are selective.** Each model claims 3–4 principles that its code actually shows (never all twelve), for example:
  - ISP: Message Queue's separate `MessagePublisher` and `MessageSource` roles;
  - LSP: Cache's `NoOpCache` and its "may forget anything" contract;
  - Dependency injection: Rate Limiter's injected clock;
  - Composition: Circuit Breaker wraps calls instead of subclassing clients.
- **Code ties to the simulator where that is true.**
  - `AppServer` uses a fixed thread pool, a bounded queue and a timeout checked when work starts, the same admission rules the engine models.
  - `TokenBucket` matches the simulated rate and burst.
  - `ReadWriteRouter` mirrors replica routing.
  - Where the code differs from the simulator, the model says so. The Circuit Breaker has a half-open state, which is not simulated; its design choice "Close after the open period" shows the behavior Flowzen does simulate, and it is highlighted because it matches the component's `halfOpen` setting.
- `java.ts` is a small Java tokenizer for highlighting. `diagram.ts` lays out the class diagram deterministically: layers wrap at three classes, value types are optional, and parallel relations are offset.

### LLD inspector and view modes

- **HLD.** The canvas shows names and categories. The component inspector adds a **Role in the architecture** section: what the component receives and sends, its actual upstream and downstream neighbors (clickable), and whether the simulator uses each connection, with the reason when it does not. A button opens the low-level design.
- **LLD.** The canvas shows configuration and a "{ } Java design · N types" line, or "No Java design yet", on every node. The inspector widens (540 px; 460 px at ≤ 1280 px) and opens the selected component's design in five tabs:
  - **Overview:** responsibility, inputs, outputs, collaborators, state and behavior; "On your canvas", which maps real neighbors onto code collaborators; "Configuration → code" with the component's current values; and what Flowzen simulates.
  - **Classes:** an SVG UML diagram. Clicking or pressing Enter on a class shows its responsibility, members, "Depends on" and "Referenced by" (clickable, so dependencies can be followed), the principles it demonstrates, and "View code".
  - **Code:** a file list and highlighted Java with Copy. Model type names in the code are links that open that type's file.
  - **Principles:** expandable claims, each with the general definition, the classes involved, evidence, benefit, a violation example and the trade-off. A before/after refactoring is shown below them.
  - **Design:** decisions with alternatives, and "What if…" choices that show how the implementation would change. A choice is tagged when it matches the component's configuration.
- **Unified.** The canvas shows live simulation data. The component inspector has **Component** and **Low-level design** tabs, plus the Role section.
- **Switching views** keeps the selected component. LLD switches the inspector to the design; HLD returns to the component.
- **Disclaimer.** Every design is labelled as illustrative Java: one possible implementation, never executed and not read by the simulator. Design choices state that they do not change the simulation.
- **Loading.** The LLD inspector and models load on first use (`LldPanel` chunk, ~166 kB).

### Challenge mode additions

- Challenges now separate **functional** requirements (new `functional` field) from **non-functional** ones (the existing `requirements`, which the acceptance criteria check). The workspace brief now shows both, plus the topics tested. Before this, it showed neither the requirements nor the topics.
- Grading, benchmarks, progress and the six challenges are unchanged.

### Build

- `vite.config.ts` puts `@xyflow/react` (and the React runtime it pulls in) into its own `flow` chunk. Without this, the new code pushed the main chunk just over Vite's 500 kB warning. Chunks now: app 195 kB, flow 314 kB, LLD 166 kB, metrics 381 kB (lazy). No new dependencies.

### Tests

- `npm run typecheck`: passed. It is also clean with `--noUnusedLocals --noUnusedParameters`.
- `npm test`: **174 tests passed** (106 new).
  - **History (23):**
    - ordering, redo invalidation, equal-state no-ops, coalescing window and key, dropping a group that returns to its start, no merging into undone entries, the history limit;
    - add, delete with connections and config restored, grouped single and multi-component drags (through React Flow's `applyNodeChanges`), connect and disconnect, config typing, renaming, selection, dimension and edge-selection changes ignored, selection kept, bulk-action labels, per-workspace histories with given-system locks, connections to missing nodes dropped, conservative labels for mixed changes;
    - shortcut mapping on both platforms, and editable-field protection.
  - **LLD (79):** coverage of every core component; one model per kind; uncovered kinds stay uncovered; the coverage index stays in sync. Per model:
    - every modeled class is declared in its file with the right kind, and every declared type is modeled;
    - members exist in the code;
    - every diagram relation is backed by the code (implements and extends clauses, references), and every inheritance in the code is drawn;
    - files import the JDK types they use, declare the right package, and have balanced braces;
    - principle claims are unique, selective, complete, and cite classes that exist and are named in the evidence;
    - choices, config bindings (real catalog fields) and the refactoring's principle are consistent.
    Also: the tokenizer round-trips every file and classifies tokens, and diagram layout places every visible class once, without overlaps, within the inspector width. A mutation check (removing a relation, renaming a member) confirmed the tests catch drift.
  - **Neighbors (2)** and **challenge definitions (2):** all challenges have functional and non-functional requirements, topics, hints and mandatory criteria, and the five requested challenges are present.
- `npm run build`: passed, with no chunk-size warning.
- **Headless Chrome against `vite preview` (puppeteer-core in a scratch directory, not a project dependency): 51 of 51 checks passed, with no console errors.**
  - Undo and Redo start disabled, and tooltips name the edit.
  - Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y.
  - A 20-step mouse drag is one entry, and one undo returns the component to its start.
  - Delete with the keyboard, then undo restores the component and its 3 connections.
  - A new edit clears redo.
  - A handle-drag connection can be undone.
  - Ctrl+Z inside the name field leaves the canvas alone and adds no empty step.
  - A rename is one entry.
  - Running a simulation, selecting components and exploring the LLD add no entries.
  - HLD shows the role and neighbors; its button switches to LLD with the selection kept and the inspector widened; nodes show coverage.
  - LLD Overview, bindings and the disclaimer; class diagram selection and following a dependency; View code; a type link in the code; Copy, read back from the clipboard; principles expand with all five sections; the before/after refactoring.
  - A design choice matched to the configuration, and switching a choice.
  - An uncovered kind shows its explicit message; selecting another component shows its design.
  - Unified tabs; the theme toggle.
  - A challenge starts with its own history; the brief shows requirements and topics; a config edit is undoable; the submission PASSes on the real engine.
  - Undo after submitting reverts the edit but keeps the recorded attempt, the solved flag and "Last result".
  - Returning to Design keeps that canvas's history.
- I reviewed screenshots of HLD role, LLD classes (light and dark), code (light and dark), principles, the challenge brief, and PASS results.

### Known limitations

- History is in memory. It does not survive a reload, although challenge drafts do. It is per workspace and capped at 100 entries. Coalescing is time-based (1 s), so a long pause while typing in one field creates a second entry.
- Edits made while a component is mid-drag are not recorded until the drag ends. Undo is ignored during a drag.
- LLD covers 9 of 25 component kinds. The others (DNS, CDN, Reverse Proxy, WAF, Container Service, Serverless, NoSQL, Read Replica, Object Storage, Search Engine, Distributed Cache, Event Stream, DLQ, Client, observability) show an explicit "not covered yet" state.
- The Java is illustrative and is not compiled in this project. Consistency with the diagram and principles is checked structurally by tests, not by `javac`. Some snippets use third-party APIs (jjwt, Spring Data) for realism. Design-choice snippets are excerpts.
- The class diagram uses fixed layers with straight edges. Edges can cross in the larger models, and edge labels are small.
- Both panels compete for space in LLD mode: at 1440 px the wide inspector leaves the canvas about 650 px. Collapsing the library or bottom panel helps.
- The headless suites from earlier milestones (35 design checks, 27 validation checks, 21 challenge checks) lived in earlier sessions' scratch directories and could not be rerun. The new 51-check suite covers the same core flows: add, drag, connect, delete, configure, run, and grade a challenge.
- Not checked: Firefox, Safari, screen-reader output, or real-pointer native drag-and-drop from the library.

## 2026-10-19 — Challenge Mode

### Challenges (`src/challenges/definitions.ts`)

Six challenges, each with a problem statement, scenario, explicit requirements, a deterministic benchmark (rate, traffic window, run length, pattern, seed, scheduled failures), acceptance criteria, progressive hints, and a starter architecture. Some starters include **given systems**: components that cannot be deleted and whose listed settings are locked.

| # | Challenge | Difficulty | Topic | Benchmark | Key criteria |
|---|---|---|---|---|---|
| 1 | The Slow API | Easy | Horizontal scaling, latency | 300 req/s, 40 ms per request | p95 ≤ 100 ms, ≥ 297 req/s, errors < 1%, ≤ 24 compute slots |
| 2 | Cache It Right | Easy | Caching, DB bottleneck | 500 req/s against a fixed 200 req/s Orders DB; any cache hits 80% | p95 ≤ 60 ms, ≥ 495 req/s, errors < 1%, ≤ 30% of requests reach the DB |
| 3 | Scale the Backend | Medium | Load balancing | 1,500 req/s, 20 ms of compute, 1 ms in the LB | ≥ 1,485 req/s, errors < 1%, p95 ≤ 50 ms, ≤ 40 slots. The single-slot LB is a hidden bottleneck. |
| 4 | Async Processing | Medium | Queues, workers | 180 uploads/s for 8 s + 4 s drain; fixed 150 jobs/s processor | Accept p95 ≤ 50 ms, errors < 1%, ≥ 99% of accepted uploads processed before the run ends |
| 5 | Protect the Ledger | Hard | Rate limiting, load shedding | 1,500 req/s against a fixed 500 writes/s Ledger | ≥ 450 req/s, p95 ≤ 100 ms, Ledger max queue ≤ 20, ≤ 1% of failures at the Ledger, every success written to the Ledger |
| 6 | Reliable Checkout | Expert | Fault tolerance, retries | 300 req/s for 10 s, Payment Provider outage 3–6 s, run to 16 s | Errors < 1%, p95 ≤ 150 ms, ≥ 99% of accepted checkouts captured by the end. "Exactly once" is listed as informational and unsupported. |

- Async Processing and Reliable Checkout state their **completion semantics** explicitly: a request succeeds when it is accepted (processed synchronously or durably enqueued), and the separate "processed/captured" criterion checks that its work finished before the run ended.
- Every benchmark ends with a drain window, so in-flight requests can finish. Only genuinely stuck work counts as "unfinished".
- The workload fixes per-request costs that a design should not be able to change: application compute time on any compute kind, routing latency, and cache hit ratios. Users cannot pass by setting latency to 0. Locked settings are shown disabled in the inspector and listed in the brief.

### Grading (`src/challenges/grading.ts`)

- `benchmarkInput` builds the run from the challenge's workload and seed, plus the given systems' locked settings. Toolbar traffic and duration, and user edits to locked values, are ignored.
- `grade` uses only engine output and static validation:
  - p50/p95/p99 of successful requests;
  - successful throughput over the traffic window (shown next to offered traffic);
  - error rate;
  - share of requests processed at a component;
  - a component's max queue depth;
  - share of failures at a component;
  - "processed by", from traces (sync, or via a completed job);
  - dead components;
  - given systems present;
  - compute slots.
- Performance criteria count only what actually happened in the request traces, so adding a component that is bypassed, unconnected, or never reached changes nothing.
- A challenge passes only when every mandatory criterion passes. Performance criteria are marked **unavailable** (never passed) when:
  - there is no result;
  - the result is not the benchmark workload;
  - no traffic was generated;
  - the engine stopped early;
  - not every offered request was simulated;
  - there were no successful requests to measure.
- Criteria the simulator cannot measure are **unsupported**. A mandatory unsupported criterion blocks a pass.
- Each criterion reports its measured value, threshold and comparator, plus the headroom or shortfall. Bottleneck analysis ranks failure causes by component, components at ≥ 85% utilization, backlogs, dead-lettered jobs, and pending jobs.

### Progression (`src/challenges/progress.ts`)

- Progress is saved in `localStorage` (`flowzen-challenges-v1`). Per challenge it keeps: attempts, solved, the best attempt (pass first, then criteria met, then p95), the last attempt, and the previous attempt. Unreadable or other-version data starts fresh.
- Drafts of each challenge's architecture are saved automatically (debounced) and restored on return or reload.
- Unlocking: Easy is open. Each later tier opens after any challenge in the previous tier is solved. Solved challenges can be practiced again.
- Points: Easy 100, Medium 200, Hard 300, Expert 500, awarded once on the first solve. Failed attempts are recorded as attempted, with per-criterion feedback, and never mark a challenge solved.

### UI

- The toolbar has a Design / Challenges switch. The free-design canvas is set aside and restored when you return to Design.
- **Challenges page:** search across title, summary, topic and difficulty; groups for Easy, Medium, Hard and Expert; each card shows status (Not started / Attempted / Solved / Locked, with the unlock rule), key requirements, topics, attempts and best result; a progress header shows solved count and points.
- **Challenge workspace:** reuses the existing canvas, library, inspector, simulation and playback. The right panel has Challenge and Inspector tabs.
  - The Challenge tab shows the statement, scenario, completion semantics, benchmark (seed, window, run length, pattern, failures), locked workload costs and given systems, the acceptance criteria with values from the latest practice run, progressive hints, and **Submit solution**.
  - In a challenge, the toolbar's Run becomes "Practice run": it runs the benchmark (traffic and duration are shown and locked) without recording an attempt.
  - The canvas offers "Restore starter architecture" (with confirmation). Given systems cannot be deleted, and their locked settings are read-only.
- **Results dialog** (opens after submitting):
  - a PASS/FAIL verdict and points on the first solve;
  - the criteria checklist with measured value, requirement, result, explanation, and change since the previous attempt;
  - a performance summary (p50/p95/p99, successful vs offered throughput, error rate) and component utilization;
  - bottlenecks, validation issues, and advice for each failed criterion;
  - actions: Try again (keeps the architecture), Inspect benchmark run (the graded run is loaded for playback and metrics), All challenges.
- The challenge list and results dialog are lazy-loaded, which keeps the main bundle under Vite's 500 kB warning.

### Engine extensions (opt-in, inert when unused)

- `trafficDurationMs`: arrivals stop early and the run continues so work can drain. Offered requests and successful throughput use the traffic window.
- `faults`: scheduled outages. Any request offered to the component during `[startMs, endMs)` fails as `unavailable` ("unavailable (scheduled outage)"). These are passed with the benchmark and are not part of component configuration.
- Workers forward each processed job to their first request-carrying connection; with no such connection the job completes at the worker, as before. Any delivery failure of a job (at the worker or downstream) uses the existing redelivery and dead-letter logic. The validator and the Worker's catalog contract were updated to match.
- Before removing the copy of the previous engine, I checked that outputs were identical (exact `toEqual`, including logs) across 64 configurations, including graphs with the new components, DLQ redelivery and job timeouts, when these features are unused.

### Tests

- `npm run typecheck`: passed (also clean with `--noUnusedLocals --noUnusedParameters`).
- `npm test`: 68 tests passed.
  - Engine: 11. Components: 20, including 3 new for the traffic window, outages, and job forwarding with retries through an outage. Playback: 13. Validation: 11.
  - Grading (9):
    - every starter fails and every reference solution passes, with two distinct designs for Slow API, Cache It Right and Protect the Ledger;
    - grading is deterministic;
    - boundary values: for every criterion with a measurement, each comparator is checked exactly at the threshold, and just past it fails;
    - measured values, thresholds and margins are reported;
    - invalid or incomplete runs never pass: empty architecture, no result, event limit hit, wrong workload, disconnected client;
    - unsupported metrics: informational ones don't block a pass, mandatory ones do;
    - mere presence fails: a bypassed or misplaced cache, an idle rate limiter, an unwired queue/worker, queues without retries, a synchronous design for the async challenge;
    - the grader ignores user edits to locked settings and the toolbar, and caps cheat values;
    - given systems and compute-budget checks.
  - Progress (4): save/reload/corrupt storage and a failing write; attempted vs solved; best-attempt ordering; tier unlocking and points.
- `npm run build`: passed, with no chunk-size warning.
- Scripted checks in headless Chrome (puppeteer-core in a scratch directory, not a project dependency), all with no console errors:
  - Challenge flow, 21 checks:
    - list, locking, search;
    - opening a challenge with the starter and the locked workload;
    - a practice run previews the criteria without recording an attempt;
    - a FAIL submission, with checklist and bottlenecks, recorded as attempted;
    - Try again keeps the architecture;
    - the locked compute cost in the inspector;
    - a PASS (+100) with comparison to the previous attempt;
    - Medium unlocks;
    - progress persists across reload, and the draft is restored;
    - returning to Design restores the design canvas;
    - given systems cannot be deleted and their settings are locked.
  - The earlier suites still pass: design/simulation 35/35, validation 27/27.
- I reviewed screenshots of the challenge list (dark and light), the workspace, the PASS results, and the FAIL results (light).

### Limitations

- Traffic is constant-rate with evenly spaced arrivals. There are no ramps, bursts or random arrival patterns, so challenges are calibrated to steady load.
- Outages reject only requests offered during the window. Work already in progress or queued at the component is unaffected, and there is no partial degradation (only up or down).
- The "Exactly once" criterion is listed as unsupported: the simulator has no idempotency or duplicate-delivery model.
- Thresholds were calibrated against this engine's deterministic behavior (seeded randomness only for cache hits, WAF, DNS and NoSQL mixes). They describe the simulator, not production guarantees.
- Progress, drafts and points are stored only in this browser. Clearing site data resets them, and there is no account or sync.
- Practice runs and submissions run the same benchmark, so a practice run predicts the grade exactly. Only submissions are recorded.

## 2026-10-19 — Architecture validation and expanded component library

### Validation and dead-component detection

- New `src/app/validation.ts` (replaces `graphChecks.ts`). It computes routes from the engine's own routing predicates (`carriesRequests`, `COMPUTE_KINDS`, `CACHE_KINDS`, `MESSAGING_KINDS`, `FORWARDING_KINDS`, exported from the engine). It then runs reachability from every Client over the routes the configuration makes possible, and applies per-component rules.
- Every component gets one of three statuses, each with explanations:
  - **Functional:** reachable from a Client and able to process traffic.
  - **Warning:** connected but misconfigured or partly bypassed, for example:
    - a connection the engine never uses ("only routes to its first connection");
    - an unparseable or out-of-range value;
    - a 0% hit ratio;
    - min tasks above max tasks;
    - a Worker fed directly instead of through a queue;
    - a cache with nothing behind it;
    - a telemetry sink nothing reports to.
  - **Dead:**
    - disconnected or unreachable;
    - a Client, Load Balancer, Message Queue/Event Stream or forwarding component missing a required connection;
    - configuration that makes a component unusable (WAF blocking 100%, rate limiter admitting nothing);
    - a downstream that the configuration cuts off (cache 100% hit, read share 0%, WAF block 100%);
    - no Client at all.
- Optional components are not flagged as dead just for existing. A DLQ connected from a queue with a Worker is functional even if nothing fails. Observability components are never dead; they are visual-only.
- Validation runs again on every change to components, connections or configuration (memoized on the simulation input). It never reads simulation results.
- Fixes are offered where unambiguous: remove a connection or component, reset a value to its default, or add the missing downstream (Load Balancer, Application Server, Worker, origin or database). Every fix needs a second, explicit "Apply" click; nothing changes the architecture on its own.

### Visual status

- Nodes:
  - functional: a small teal dot;
  - warning: an amber badge and border tint;
  - dead: a red-grey badge, dashed border and muted content;
  - visual-only: a dotted border and a "Not simulated" label.
  Hovering the badge lists the issues.
- Connections:
  - unused: dashed, with the reason as a tooltip;
  - telemetry: dotted;
  - dead-letter: dash-dot.
- The canvas header shows a validation summary (functional, warning and dead counts) and a "Show issues" toggle. The toggle highlights affected components and connections and dims everything else.
- Inspector:
  - the component view shows a Validation section with issues and fixes, plus a Contract section (inputs, outputs, checks);
  - the connection view explains whether and why the connection carries requests;
  - the overview lists dead components and warnings, and selects a component when its name is clicked.

### Simulation integration

- Forwarding components with nowhere to send a request now **fail** it (`unrouted`, e.g. "loadBalancer has no downstream connection", "cache miss with no origin to forward to") instead of completing it. Previously such requests were counted as successes. This covers Load Balancer, API Gateway, Reverse Proxy, WAF, Rate Limiter, Circuit Breaker, DNS, and cache misses at Cache/CDN/Distributed Cache.
- New failure kinds with their actual cause: `blocked`, `rate-limited`, `circuit-open`, `throttled`. `result.failuresByKind` reports their counts. Request traces show per-step notes (cold start, resolver lookup, read/write, routed to replica), delivery attempts, and the dead-letter destination.
- Before a run, a review dialog lists dead components and warnings and explains their effect. The user can review the issues (which turns on highlighting) or run anyway. Once the user runs anyway, the same set of issues does not prompt again.
- Each run keeps the validation state it started with. The Metrics tab discloses it ("Run with architecture issues") separately from "Runtime failures by cause", which comes from the engine.

### Component library (25 components)

Each catalog entry defines inputs, outputs, simulated behavior, validation rules, and simulated versus descriptive fields. All numeric fallbacks come from the engine's `ENGINE_DEFAULTS`, so the UI and the engine cannot drift. Categories: Traffic & networking, Compute, Data, Caching, Messaging, Reliability, Observability.

| New component | Simulated behavior |
|---|---|
| DNS | A seeded `cachedPct` of requests skip the lookup; the rest pay `lookupLatencyMs`. Then forwards. |
| CDN | Edge hit ratio: hits end at the edge, misses go to the origin. |
| Reverse Proxy | Proxy latency, then round-robin across all upstreams. |
| WAF | Inspection latency; a seeded `blockRatePct` fails as `blocked`. |
| Serverless Function | A warm-instance pool: a request starts cold when every initialised instance is busy. Concurrency limit, with throttling (queue limit 0 by default). |
| Container Service | Capacity = tasks × slots. While requests wait it adds a task per `scaleOutDelayMs`, up to `maxTasks`. Utilization uses capacity over time; the peak capacity is reported. |
| NoSQL Database | A seeded write share uses the write latency, the rest the read latency. |
| Read Replica | The SQL Database routes its read share round-robin to connected replicas. This is recorded as a zero-length "routed" step at the primary. |
| Object Storage | First-byte latency + size ÷ throughput. |
| Search Engine | Base latency + shards × per-shard cost, on a thread pool. |
| Distributed Cache | Capacity = nodes × connections per node, with hit/miss routing. |
| Event Stream | Partitions = append capacity. Fans out one job to every connected Worker. |
| Dead-Letter Queue | Receives jobs that fail after a queue's or stream's final delivery (`maxDeliveries`, `redeliveryDelayMs`; the default of one delivery preserves earlier behavior). |
| Rate Limiter | Token bucket (`ratePerSecond`, `burst`); rejections fail as `rate-limited`. |
| Circuit Breaker | Counts the final outcomes of requests it forwarded in a rolling window. At the threshold (with the minimum request count met) it opens for `openMs` and fails requests fast (`circuit-open`), then closes. |
| Metrics Collector, Log Aggregator | **Not simulated.** Labelled as such everywhere; connections to them never carry requests, and they are left out of engine metrics. |

- The Load Balancer now also targets Container Service and Serverless Function. This is unchanged for architectures without them.
- Worker "retry" is now descriptive and points to the queue's Max deliveries. The SQL Database gains a read share, used only when replicas are connected. Engine-backed defaults keep the previous starting values, for example worker processing rate 100.

### Engine compatibility

- Before removing the copy of the previous engine, I checked that outputs were identical for the existing eight components across 64 configurations: four graphs, four traffic levels, two seeds, with and without `maxEvents`. Comparing all fields except the new `failuresByKind`, the only difference allowed was job-failure log wording on the queue graph. The dead-end change does not affect those graphs because every forwarding component in them has a downstream.
- `busyMs` now comes from each completion's recorded duration. For existing components this is the same number as before.
- Additive fields:
  - on spans: `note`;
  - on requests and jobs: `attempts`, `redeliveredAt`, `deadLetteredTo`;
  - on component metrics: `counters`;
  - on the result: `failuresByKind`;
  - exports: `ENGINE_DEFAULTS`, `GENERIC_DEFAULTS`, `param`.

### Tests

- `npm run typecheck`: passed (also clean with `--noUnusedLocals --noUnusedParameters`).
- `npm test`: 52 tests passed.
  - Engine: 11 (unchanged).
  - New component behavior: 17. Covers dead ends, telemetry, DNS, CDN, reverse proxy, WAF, serverless cold starts and throttling, container autoscaling, NoSQL, replicas, object storage, search, distributed cache, stream fan-out, redelivery and DLQ, rate limiting, and circuit breaking.
  - Playback: 13 (1 new, over the extended component set).
  - Validation: 11. Covers the sample, disconnected and unreachable nodes, incomplete paths, valid branching, optional components and observability, bypassed connections, configuration rules, messaging, a missing client, agreement with the engine's traffic-carrying connections, and catalog contracts.
- `npm run build`: passed.
- Scripted checks in headless Chrome (puppeteer-core in a scratch directory, not a project dependency) against `vite preview`:
  - **Validation workflow:** all 27 checks passed. Sample fully functional; disconnected component dead with explanation; review dialog and Escape; "Review issues" highlighting; fix confirmation and cancel; remove-component, remove-connection, set-config and add-downstream fixes; bypass detection; a 100% hit ratio cutting off the DB; run-anyway disclosure without re-prompting; the telemetry component; library categories.
  - **Client → Event Stream → Worker + DLQ built in the UI:** all functional; the run dead-letters jobs; no console errors.
  - **Earlier 35-check suite:** 8 of 8 runs passed after one test change. The test now hovers the timeline before clicking a row, because clicking during a re-render was a harness race.
- I reviewed screenshots of the review dialog, bypass warning, config-induced dead path, light-theme issues view, and stream/DLQ run.

### Limitations

- Validation is static and models the engine's rules. It does not predict overload (runtime timeouts and rejections show up only in results).
- A Message Queue still dispatches only to its first Worker (use an Event Stream to fan out). Ordinary components still forward only to their first request-carrying connection.
- Not simulated:
  - client-side DNS TTL expiry;
  - CDN/cache TTLs;
  - replica lag;
  - partition-key skew;
  - container scale-in;
  - serverless instance expiry (warm instances stay warm);
  - circuit-breaker half-open probes (the circuit closes fully after `openMs`).
- A job's failure during an attempt is recorded only for its final attempt; earlier failed attempts appear as redelivery times.
- Fix suggestions that add components place them to the right of the source and may overlap existing nodes.
- New nodes added by click still appear near the canvas center and can overlap.

## 2026-10-19 — Platform redesign and live request visualization

### UI changes

- Rebuilt the workspace UI. `src/main.tsx` was split into `src/app/` (state, catalog, model, theme, playback store, simulation runner, graph checks) and `src/components/` (toolbar, library, canvas, node, edge, inspectors, bottom panel, metrics).
- Design tokens in `src/styles.css` cover surfaces, borders, text, accent, status, component categories, edges and node states. Light and dark are tuned separately rather than inverted. Fonts: Geist and Geist Mono (Google Fonts), with system fallbacks.
- Theme toggle in the toolbar. A saved preference (`localStorage` key `flowzen-theme`, as before) wins. Otherwise the system theme is followed live until the user picks one. An inline script in `index.html` applies the theme before first paint. The canvas, React Flow controls and minimap, chart colors, and every panel read the tokens.
- Toolbar: logo, editable project name, library/inspector toggles, an HLD/LLD/Unified selector, traffic (slider plus numeric), duration, playback speed, Run/Run again, Pause/Resume/Replay, Reset, and the theme toggle.
- View modes now change the canvas. HLD shows names and categories only. LLD adds each component's simulated configuration (latency, capacity, queue limit, timeout). Unified shows live operational data during a run and configuration otherwise.
- Component library: search (Escape clears), category groups (Entry & routing, Compute, Storage, Messaging), click-to-add at the viewport center, keyboard Enter-to-add, and drag-to-add. Drops now use `screenToFlowPosition`, so they land under the cursor at any zoom or pan. A detail area explains how the simulator models the hovered or focused component.
- New node design: fixed 228 px width, Lucide icon tinted by category, name, category and kind line, configuration or live line, a busy-slot meter, left target and right source handles, a selected ring, and six state treatments (idle, processing, near capacity, queued, saturated, failing).
- Contextual right inspector:
  - Component: live state, run totals from the engine, and properties split into "Simulation parameters" (with units and invalid-number warnings that name the fallback the engine will use) and "Descriptive — not simulated".
  - Connection: whether the engine routes over it, plus recorded transition counts.
  - Overview: category counts and routing checks.
  - Request trace.
  The inspector opens when something is selected. Selecting a component, connection or request opens it, and it starts closed so the sample architecture fits at a legible zoom.
- Collapsible bottom panel with Timeline, Requests and Metrics tabs and a playback scrubber (seek and rewind).
- Canvas overlays: zoom in/out, fit view, load sample, clear canvas, overview-map toggle, a collapsible legend, an empty state, and a banner when the architecture or traffic changed after the last run.
- Sample architecture: Web & Mobile → Load Balancer → Checkout API A/B → Session Cache → Orders DB, plus Order Events → Fulfilment Queue → Fulfilment Worker. The API Gateway was dropped from the sample (it is still in the library) so the main path fits the canvas at ~0.73 zoom on a 1440 px screen. Default traffic is 400 rps at 0.1× playback.

### New behavior

- Live request animation (`src/components/FlowEdge.tsx`, `src/simulation/playback.ts`):
  - Particles travel along the actual React Flow edge paths. Positions come from the engine's recorded transition timestamps and the playhead's simulated time.
  - Particle styles: request, after a cache miss, queue→worker job, and selected request.
  - Outcome rings at the target component: succeeded, cache hit, rejected/unroutable, timed out, unfinished.
  - Particles are drawn imperatively from a playback store, so animation never re-renders React Flow or touches simulation data.
- Playback is driven by the existing `SimulationClock` on `requestAnimationFrame`. Run, Pause/Resume, Reset, seeking and speed changes (0.02×–10×, applied live) all move the same simulated playhead. Pausing freezes particles and component states.
- Component states and counters come from recorded spans at the playhead:
  - busy slots / capacity and waiting / queue limit;
  - succeeded, failed and timed out per component;
  - cache hit percentage;
  - jobs dispatched;
  - requests sent per client.
  State rules are shown in the legend and in tooltips.
- Request inspector: final outcome, status at the playhead, arrival and end times, end-to-end latency, total queue wait and processing, cache result, failure kind and component, and a per-component waterfall (queue wait hatched, processing solid, playhead marker). It also links to the dispatched worker job (or the originating request), with "Replay from arrival" and "Jump to end".
- Requests open from timeline events, particle clicks, or the Requests tab (filters: in flight, failed, timed out, succeeded, all arrived).
- Bounded timeline: the latest 60 events at or before the playhead, from a time-sorted index of all recorded events. The list holds still while hovered or focused.
- Metrics tab:
  - Engine run totals: p50/p95/p99, successful throughput, error rate, cache hit ratio, and the early-stop warning.
  - Live counts at the playhead.
  - A Recharts line chart of offered, succeeded, rejected and timed-out requests per second up to the playhead, with glyph-labelled legend and tooltip.
  - A per-component engine table: utilization, completions, rejections, max queue, average wait.
- Routing checks (`src/app/graphChecks.ts`) follow the engine's routing rules. They flag missing clients, client/load-balancer/queue routing gaps, connections the engine will not use, worker outgoing connections, and components unreachable from any client.
- Simulations run in a Web Worker (`src/simulation/worker.ts`), falling back to the main thread if a worker cannot start. The Run button shows "Simulating…", and engine errors appear as a dismissible alert.
- Panels, banner and tabs have visible focus rings. React Flow keyboard selection and Delete/Backspace removal work. Under `prefers-reduced-motion`, particles are replaced by a static in-transit count on each connection, outcome rings do not expand, and transitions are disabled.

### Engine changes (targeted; semantics preserved)

- **Performance:** `schedule()` re-sorted the whole pending-event array on every insert. It now uses a binary min-heap with the same `(at, seq)` order. Before deleting the copy of the original engine, I checked that outputs were identical across 48 configurations (load balancer, cache, timeout and multi-client graphs; four traffic levels; two seeds; with and without `maxEvents` truncation). 1,000 rps × 10 s went from ~19 s to ~0.24 s; 10,000 rps × 60 s takes ~1.6 s.
- **Bug fix:** worker job records took the id `requests.length`, so later client arrivals overwrote them. Client requests then picked up worker spans and wrong latencies. Jobs now have negative ids in a separate `result.jobs` array, with `parentId` and `destination`.
- **Bug fix:** worker `busyMs` (and therefore utilization) used the 30 ms default latency instead of the actual `1000 / processingRate` job duration.
- **Additive fields:**
  - on `RequestRecord`: `origin` (client), `failedAt` (component), `failureKind` (`timeout | rejected | unrouted | unfinished`);
  - on `ComponentMetric`: `queueLimit`;
  - on `SimulationResult`: `jobs`.
- `src/simulation/visualization.ts` is replaced by `src/simulation/playback.ts`. The new module indexes requests and jobs into time-sorted typed arrays, so per-frame queries are binary searches (~0.05 ms per frame at 10k rps). Its tests were ported and extended.

### Catalog changes

- The client's `requestsPerSecond` default was removed. The engine ignores it because the toolbar traffic is always passed.
- Engine knobs that were previously hidden (`concurrency`, `queueLimit`, `timeoutMs`) are now exposed with defaults equal to the engine's fallbacks, so results for the same graph do not change.

### Dependencies

- No new dependencies. Recharts (already a dependency, previously unused) powers the metrics chart and is lazy-loaded with that tab.

### Limitations

- The engine treats network transitions as instantaneous. Each particle travels during a fixed ~450 ms wall-clock window that ends exactly at its recorded arrival time. The "failing" highlight lasts ~650 ms of wall time. Both are visual-only.
- At most 28 particles and 12 outcome rings are drawn per connection. Denser traffic is sampled evenly, and the selected request is always kept.
- The engine detects a timeout only when a queued request would start, so recorded waits can exceed the configured timeout. The trace shows the recorded wait.
- State thresholds are display rules over recorded data: near capacity ≥ 80% of slots (with more than one slot), saturated when the backlog is ≥ 10% of the queue limit, failing after a rejection, timeout or unroutable request in the last ~650 ms of playback.
- Engine limits are unchanged: ordinary components route to their first connection, worker retries and cache TTL are not simulated, the gateway rate limit is not enforced, and runs use the fixed UI seed 42.
- Architecture, project name and results are still in-memory only (the theme is the only persisted preference).
- The layout targets desktop and laptop widths (minimum 1024 px).
- The Reliability & observability category has a design token but no simulated components yet.
- Reset now clears simulation results and returns to design mode. Restoring the sample moved to the canvas "Load sample architecture" button.

### Verification

- `npm run typecheck`: passed.
- `npm test`: 26 tests passed. Engine: 11 (3 new). Playback: 12. Graph checks: 3.
- `npm run build`: passed. The worker and metrics panel are separate chunks; there is no chunk-size warning.
- Scripted checks in headless Chrome (puppeteer-core installed in a scratch directory, not a project dependency) against `vite preview`. All 35 checks passed with no console errors:
  - sample loads;
  - run;
  - playback rate at 0.1× and 1×;
  - pause freezes the playhead and particles;
  - live speed change;
  - scrubber seek;
  - timeline event, Requests-tab row and particle click each open the trace;
  - metrics chart renders;
  - node selection;
  - property edit shows the stale banner, an invalid number shows a warning, and reverting the edit clears both;
  - Reset;
  - click-to-add, keyboard Enter-to-add, and drag-to-add (synthetic DataTransfer events through the real handlers);
  - search;
  - connecting handles with a mouse drag;
  - routing checks;
  - Delete key;
  - HLD/LLD;
  - panel collapse;
  - theme toggle, persistence across reload, and the system default;
  - reduced motion;
  - 10k rps × 60 s run with loading state, at 59 fps during 1× playback.
- I visually reviewed screenshots of both themes: running, overloaded/failing, timeout trace, component inspector, metrics, LLD, HLD and the empty canvas.
- Not checked: Firefox and Safari, real-pointer native drag-and-drop, screen-reader output, and screens narrower than 1440 px.

## 2026-10-19 — Live request observability

### Added

- A trace-driven visualization adapter in `src/simulation/visualization.ts`. It converts recorded engine request spans into a bounded chronological timeline, live component state snapshots, active graph edges, and selectable request traces.
- Playback-driven React Flow edge animation using actual transitions between recorded component processing spans. Animation only reads simulation output and never changes it.
- Live node labels and state indicators for idle, processing, queued/saturated, near capacity, and failed conditions. Active request count and queue count are calculated from traces at the current simulated timestamp.
- A keyboard-accessible timeline of the latest 40 played events. Each event opens the related request trace.
- A request inspector that presents actual arrival and completion timestamps, measured latency, component spans, queue waiting time, cache result, and failure reason. Missing data is shown as unavailable.
- Additional visualization tests covering bounded timeline creation, trace selection, live component state, transition animation data, and failed traces.

### Behavior and limits

- The event timeline is bounded to 250 stored events and 40 rendered playback events.
- React Flow shows active edges during an observed transition. Individual request particles are not rendered, which keeps high-rate simulations responsive.
- The existing simulation run completes deterministically before its results are played back. Playback is a read-only visualization of simulated time.
- Animation respects `prefers-reduced-motion` by disabling edge motion.

### Dependencies

- No additional runtime dependencies.

### Verification

- `npm run typecheck`
- `npm test` — 13 tests passed
- `npm run build`

## 2026-10-19 — Deterministic discrete-event simulation

### Added

- A standalone TypeScript simulation engine in `src/simulation/engine.ts`, independent of React and the canvas.
- Deterministic request generation using a seeded linear congruential random generator.
- Event-driven request lifecycle tracking: arrival, processing start and completion, queue wait, routing, cache outcome, completion, failure, and measured end-to-end latency.
- Graph-respecting routing. Client requests only travel through connected edges; a missing destination, load balancer application target, or queue worker produces a measured request failure.
- Load balancer routing across connected application servers, processing and queue limits for application servers and databases, configurable timeouts, cache hit/miss routing, and queue-to-worker processing.
- Finite queues and maximum event protection to bound overload work. Rejected requests identify the queue-full or timeout cause.
- Measured metrics for offered requests, completed and failed requests, successful throughput, error rate, p50/p95/p99 latency, cache hit ratio, component utilization, queue depth, and average queue wait.
- Run, Pause/Resume, and Reset integration in the existing toolbar, with traffic, duration, and playback speed controls. Playback time is only a view of simulated time and does not alter engine results.
- Vitest and eight automated engine tests in `src/simulation/engine.test.ts`.

### Behavior and limits

- One simulation run uses a fixed seed (`42`) from the UI for repeatable results. The engine accepts other seeds for programmatic experiments.
- The simulator selects the first connected target for ordinary components. Load balancers round-robin among directly connected application servers.
- Queue workers run asynchronously; the request that successfully enqueues work completes at the queue, while worker work is represented in component measurements.
- HLD and LLD selectors remain visual workspace modes; execution semantics are unified-only in this milestone.
- State is still local to the browser session and simulation event details are retained in memory only.

### Dependencies

- Added `vitest` for automated TypeScript simulation tests.

### Verification

- `npm run typecheck`
- `npm test` — 8 tests passed
- `npm run build`

## 2026-10-19 — Core design canvas MVP

### Added

- Vite, React, and TypeScript application scaffold.
- Dark-themed Flowzen workspace with top toolbar, component library, architecture canvas, properties sidebar, and bottom status panel.
- React Flow canvas with a subtle grid, overview minimap, connection handles, selectable nodes, node movement, edge creation, and component deletion.
- Eight infrastructure components: Client, Load Balancer, API Gateway, Application Server, Cache, SQL Database, Message Queue, and Worker.
- Click-to-add and drag-to-add component actions, each with a distinct icon and default configuration.
- Editable component name and configuration fields in the properties sidebar.
- A resettable sample architecture: Client → Load Balancer → Application Server → Cache → SQL Database.
- HLD, LLD, and Unified view selection controls, plus adjustable traffic input.
- Start-fresh action for an empty architecture.

### Behavior and limits

- Run and Pause remain disabled because simulation is not implemented yet.
- Performance cards intentionally display no measurements; no simulated metrics are fabricated.
- State is local to the browser session. Projects, component configurations, and diagrams are not persisted.

### Verification

- `npm run typecheck`
- `npm run build`
- `npm run dev`
