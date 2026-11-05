# QA log

Dated records of test runs and reviews, kept in git so the history of each check can be read later. The
[QA strategy](../qa-strategy.md) says which risks each check targets.

- `YYYY-MM-DD.md`: one report per run of the monitor (`.claude/agents/playwright-test-monitor.md`) or per
  mutation or flakiness run read by hand. Each report gives the commit it ran on, the commands, the counts
  they printed, links to the GitHub Actions runs, each failure and its classification, and any test removed
  or merged with the test that now covers it.
- [`reviews.md`](reviews.md): each pull request that has a commit fixing review findings.
- `reviews/`: saved review documents, named `pr-<number>-review.md`.

| Report | Commit |
| --- | --- |
| [2026-11-05](2026-11-05.md) | f1bd49c |
