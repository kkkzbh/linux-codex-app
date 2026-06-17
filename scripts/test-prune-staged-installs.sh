#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_PRUNE="$SCRIPT_DIR/prune-staged-installs.sh"
MARKER=".codex-linux-verified"

fail() {
    echo "test-prune-staged-installs: $*" >&2
    exit 1
}

make_root() {
    local temp_dir
    temp_dir="$(mktemp -d)"
    mkdir -p "$temp_dir/staged-installs" "$temp_dir/state"
    printf '%s\n' "$temp_dir"
}

make_install() {
    local root="$1"
    local name="$2"
    local status="$3"
    local mtime="$4"
    local dir="$root/staged-installs/$name"

    mkdir -p "$dir/resources"
    case "$status" in
        verified|legacy)
            printf '#!/bin/sh\nexit 0\n' > "$dir/start.sh"
            printf '#!/bin/sh\nexit 0\n' > "$dir/Codex"
            chmod +x "$dir/start.sh" "$dir/Codex"
            printf 'asar\n' > "$dir/resources/app.asar"
            ;;
        partial)
            printf 'partial\n' > "$dir/partial.txt"
            ;;
        *)
            fail "unknown fixture install status: $status"
            ;;
    esac

    if [ "$status" = "verified" ]; then
        printf 'verified_at=fixture\n' > "$dir/$MARKER"
    fi

    touch -d "$mtime" "$dir"
    printf '%s\n' "$dir"
}

count_installs() {
    find "$1/staged-installs" -mindepth 1 -maxdepth 1 -type d -name 'codex-app-*' | wc -l
}

assert_exists() {
    [ -e "$1" ] || fail "expected path to exist: $1"
}

assert_missing() {
    [ ! -e "$1" ] || fail "expected path to be removed: $1"
}

run_prune() {
    "$SOURCE_PRUNE" --staging-root "$1/staged-installs" --active-link "$1/state/current" "${@:2}"
}

test_dry_run_does_not_delete() {
    local root
    root="$(make_root)"
    make_install "$root" codex-app-1 verified '2026-01-01 00:00:01' >/dev/null
    make_install "$root" codex-app-2 verified '2026-01-01 00:00:02' >/dev/null
    make_install "$root" codex-app-3 verified '2026-01-01 00:00:03' >/dev/null
    make_install "$root" codex-app-4 verified '2026-01-01 00:00:04' >/dev/null

    run_prune "$root" --dry-run >/tmp/codex-prune-dry-run.out 2>/tmp/codex-prune-dry-run.err
    [ "$(count_installs "$root")" -eq 4 ] || fail "dry-run deleted staged installs"
    grep -F "Would remove staged install" /tmp/codex-prune-dry-run.err >/dev/null \
        || fail "dry-run did not report removable staged installs"
    rm -rf "$root"
}

test_newest_three_verified_retained() {
    local root
    root="$(make_root)"
    make_install "$root" codex-app-1 verified '2026-01-01 00:00:01' >/dev/null
    make_install "$root" codex-app-2 verified '2026-01-01 00:00:02' >/dev/null
    make_install "$root" codex-app-3 verified '2026-01-01 00:00:03' >/dev/null
    make_install "$root" codex-app-4 verified '2026-01-01 00:00:04' >/dev/null
    make_install "$root" codex-app-5 verified '2026-01-01 00:00:05' >/dev/null

    run_prune "$root"
    assert_missing "$root/staged-installs/codex-app-1"
    assert_missing "$root/staged-installs/codex-app-2"
    assert_exists "$root/staged-installs/codex-app-3"
    assert_exists "$root/staged-installs/codex-app-4"
    assert_exists "$root/staged-installs/codex-app-5"
    [ "$(count_installs "$root")" -eq 3 ] || fail "did not retain exactly three staged installs"
    rm -rf "$root"
}

test_active_install_is_preserved() {
    local root active
    root="$(make_root)"
    active="$(make_install "$root" codex-app-1 verified '2026-01-01 00:00:01')"
    make_install "$root" codex-app-2 verified '2026-01-01 00:00:02' >/dev/null
    make_install "$root" codex-app-3 verified '2026-01-01 00:00:03' >/dev/null
    make_install "$root" codex-app-4 verified '2026-01-01 00:00:04' >/dev/null
    make_install "$root" codex-app-5 verified '2026-01-01 00:00:05' >/dev/null
    ln -s "$active" "$root/state/current"

    run_prune "$root"
    assert_exists "$root/staged-installs/codex-app-1"
    assert_missing "$root/staged-installs/codex-app-2"
    assert_missing "$root/staged-installs/codex-app-3"
    assert_exists "$root/staged-installs/codex-app-4"
    assert_exists "$root/staged-installs/codex-app-5"
    rm -rf "$root"
}

