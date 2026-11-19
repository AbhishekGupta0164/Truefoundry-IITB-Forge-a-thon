# Scorecard template (write-up section 6)

The write-up needs one row per judging criterion with the video timestamp where it is shown and a one-line claim. Fill the timestamps from the final recording (maximum 4:00) and claim only what the video shows. Where a behaviour sits between two anchors, the lower anchor applies.

| ID | Criterion | Pts | Video timestamp | One-line claim (what the video shows) |
| --- | --- | ---: | --- | --- |
| A1 | Inline edit | 10 | `m:ss` | |
| A2 | Agent mode | 10 | `m:ss` | |
| A3 | Streaming and cancellation | 10 | `m:ss` | |
| B1 | Context assembly | 15 | `m:ss` | |
| B2 | Diff safety | 10 | `m:ss` | |
| B3 | Resilience (Task C) | 10 | `m:ss` | |
| B4 | TrueForge integration | 10 | `m:ss` | |
| C1 | Video | 10 | whole video | Tasks A, B, C in order, each followed by its on-screen check |
| C2 | Write-up | 15 | — | |

What each row needs on screen (from the organizer rubric):

- **A1**: the diff rendered in the editor, accepted or rejected hunk by hunk.
- **A2**: Task B with no files named; the agent finds and edits three or more files.
- **A3**: tokens streaming in; a cancel mid-run, then `git status` showing no half-applied edits.
- **B1**: the context map during Task B: which files were read and why, against the budget.
- **B2**: per-hunk review, then an applied change undone.
- **B3**: Task C with a dead endpoint or invalid key: the editor stays responsive, a clear message or the fallback model takes over, `git status` shows no changes.
- **B4**: the TrueForge session for Task B (turns and tool calls), tool approval driving the review, deferred tool loading.

See the README "Judge scorecard" for what is built and verified per row.
