# Repeatable evaluation

Versioned suites run owned cases through the normal API, retain every attempt, and report human-reviewed quality, latency, cost and decision calibration on separate dev and held-out test splits.

## Frozen suites

A suite fixes input cases, policy, expected decisions and provenance; effective duplicates are rejected across dev and test.

[[server/evaluation/dataset.ts]] validates a strict dataset of two to one hundred distinct cases, fixed graph/documents, expected decisions, case-specific answer expectations and label provenance. Duplicate effective inputs, including defaulted Start values, cannot span splits or inflate case counts. Supply your own dataset; no demo suite is bundled. Expected decisions and semantic expectations require independent human review before setting labels.status to owner-approved with reviewer and ISO reviewedAt. Dataset identity hashes version, graph, evaluation node and cases; approval metadata can change without rerunning paid execution, but approval must predate the run for held-out eligibility.

[[src/lib/evaluation-case.ts]] owns canonical frozen input identity. [[src/lib/evaluation-version.ts]] pins runtime, prompt, evaluator, retrieval and exact installed provider-SDK versions, verified by the behavior suite. Bump affected versions and update the SDK pin when dependencies or execution semantics move. [[src/lib/evaluation-candidate.ts]] changes only one allowed candidate model and validates its reasoning settings; replay and the harness share this projection. [[persistence]] owns registration, frozen saved-history selection and authenticated replay; [[routing]] owns execution bounds and provider failure policy.

## Execution and private checkpoints

Live trials require an owned session and explicit paid execution; private checkpoints preserve every attempted case.

[[server/evaluation/cli.ts]] exposes bun run eval. Every command requires --dataset FILE; the CLI has no implicit demo suite or model list. Live candidates come from the configured evaluation node's routing.models; --candidates may select an allowed subset in an explicit order. [[server/evaluation/trial.ts]] reuses [[src/lib/model-routing.ts]] for candidate validation and owns the shared repetition, trial-count and retained-error bounds consumed by execution and local labels. Validation and offline reports do not connect to providers. Live run requires explicit --live, an initialized owner workspace, VITE_CONVEX_URL, EVAL_CONVEX_TOKEN for that workspace's authenticated browser session, and a running local API (EVAL_API_URL defaults to localhost:5173). Supply the token through the environment or an ignored private local env file, never command arguments. The CLI does not create another identity or a database-free execution mode. Never share tokens or the captured request bodies publicly.

[[server/evaluation/runner.ts]] starts a fresh conversation per case, uses POST /api/route once and POST /api/replay for subsequent candidates/repetitions, retaining the original frozen inputs despite later messages. It executes sequentially under the normal active-run lock and two-minute deadline, with at most one hundred planned trials and one to three repetitions. Registration failure skips remaining paired trials for that case rather than guessing replacement inputs. Each attempt checkpoints its registered run, error and available evidence. A transport or collection failure stays unknown and can be inspected later; no implicit retry spends provider calls. The supplied benchmark graph never overwrites the editor graph.

[[convex/runs.ts]] exposes an owner-authorized settled-run inspector. [[server/convex-persistence.ts]] parses stored inputs, graph and reviews once at its boundary. [[src/lib/run-artifact-load.ts]] bounds browser and CLI artifact downloads to eight million bytes, validates UTF-8 and artifact structure, times out after thirty seconds and cancels incomplete reads. Local files are limited to 64 MB, created without overwrite with mode 0600 and replaced atomically during checkpoints. The gitignored eval-results directory contains sensitive owner evidence. Oversized checkpoints fail explicitly; settled artifacts remain in Convex.

```sh
# Set EVAL_DATASET to your versioned dataset JSON file path.
bun run eval validate --dataset "$EVAL_DATASET"
bun run eval run --live --dataset "$EVAL_DATASET" --split dev --out eval-results/dev.json
bun run eval run --live --dataset "$EVAL_DATASET" --split test --out eval-results/test.json
bun run eval collect --dataset "$EVAL_DATASET" --input eval-results/test.json --out eval-results/collected.json
bun run eval sources --dataset "$EVAL_DATASET" --input eval-results/collected.json --out eval-results/sources.json
bun run eval labels --dataset "$EVAL_DATASET" --input eval-results/collected.json --out eval-results/labels.json
# A human fills labels.json using case expectations and exact source quotes.
bun run eval report --dataset "$EVAL_DATASET" --input eval-results/collected.json --labels eval-results/labels.json --out eval-results/report.json
```

## Human review and reporting

Humans label criteria with exact recorded quotes. Reports preserve missing evidence and keep execution, resolution and reaction separate.

[[src/lib/quality-review.ts]] owns review limits, verdicts and the unassessed review constructor shared by [[src/flow/quality-review-editor.tsx]] and offline label templates. [[src/flow/quality-review-fields.tsx]] consumes the same limits as validation; the editor derives verdict and outcome options from the schema. Neither interface maintains a separate review contract.

[[server/evaluation/labels.ts]] exports source text and unassessed templates: every criterion starts insufficient-evidence, task and reaction start unknown, and reviewer starts empty. A human supplies their identity, execution-following review time, reasons and exact evidence references. [[src/lib/quality-review.ts]] verifies every criterion and quote, including reached paths, structured decisions, provider exchanges and later user messages. Execution completion, task resolution/handoff and user reaction remain independent. Local labels are trusted owner assertions for an offline report; they never write Convex routing approvals. Authenticated application review remains the authority for runtime routing in [[optimization]]. collect refreshes those owned reviews without paid calls.

[[server/evaluation/report.ts]] verifies dataset/strategy/current-version identity, candidate configuration, paired frozen inputs and credential scope. Missing trials, unavailable artifacts, expired reviews and unknown usage stay explicit; a failed or exhausted execution cannot pass. Every provider attempt contributes to full-turn cost, including failed attempts, preparation, relevance, backups and repeats. Any unknown cost makes aggregate cost and cost per passing route unknown. Full-turn p95 requires latency for every planned attempt. Repetitions increase attempts but never distinct cases. A complete comparison needs labels approved before execution, the held-out test split and all planned grades/costs; satisfying the configured case/pass-rate/latency policy is reported separately. Reports do not install routing approvals or alter the graph.

Decision labels refer to valid question outputs, including unconnected answers retained in a batch. Labels are unique per node/question, and report matching uses both identities even for batched Jev answers. Decision accuracy compares expected traversed branches with observed decisions. Calibration compares the original decision and its reported confidence to labelled correctness, separately from threshold fallback behavior. Reliability bins, mean squared confidence error, expected calibration error and threshold coverage/error tables describe the observed sample. Threshold rows use the suite's configured Jev thresholds, including the shared runtime default when omitted, sorted and deduplicated; model-only graphs have no threshold rows. Each model also reports decisionsByQuestion with the question name/type, threshold coverage/error, missing observations, and whether the gating measure is provider confidence or the chosen Noul answer probability. These question-scoped rows never mix another question’s threshold or observations. Failed evaluations remain missing observations even when an exhausted repeat replaces their provider-error status; the retained error detail distinguishes them from valid answers in an exhausted loop. There is no separate built-in threshold list. Explore thresholds on owner-approved dev data, freeze them before the test run, and never tune from held-out results. Confidence is not empirical accuracy, and a small suite cannot establish a production quality guarantee.
