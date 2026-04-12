#!/usr/bin/env bash
# flagd-set.sh — flip an OTel demo feature flag on the clintdev kind cluster.
#
# Usage:
#   scripts/flagd-set.sh <flagName> <variant>     # turn a flag on/to a variant
#   scripts/flagd-set.sh <flagName> off           # turn it off
#   scripts/flagd-set.sh --list                   # list all flags + variants
#   scripts/flagd-set.sh --status                 # show currently-active flags
#   scripts/flagd-set.sh --all-off                # revert every flag to its off variant
#
# Examples:
#   scripts/flagd-set.sh paymentFailure 50%
#   scripts/flagd-set.sh kafkaQueueProblems on
#   scripts/flagd-set.sh emailMemoryLeak 100x
#   scripts/flagd-set.sh paymentFailure off
#
# How it works: the demo runs inside a kind cluster on clintdev. The flagd
# ConfigMap in the otel-demo namespace holds the JSON flag state. This
# script fetches the ConfigMap, patches `defaultVariant` for the named flag,
# applies the result, and bounces the flagd Deployment so the change takes
# effect immediately (otherwise ConfigMap propagation can take ~60s).
#
# Requires: ssh access to clintdev, which runs Docker with a kind cluster
# named "otel-demo-cribl". No local kubectl needed — we exec into the
# control-plane container.

set -euo pipefail

SSH_HOST="clintdev"
CTRL_CONTAINER="otel-demo-cribl-control-plane"
NAMESPACE="otel-demo"
CONFIGMAP="flagd-config"
DEPLOYMENT="flagd"

die() { echo "error: $*" >&2; exit 1; }

fetch_config() {
  ssh "$SSH_HOST" "docker exec $CTRL_CONTAINER kubectl -n $NAMESPACE get cm $CONFIGMAP -o jsonpath='{.data.demo\.flagd\.json}'"
}

apply_config() {
  local json_file="$1"
  cat "$json_file" | ssh "$SSH_HOST" "docker exec -i $CTRL_CONTAINER sh -c 'cat > /tmp/flagd-patched.json && kubectl -n $NAMESPACE create configmap $CONFIGMAP --from-file=demo.flagd.json=/tmp/flagd-patched.json --dry-run=client -o yaml | kubectl apply -f - >/dev/null && kubectl -n $NAMESPACE rollout restart deployment/$DEPLOYMENT >/dev/null && kubectl -n $NAMESPACE rollout status deployment/$DEPLOYMENT --timeout=60s'" | tail -1
}

cmd_list() {
  fetch_config | python3 -c '
import json, sys
d = json.load(sys.stdin)
for name, flag in d["flags"].items():
    variants = list(flag.get("variants", {}).keys())
    default = flag.get("defaultVariant", "?")
    desc = flag.get("description", "")
    print(f"{name}  [{default}]  variants: {variants}")
    if desc:
        print(f"    {desc}")
'
}

cmd_status() {
  fetch_config | python3 -c '
import json, sys
d = json.load(sys.stdin)
active = [(n, f["defaultVariant"]) for n, f in d["flags"].items() if f.get("defaultVariant") != "off"]
if not active:
    print("all flags off")
else:
    for name, variant in active:
        print(f"ACTIVE: {name} = {variant}")
'
}

cmd_set() {
  local flag="$1" variant="$2"
  # Script-scoped paths so the EXIT trap can still see them after the
  # function returns — `set -u` + local vars would otherwise fire
  # "unbound variable" when the trap runs.
  tmpfile="/tmp/flagd-$$.json"
  patched="/tmp/flagd-$$.patched.json"
  trap 'rm -f "$tmpfile" "$patched"' EXIT

  fetch_config > "$tmpfile"
  python3 - "$tmpfile" "$patched" "$flag" "$variant" <<'PY'
import json, sys
src, dst, flag, variant = sys.argv[1:5]
with open(src) as f:
    d = json.load(f)
if flag not in d["flags"]:
    print(f"flag not found: {flag}", file=sys.stderr)
    sys.exit(3)
variants = d["flags"][flag].get("variants", {})
if variant not in variants:
    print(f"variant {variant!r} not in {list(variants.keys())}", file=sys.stderr)
    sys.exit(4)
d["flags"][flag]["defaultVariant"] = variant
with open(dst, "w") as f:
    json.dump(d, f, indent=2)
print(f"patched: {flag} -> {variant}")
PY
  apply_config "$patched"
}

cmd_all_off() {
  # Script-scoped paths so the EXIT trap can still see them after the
  # function returns — `set -u` + local vars would otherwise fire
  # "unbound variable" when the trap runs.
  tmpfile="/tmp/flagd-$$.json"
  patched="/tmp/flagd-$$.patched.json"
  trap 'rm -f "$tmpfile" "$patched"' EXIT

  fetch_config > "$tmpfile"
  python3 - "$tmpfile" "$patched" <<'PY'
import json, sys
src, dst = sys.argv[1:3]
with open(src) as f:
    d = json.load(f)
changed = []
for name, flag in d["flags"].items():
    if flag.get("defaultVariant") != "off":
        flag["defaultVariant"] = "off"
        changed.append(name)
with open(dst, "w") as f:
    json.dump(d, f, indent=2)
print(f"reset: {len(changed)} flag(s) -> off {changed}")
PY
  apply_config "$patched"
}

case "${1:-}" in
  --list|-l)   cmd_list ;;
  --status|-s) cmd_status ;;
  --all-off)   cmd_all_off ;;
  -h|--help|'') sed -n '1,30p' "$0"; exit 0 ;;
  *)
    [[ $# -eq 2 ]] || die "usage: $0 <flagName> <variant> (or --list / --status / --all-off)"
    cmd_set "$1" "$2"
    ;;
esac
