Durable acceptance runner (local test infrastructure, not app UI)

Use only with an already-authorized local bridge and test database. The runner
never manages credentials, starts provider services or retries paid requests.
Each run needs a NEW output directory. If that directory has a status receipt,
run refuses to replay even after failure. Inspect status and recover SQLite
before deciding whether a NEW user-directed continuation is needed.

python3 scripts/acceptance/runner.py run --db /path/test.db --deck-id deck_id \
 --prompt-file /path/brief.txt --output /path/new-run --timeout 420
python3 scripts/acceptance/runner.py status --output /path/new-run
python3 scripts/acceptance/runner.py recover --db /path/test.db \
 --deck-id deck_id --output /path/recovered-deck.json

Use the start subcommand with the same run arguments to launch an independent
worker and return immediately. Collect with status/recover; start also refuses
a duplicate output directory. The worker survives the launching shell ending,
but container teardown still makes its receipt uncertain.

Launch in an environment that retains the process for the full operation, not
under a90second outer shell. A scheduler/supervisor can collect status later.
The timeout is a per-socket idle limit. --deadline (default900seconds) is the
overall run bound; on expiry completion becomes uncertain and SQLite is recovered.
Closing a test connection is not evidence that a remote paid request was canceled.
Production requests have300second per-request timeout. Use a bounded turn count
and an explicit overall test budget, with no automatic replay on unknown exit.
When render_review is enabled a real UI renderer must be connected. Otherwise
use a no-render focused structural test and inspect actual output separately.
Never synthesize a render result or claim vision was exercised without pixels.

Receipts contain state and deck hashes, not credentials or private transcripts.
Deck snapshots can contain user content; keep outputs private and outside source.
Local tests: python3 scripts/acceptance/test_runner.py

Deadline protection has an independent wall-clock supervisor in addition to the
main-thread alarm. --owned-service-pids can name a PRIVATE JSON list of process
GROUP leaders created specifically for this test (never unrelated processes).
On completion/error/deadline those groups receive SIGTERM after SQLite recovery.
The runner does not discover arbitrary processes or claim remote cancellation.
The blocked-SIGALRM fixture verifies watchdog settlement and owned-group cleanup.
