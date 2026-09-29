# Shop-support pilot — 2026-09-29

This local pilot validates the evaluated-routing and preparation-payback flow against the saved shop-support demo. It uses real provider calls and development Convex persistence. Codex inspected the complete answers and saved explicit Pass/Fail labels against the configured document-based criteria. These five cases are a small demo sample, not production quality evidence or a calibrated judge.

## Configuration

The graph uses Start → Jev Choice → Model, with return and support branches reaching the same model. Both demo documents, the selected `customer_tier=vip` field, retrieval, query-aware context, and conditional instructions are enabled. The candidates are GPT-6 Luna and Gemini 3.8 Flash at Low reasoning, with a 1,400-token output ceiling. The pilot gate requires five distinct request cases, every attempt reviewed, at least 95% pass, and full-turn p95 at most 20,000 ms. Preparation requires optimistic savings of at least 1.1 times its cold estimated cost.

The pilot used a continuing conversation containing earlier demo turns. Case identity includes the submitted history and Start values. It does not establish a paired comparison between two successful candidates. For that comparison, use identical fixed inputs and history as described in [the evaluation suite](shop-support.md).

## Reviewed Luna cases

The revised VIP instruction explicitly offers employee priority for each current request requiring an employee. Changing that instruction created a fresh evidence profile; the earlier delivery answer that omitted the offer remains a failed observation under its original profile.

| Case | Review | Estimated complete-turn cost |
| --- | --- | --- |
| Unused item received ten days ago, opened transport box, refund timing | Pass: fourteen-day conditions, packaging exception, five-working-day processing after acceptance, bank timing uncertainty, priority without approval promise | $0.00067034 |
| Defect discovered after use and return shipping | Pass: defect exception, shop pays shipping, photos and employee review, priority | $0.00065399 |
| Custom-made nondefective item and VIP exception request | Pass: ordinary return excluded, VIP does not override conditions, employee priority | $0.00072033 |
| Address change after carrier handoff and city delivery time | Pass: carrier coordination, two to three working days, priority without acceleration promise | $0.00068340 |
| Short continuation: “А завтра точно успеют? Я VIP.” | Pass: retains delivery context, no exact-date promise, employee priority | $0.00066025 |

Saved evidence: five distinct cases, five of five reviewed, 100% empirical pass, full-turn p95 7,799 ms, estimated cost per passing answer $0.00067766. Each turn included five provider calls: the Jev decision, retrieval embeddings, reranking, and generation. Costs use API-reported usage and configured published rates; they are estimates, not billing receipts.

## Gemini and automatic routing

Selecting Gemini initially reset reasoning to Medium, so that failed trial belongs to a separate strategy. After restoring Low, the matching-configuration trial also returned the provider's high-demand error. It settled as failed in 6,991 ms, with one reviewed case, no passing answers, and unknown complete-turn cost because the failing call reported no usage. Pass is disabled for the failed turn. Its report also showed the five qualifying Luna cases.

Switching to automatic mode retained the Low strategy's evidence. A subsequent delivery-price follow-up selected Luna, excluded Gemini for too few distinct cases, and answered without inventing a VIP free-delivery benefit. The plan projected $0.00087124 per complete passing turn; the completed turn's ledger estimated $0.00062105. No successful comparative quality or cost conclusion about Gemini follows from this failed trial.

The preparation decision was `retain-full`: cold estimated cost $0.00119743 versus optimistic generation savings $0.00027740. The turn retained selected retrieved context and made no summary or adequacy calls. Retrieval remains independently configured and its calls remain in the ledger. VIP instructions were active and return-specific instructions inactive on this support branch.

## Verification boundary

The graph settings, reviews, answer and planning trace were restored from development Convex after browser reload. The recorded-answer selector also reopened the earlier delivery reply with its own criteria and review, without changing the latest turn's plan. Automated validation passed 140 tests, TypeScript, Lat, Konsistent, Biome and the production UI build. Controlled tests cover competing qualifying routes, mismatched cases, missing usage, failed and abandoned turns, owner and conversation isolation, historical review of final replies, cancellation, and preparation economics. Production deployment, commit and push were not performed.
