# JobLens Eval Harness

Runs the JobLens pipeline against fixture data and produces a scorecard.

## Usage

```bash
# Offline (default) — no LLM calls, uses existing test_output JSONs
python -m engine.joblens.eval.runner

# Live — calls the real LLM for JD breakdowns, then compares to test_outputs
EVAL_USE_LLM=1 python -m engine.joblens.eval.runner
```

Both modes write `engine/joblens/eval/scorecard.json` and print the scorecard to stdout.

## What it measures

### JD Breakdown
- **schema_pass_rate** — fraction of outputs that parse cleanly against `JobDescriptionBreakdownResult`
- **avg_field_recall** — fraction of non-null fields in the expected output that are also non-null in the actual output
- **avg_primary_skills_recall** — fraction of expected `primary_skills` names found in actual output (case-insensitive)
- **avg_responsibilities_recall** — fraction of expected responsibilities found in actual output (substring match)

### Match
- **schema_pass_rate** — fraction of outputs that parse cleanly against `JobMatchResult`
- **score_in_range_rate** — fraction of outputs where `total_score` is in [0, 100]
- **avg_action_count** — average total resume actions (update + replace + delete) per fixture
- **avg_gap_coverage** — fraction of `biggest_gaps` items referenced in at least one action's `reason` or `jd_alignment`
