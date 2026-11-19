#!/usr/bin/env bash
# Is this pull request a Bank Growth pull request (docs/adr/0024)? Writes
# `growth=true|false` to $GITHUB_OUTPUT (or stdout) and says why.
#
# Used by .github/workflows/bank-growth-guard.yml (fail it if it leaves the
# bank) and .github/workflows/e2e-changed.yml (never run it with the app's
# secrets), always from the default branch's copy. It reads the pull request
# fresh from the API, not from the event payload, because a label can be
# added after the event fired.
#
# Growth when ANY of: the `bank:growth` label, a `bank-growth/` branch, or an
# issue it closes (GitHub's own closing links: `Closes #61`, `Fixes #61`)
# that carries `bank:growth`. The third is a fact the routine cannot take
# back: the bank labels the issue, not the routine. Merely mentioning a
# growth issue ("see #61") does not count, so a pull request about the loop
# is not mistaken for one built by it.
#
# One API call. If it fails, the script exits non-zero (fail closed): an
# outage never turns a growth pull request into an ordinary one.
#
#   GH_TOKEN=… REPO=owner/repo PR=<number> scripts/growth-pr.sh
set -euo pipefail

: "${REPO:?}" "${PR:?}"
case "$PR" in '' | *[!0-9]*) echo "PR must be a number" >&2; exit 2 ;; esac
case "$REPO" in */*) ;; *) echo "REPO must be owner/repo" >&2; exit 2 ;; esac

out="${GITHUB_OUTPUT:-/dev/stdout}"
query='query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefName
      labels(first: 50) { nodes { name } }
      closingIssuesReferences(first: 50) { nodes { number labels(first: 50) { nodes { name } } } }
    }
  }
}'
pr=$(gh api graphql -f query="$query" -f owner="${REPO%%/*}" -f name="${REPO#*/}" -F number="$PR" \
  --jq '.data.repository.pullRequest')
if [ -z "$pr" ] || [ "$pr" = "null" ]; then
  echo "Could not read pull request #$PR, so cannot tell whether it is a growth pull request." >&2
  exit 1
fi

growth=false
why="no bank:growth label, no bank-growth/ branch, and it closes no bank:growth issue"
closes=$(jq -r '[.closingIssuesReferences.nodes[] | select([.labels.nodes[].name] | index("bank:growth")) | .number] | first // empty' <<<"$pr")

if jq -e '[.labels.nodes[].name] | index("bank:growth")' <<<"$pr" >/dev/null; then
  growth=true; why="it carries the bank:growth label"
elif [[ "$(jq -r '.headRefName' <<<"$pr")" == bank-growth/* ]]; then
  growth=true; why="its branch starts with bank-growth/"
elif [ -n "$closes" ]; then
  growth=true; why="it closes #$closes, a bank:growth issue"
fi

echo "growth=$growth" >> "$out"
if [ "$growth" = "true" ]; then
  echo "A growth pull request: $why."
else
  echo "Not a growth pull request: $why."
fi
