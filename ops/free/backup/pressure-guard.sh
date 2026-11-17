#!/bin/sh
# Exit 1 is an intentional ExecCondition skip. Never start Node if unverifiable.
set -eu

nrn_skip() { printf '%s\n' "$1" >&2; exit 1; }
nrn_check_values() {
  nrn_race_bytes=$1
  nrn_available_kib=$2
  case "$nrn_race_bytes" in *[!0-9]*|'') nrn_skip 'NRN backup skipped: memory values unavailable' ;; esac
  case "$nrn_available_kib" in *[!0-9]*|'') nrn_skip 'NRN backup skipped: memory values unavailable' ;; esac
  [ -n "$nrn_race_bytes" ] && [ -n "$nrn_available_kib" ] || nrn_skip 'NRN backup skipped: memory values unavailable'
  [ "${#nrn_race_bytes}" -le 15 ] && [ "${#nrn_available_kib}" -le 15 ] || nrn_skip 'NRN backup skipped: invalid memory values'
  [ "$nrn_race_bytes" -lt 314572800 ] || nrn_skip 'NRN backup skipped: RACE memory has priority'
  [ "$nrn_available_kib" -ge 262144 ] || nrn_skip 'NRN backup skipped: available memory below minimum'
}

# Diagnostic boundary checks use public numeric inputs, never in the unit.
if [ "${1-}" = --check-values ]; then
  [ "$#" -eq 3 ] || nrn_skip 'NRN backup guard: invalid diagnostic arguments'
  nrn_check_values "$2" "$3"
  exit 0
fi
[ "$#" -eq 0 ] || nrn_skip 'NRN backup guard: invalid arguments'

nrn_race_path=/sys/fs/cgroup/system.slice/actions.runner.nachorn-race-golf-scheduler.race-golf-azure-belgium.service/memory.current
[ -r "$nrn_race_path" ] || nrn_skip 'NRN backup skipped: RACE memory could not be verified'
nrn_race_bytes=$(cat "$nrn_race_path") || nrn_skip 'NRN backup skipped: RACE memory could not be read'
nrn_available_kib=$(awk '/^MemAvailable:/ { print $2; found=1; exit } END { if (!found) exit 1 }' /proc/meminfo) || nrn_skip 'NRN backup skipped: available memory could not be read'
nrn_check_values "$nrn_race_bytes" "$nrn_available_kib"
