# 0032. Canvas: one Sandbox image, one Sandbox per Owner, and a local runner for development

Date: 2026-11-19. Status: accepted, with one part untested in production (see below).

## Context

The Analyst queries about a million rows of synthetic open data with DuckDB and may run Python over the results. That work belongs in Vercel Sandbox with no network (ADR 0022). Loading the data takes tens of seconds, so it cannot happen per Question.

## Decisions

**1. One image, built once.** `server/sandbox/image.ts` builds a microVM with the network on: installs DuckDB and numpy, loads every Catalog Table from the generator (`domain/data/`) into `/data/meridia.duckdb`, installs the runner, adds the unprivileged user `analyst`, and takes a snapshot. The snapshot id is stored in `canvas.sandbox_images` under a key made of the data version and the runner version, claimed by one request so two do not build at once. It holds only synthetic data, so every Owner shares it.

**2. One Sandbox per Owner, from the image, with no network.** `server/sandbox/session.ts` finds or creates `canvas-<hash of owner>-<hash of image key>` with `networkPolicy: "deny-all"`. Everything the server asks of it is one job for `runner.py` (`runner-source.ts`): one command, one JSON answer. The runner opens the Catalog read-only, switches external access off and locks the configuration. The Analyst's code runs as `analyst` through `runuser`, with a timeout and no read access to `/data`; its inputs are Parquet files written from guarded SELECTs, so a Restricted column reaches code only aggregated.

**3. A local runner, for development and e2e only.** When `CANVAS_LOCAL_RUNNER` names a Python that has DuckDB, and the process is neither on Vercel nor in production, guarded Queries run on the server's own machine with the same `runner.py` and the same read-only, locked connection (`server/sandbox/local.ts`). It is not a sandbox, so it refuses `run_code` outright. It exists because the Vercel account's Sandbox quota can be exhausted (it was on the night this was built: snapshot storage on the Hobby plan), and the rest of the demo should still be developed and tested.

## What was verified, and what was not

- In a real Vercel Sandbox, before the quota ran out: the runner's operations (parse, guarded query, code as the unprivileged user, upload import, timeout), that `analyst` cannot read `/data` or use sudo, that `deny-all` blocks the network, and snapshot and restore timings (about 4 s to snapshot, under 3 s from snapshot to first command).
- With the local runner: the whole demo end to end, including the e2e suite and one Question to the real model.
- Not verified: the image build and the per-Owner Sandbox path as wired in `image.ts` and `session.ts`, because Sandbox creation was refused with HTTP 402 for the whole account. Until the quota is freed the deployed demo answers "Sandbox unavailable", as the Harness's and Sieve's sandboxes do. The first Question after that builds the image (a minute or two) and should be watched.

## Not built in this version

Boards with a durable Refresh workflow, scheduled refresh, export, and bring-your-own CSV or Parquet. The migration already creates their tables and the private `canvas` bucket (additive, unused), so adding them needs no further migration.
