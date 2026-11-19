#!/usr/bin/env bash
# Is this pull request a Bank Growth pull request (docs/adr/0024)? Writes
# `growth=true|false` to $GITHUB_OUTPUT (or stdout) and says why.
#
# Used by .github/workflows/bank-growth-guard.yml (fail it if it leaves the
# bank) and .github/workflows/e2e-changed.yml (never run it with the app's
# secrets), always from the BASE branch's copy. It reads the pull request
# fresh from the API, not from the event payload, because a label can be
# added after the event fired.
#
# Growth when ANY of: the `bank:growth` label, a `bank-growth/` branch, or a
# title or body that refers to an issue carrying `bank:growth`. The third is
# a fact the routine cannot take back: the bank labels the issue, not the
# routine. It still rests on text the routine writes, so a routine that drops
# all three looks like an ordinary pull request; the review step is the
# backstop for that.
#
#   GH_TOKEN=… REPO=owner/repo PR=<number> scripts/growth-pr.sh
set -euo pipefail

: "${REPO:?}" "${PR:?}"
case "$PR" in '' | *[!0-9]*) echo "PR must be a number" >&2; exit 2 ;; esac

out="${GITHUB_OUTPUT:-/dev/stdout}"
pr=$(gh api "repos/$REPO/pulls/$PR")
growth=false
why="no label, branch or issue reference marks it"

if jq -e '[.labels[].name] | index("bank:growth")' <<<"$pr" >/dev/null; then
  growth=true; why="it carries the bank:growth label"
fi
case "$(jq -r '.head.ref' <<<"$pr")" in
  bank-growth/*) growth=true; why="its branch starts with bank-growth/" ;;
esac
if [ "$growth" = "false" ]; then
  # Every issue number the title or body mentions (#12, or a full issue URL).
  numbers=$(jq -r '(.title // "") + "\n" + (.body // "")' <<<"$pr" \
    | grep -oE "(#|/issues/)[0-9]{1,7}" | grep -oE "[0-9]+" | sort -un | head -20 || true)
  for number in $numbers; do
    labels=$(gh api "repos/$REPO/issues/$number" --jq '[.labels[].name] | join(",")' 2>/dev/null || true)
    case ",$labels," in
      *,bank:growth,*) growth=true; why="it refers to #$number, a bank:growth issue"; break ;;
    esac
  done
fi

echo "growth=$growth" >> "$out"
if [ "$growth" = "true" ]; then
  echo "A growth pull request: $why."
else
  echo "Not a growth pull request: $why."
fi
