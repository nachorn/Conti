#!/bin/sh
# Read-only preflight. No Node imports, database access or permission changes.
set -eu

nrn_fail() { printf '%s\n' 'NRN local snapshot privacy or migration guard failed' >&2; exit 1; }
case "${1-}" in
  '') nrn_environment=/etc/nrnplay/nrnplay.env ;;
  --backup) [ "$#" -eq 1 ] || nrn_fail; nrn_environment=/etc/nrnplay/backup.env ;;
  *) nrn_fail ;;
esac

[ "${NRN_STORAGE_MODE-}" = file ] || nrn_fail
[ "${GAME_STATE_PATH-}" = /var/lib/nrnplay/games.json ] || nrn_fail
[ "${MEMBERSHIP_STATE_PATH-}" = /var/lib/nrnplay/memberships.json ] || nrn_fail
nrn_uid=$(id -u)
for nrn_directory in /var/lib/nrnplay /etc/nrnplay; do
  [ -d "$nrn_directory" ] && [ ! -L "$nrn_directory" ] || nrn_fail
  [ "$(stat -c '%a' "$nrn_directory")" = 700 ] || nrn_fail
  [ "$(stat -c '%u' "$nrn_directory")" = "$nrn_uid" ] || nrn_fail
done

for nrn_file in "$GAME_STATE_PATH" "$MEMBERSHIP_STATE_PATH" "$nrn_environment"; do
  [ -f "$nrn_file" ] && [ -s "$nrn_file" ] && [ ! -L "$nrn_file" ] || nrn_fail
  [ "$(stat -c '%a' "$nrn_file")" = 600 ] || nrn_fail
  [ "$(stat -c '%u' "$nrn_file")" = "$nrn_uid" ] || nrn_fail
done
[ "$(stat -c '%d:%i' "$GAME_STATE_PATH")" != "$(stat -c '%d:%i' "$MEMBERSHIP_STATE_PATH")" ] || nrn_fail
