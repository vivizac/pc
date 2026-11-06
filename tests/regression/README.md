# Local full regression audit (Node 24)

This runner discovers every `*.test.cjs` below the root, PC and Mobile test directories. It does not exclude historical failures. A failed, timed out or incomplete suite produces a nonzero exit. A green focused CI job is not a full-regression pass.

Install the checked-in test and application dependencies first:

```sh
npm ci --prefix tests/shared-chat --ignore-scripts
npm ci --prefix tests/tuition --ignore-scripts
npm install --prefix apps/mobile --ignore-scripts --package-lock=false
npm install --prefix apps/pc --ignore-scripts --package-lock=false
npx --prefix tests/shared-chat playwright install chromium
node --test tests/regression/runner.test.cjs
node tests/regression/run.cjs --compare HEAD --normalize-eol --out ../regression-evidence
```

Use a fresh output directory outside the source checkout. `--compare` accepts a local Git ref; without it only the working tree is tested. `--suite root|pc|mobile` limits discovery explicitly. Default is `all`. `--normalize-eol` normalizes text in both evidence snapshots, leaving the checkout untouched. This avoids historical LF-sensitive source assertions depending on Windows checkout settings.

The baseline comes from `git archive`; the current snapshot includes tracked and untracked, nonignored files. Installed dependencies are copied into the snapshots. Shared runtime files are staged only in isolated app snapshots, after root tests. The application credentials matching the denylist in `cleanEnv` are removed from child environments. Run in a local test shell with no production credentials; tests must mock external services. This is not a network sandbox or an integration test against hosted Supabase.

Each suite writes JSONL results and `summary.json` records the Git base, Node version, counts, skips, failures and diagnostics. The Node [custom reporter API](https://nodejs.org/docs/latest-v24.x/api/test.html#custom-reporters) preserves exit status; large assertion excerpts are truncated only in the report. File-level bootstrap failures stay visible. A syntax repair may expose multiple previously unexecuted tests, so compare test identities and bootstrap diagnostics as well as totals.

The broad audit remains separate from focused regression checks. Existing source-layout assertions require investigation against the current product contract before they can be rewritten. Do not remove, skip, or restore historical UI simply to turn the audit green.
