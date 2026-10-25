# Push preview history reconciliation (no push performed)

Live public main checked by GitHub API and git fetch during this run:
`8704c410353a03ccbb5a9cf92f8369d15ad62e8c`.

Observed source URLs:
- https://api.github.com/repos/ahmdd4vd/desel/commits?per_page=8
- https://github.com/ahmdd4vd/desel.git
- https://api.github.com/repos/ahmdd4vd/desel/commits/59d8202

The last URL returns no commit for SHA 59d8202, as expected for an unpushed local
commit. This does not mean that local commit never existed.

The provided original checkpoint archive has no .git. Its tree is attributed by
its sender to local commit 59d8202 on top of pushed 8704c41. The continuation
archive's first commit is a separate root, 0d77105. It has no common ancestor with
live main. Comparing the original checkpoint's bytes against 0d77105:

- 343 tracked files identical.
- Five files differ: scripts/test-editor-contracts.mjs, src-tauri/src/creator.rs,
  src/App.tsx, src/components/Canvas.tsx, src/lib/creator-workspace.ts.
- One file added in 0d77105: src/lib/chat-branches.ts.
- No extra file in the original checkpoint.

The five deltas add selected-object context in canvas/chat/scope validation and
branch contract tests. The added file is the branch data structure. These are
plausible intervening local work, but tree content cannot prove the missing later
commit's original identity, message, parent, author or timestamp. No invented
history is being claimed.

An eventual integration should use the exact reviewed final tree as a squashed
commit on the verified live main, or recover the user's real original history
before deciding a different strategy. Never force-push this unrelated root.
A squash preserves the final files but not the lost original local commit
lineage. Inspect the staged diff and re-run the needed tests after integration.
The user must see the preview and explicitly say Push before any remote write.
This report does not constitute approval to push or publish.
