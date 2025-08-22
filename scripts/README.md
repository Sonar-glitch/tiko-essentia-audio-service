Essentia scripts

- `essentia_flag_scanner.js` - find artistDocs where `essentiaProfileBuilt:true` but `essentiaAudioProfile.trackMatrix` is missing/empty. Usage:

  node scripts/essentia_flag_scanner.js --dryRun --limit 200
  node scripts/essentia_flag_scanner.js --clear --limit 500

- Staged vs Built flow
  - When the analyzer returns fewer than `maxTracks`, the batch now saves the partial profile and sets `essentiaProfileStaged:true` so future runs will resume and request additional tracks until `maxTracks` is reached.
  - Only when `trackMatrix.length >= maxTracks` will `essentiaProfileBuilt:true` be set.

- To run a canary batch run targeting 20 artists:

  node batch-artist-audio-coverage.js --limit 20 --appleFirst --maxTracks 5

Monitoring / Metrics
- The batch now emits short metric lines to stdout that are easy to parse from logs. Example lines:
  METRIC|essentia_write|success
  METRIC|essentia_write|staged
  METRIC|essentia_write|failure

  These are intentionally simple so your logging pipeline (Datadog, Splunk, Papertrail) can parse them with a single-line parser.

- Recommended ingestion:
  - Configure your log shipper to match lines starting with `METRIC|essentia_write|` and increment a counter for `success`, `staged`, or `failure`.
  - Also capture the JSON payload written at the end of a batch (between `===BATCH_COVERAGE_JSON_START===` and `===BATCH_COVERAGE_JSON_END===`) for richer aggregation.

Heroku Scheduler (recommended)
- Use the Heroku Scheduler dashboard to add a job that runs the scanner daily. Example:
  - Command: node scripts/essentia_flag_scanner.js --clear --limit 500
  - Frequency: Daily at 02:00 UTC (adjust as needed)

CLI method (optional):
- There's no official single CLI to create a Scheduler job; use the Heroku dashboard (Add‑ons > Scheduler) for clarity. Alternatively, you can script a detached run via:
  heroku run:detached --app tiko-essentia-audio-service "node scripts/essentia_flag_scanner.js --clear --limit 500"