test_explicit_pin_is_preserved() {
    local root pin
    root="$(make_root)"
    pin="$(make_install "$root" codex-app-1 verified '2026-01-01 00:00:01')"
    make_install "$root" codex-app-2 verified '2026-01-01 00:00:02' >/dev/null
    make_install "$root" codex-app-3 verified '2026-01-01 00:00:03' >/dev/null
    make_install "$root" codex-app-4 verified '2026-01-01 00:00:04' >/dev/null
    make_install "$root" codex-app-5 verified '2026-01-01 00:00:05' >/dev/null

    run_prune "$root" --pin "$pin"
    assert_exists "$root/staged-installs/codex-app-1"
    assert_missing "$root/staged-installs/codex-app-2"
    assert_missing "$root/staged-installs/codex-app-3"
    assert_exists "$root/staged-installs/codex-app-4"
    assert_exists "$root/staged-installs/codex-app-5"
    rm -rf "$root"
}

test_partial_installs_are_removed_before_legacy_candidates() {
    local root
    root="$(make_root)"
    make_install "$root" codex-app-partial partial '2026-01-01 00:00:05' >/dev/null
    make_install "$root" codex-app-legacy-1 legacy '2026-01-01 00:00:01' >/dev/null
    make_install "$root" codex-app-legacy-2 legacy '2026-01-01 00:00:02' >/dev/null

    run_prune "$root"
    assert_missing "$root/staged-installs/codex-app-partial"
    assert_exists "$root/staged-installs/codex-app-legacy-1"
    assert_exists "$root/staged-installs/codex-app-legacy-2"
    rm -rf "$root"
}

test_running_install_is_preserved() {
    local root running_dir running_pid=""
    root="$(make_root)"
    running_dir="$(make_install "$root" codex-app-1 verified '2026-01-01 00:00:01')"
    make_install "$root" codex-app-2 verified '2026-01-01 00:00:02' >/dev/null
    make_install "$root" codex-app-3 verified '2026-01-01 00:00:03' >/dev/null
    make_install "$root" codex-app-4 verified '2026-01-01 00:00:04' >/dev/null
    make_install "$root" codex-app-5 verified '2026-01-01 00:00:05' >/dev/null

    cleanup_running() {
        if [ -n "$running_pid" ] && kill -0 "$running_pid" 2>/dev/null; then
            kill "$running_pid" 2>/dev/null || true
        fi
    }
    trap cleanup_running RETURN

    bash -c 'exec -a "$1/Codex" sleep 30' _ "$running_dir" &
    running_pid="$!"
    sleep 0.1

    run_prune "$root"
    assert_exists "$root/staged-installs/codex-app-1"
    assert_missing "$root/staged-installs/codex-app-2"
    assert_missing "$root/staged-installs/codex-app-3"
    assert_exists "$root/staged-installs/codex-app-4"
    assert_exists "$root/staged-installs/codex-app-5"
    cleanup_running
    trap - RETURN
    rm -rf "$root"
}

test_keep_above_three_is_rejected_unless_disabled() {
    local root
    root="$(make_root)"
    make_install "$root" codex-app-1 verified '2026-01-01 00:00:01' >/dev/null

    if run_prune "$root" --keep 4 >/tmp/codex-prune-keep4.out 2>/tmp/codex-prune-keep4.err; then
        fail "--keep 4 unexpectedly succeeded"
    fi
    CODEX_STAGED_INSTALLS_PRUNE=0 run_prune "$root" --keep 4 >/tmp/codex-prune-disabled.out 2>/tmp/codex-prune-disabled.err
    assert_exists "$root/staged-installs/codex-app-1"
    rm -rf "$root"
}

test_symlinked_outside_dir_is_not_deleted() {
    local root outside
    root="$(make_root)"
    outside="$root/outside/codex-app-outside"
    mkdir -p "$outside"
    ln -s "$outside" "$root/staged-installs/codex-app-outside"
    make_install "$root" codex-app-1 verified '2026-01-01 00:00:01' >/dev/null
    make_install "$root" codex-app-2 verified '2026-01-01 00:00:02' >/dev/null
    make_install "$root" codex-app-3 verified '2026-01-01 00:00:03' >/dev/null
    make_install "$root" codex-app-4 verified '2026-01-01 00:00:04' >/dev/null

    run_prune "$root"
    assert_exists "$outside"
    rm -rf "$root"
}

test_dry_run_does_not_delete
test_newest_three_verified_retained
test_active_install_is_preserved
test_explicit_pin_is_preserved
test_partial_installs_are_removed_before_legacy_candidates
test_running_install_is_preserved
test_keep_above_three_is_rejected_unless_disabled
test_symlinked_outside_dir_is_not_deleted

echo "Prune staged installs tests passed"
