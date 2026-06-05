#!/bin/bash

dmg_previous_path() {
    local dmg_path="$1"
    local dir
    dir="$(dirname "$dmg_path")"
    echo "$dir/Codex.previous.dmg"
}

dmg_previous_metadata_path() {
    local dmg_path="$1"
    local dir
    dir="$(dirname "$dmg_path")"
    echo "$dir/Codex.previous.dmg.remote"
}

write_dmg_metadata() {
    local metadata_path="$1"
    local remote_etag="$2"
    local remote_last_modified="$3"
    local remote_length="$4"
    local metadata_tmp="${metadata_path}.tmp.$$"

    cat > "$metadata_tmp" <<EOF
DMG_REMOTE_ETAG='${remote_etag//\'/\'\"\'\"\'}'
DMG_REMOTE_LAST_MODIFIED='${remote_last_modified//\'/\'\"\'\"\'}'
DMG_REMOTE_CONTENT_LENGTH='${remote_length//\'/\'\"\'\"\'}'
EOF
    mv -f "$metadata_tmp" "$metadata_path"
}

commit_refreshed_dmg() {
    local dmg_path="$1"
    local metadata_path="$2"
    local downloaded_path="$3"
    local remote_etag="$4"
    local remote_last_modified="$5"
    local remote_length="$6"
    local previous_dmg_path
    local previous_metadata_path
    local next_metadata_path="${metadata_path}.next.$$"

    [ -s "$downloaded_path" ] || {
        echo "Downloaded DMG is empty or missing: $downloaded_path" >&2
        return 1
    }

    previous_dmg_path="$(dmg_previous_path "$dmg_path")"
    previous_metadata_path="$(dmg_previous_metadata_path "$dmg_path")"
    write_dmg_metadata "$next_metadata_path" "$remote_etag" "$remote_last_modified" "$remote_length"

    if [ -s "$dmg_path" ]; then
        cp -p "$dmg_path" "$previous_dmg_path"
        if [ -f "$metadata_path" ]; then
            cp -p "$metadata_path" "$previous_metadata_path"
        else
            rm -f "$previous_metadata_path"
        fi
    fi

    mv -f "$downloaded_path" "$dmg_path"
    mv -f "$next_metadata_path" "$metadata_path"
}
