# Unattended backfill cron — Full Disk Access setup

The repo lives under `~/Documents`, which macOS protects with TCC. `cron` runs the backfill
scripts but cannot **read** files there until it is granted Full Disk Access, so scheduled runs
fail with `Operation not permitted`. This is a one-time grant.

## Grant Full Disk Access to cron

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Click **+**.
3. Press **⌘ + Shift + G** and paste: `/usr/sbin/cron`
4. Select `cron`, click **Open**, and make sure its toggle is **on**.
5. If prompted, quit & reopen System Settings (the change takes effect immediately for new cron runs).

Child processes (`bash`, `node`, `next`, `curl`) inherit cron's access, so nothing else needs a grant.

## Verify it worked

The federal detail job runs every 2 hours; the state job runs daily at 18:00. After the next
scheduled run (or wait for the top of an even hour), check:

```sh
tail -f logs/federal-detail-cron.log     # should show "Detailing from offset N", not "Operation not permitted"
cat scripts/.federal-detail-cursor        # should climb toward 17862
```

## The two jobs (already installed in `crontab -l`)

| Schedule | Script | What it does |
|---|---|---|
| every 2h | `detail-federal-bills.sh` | Details federal bills (actions/text/votes), resumable via cursor |
| daily 18:00 | `sync-states.sh` | Backfills the next queued state's legislators + roll calls |

## Caveat

Even with Full Disk Access, **cron does not wake a sleeping Mac** — a run scheduled while the
machine is asleep is skipped. Both scripts are resumable (cursor / queue), so a skipped run just
resumes next time; nothing is lost.

## Run manually anytime (no FDA needed — runs in your shell's context)

```sh
./scripts/detail-federal-bills.sh          # next 8 chunks of federal bills
CHUNKS_PER_RUN=60 ./scripts/detail-federal-bills.sh   # a bigger batch
./scripts/sync-states.sh pa il             # specific states
```
