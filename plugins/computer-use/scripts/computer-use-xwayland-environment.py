#!/usr/bin/env python3

import argparse
import json
import os
import re
import socket
import struct
from pathlib import Path


def capture_xwayland_environment():
    display = os.environ.get("DISPLAY", "")
    if re.fullmatch(r":\d+", display) is None:
        raise RuntimeError(f"KWin provided an invalid Xwayland display: {display!r}")
    xauthority = os.environ.get("XAUTHORITY", "")
    return {
        "version": 1,
        "display": display,
        "xauthority": xauthority,
    }


def read_exact(connection, byte_count):
    chunks = []
    remaining = byte_count
    while remaining:
        chunk = connection.recv(remaining)
        if not chunk:
            raise RuntimeError("Xwayland closed the readiness connection during protocol setup")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def wait_for_xwayland(display):
    display_number = int(display.removeprefix(":"))
    socket_path = f"/tmp/.X11-unix/X{display_number}"
    setup_request = struct.pack("<BBHHHHH", ord("l"), 0, 11, 0, 0, 0, 0)
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(15)
        connection.connect(socket_path)
        connection.sendall(setup_request)
        header = read_exact(connection, 8)
        additional_length = int.from_bytes(header[6:8], "little") * 4
        additional_data = read_exact(connection, additional_length)
        if header[0] != 1:
            reason_length = header[1]
            reason = additional_data[:reason_length].decode("utf-8", errors="replace")
            raise RuntimeError(f"Xwayland rejected the readiness connection: {reason}")


def write_environment(output_path):
    output_path = Path(output_path)
    payload = capture_xwayland_environment()
    wait_for_xwayland(payload["display"])
    temporary_path = output_path.with_name(f".{output_path.name}.{os.getpid()}.tmp")
    with temporary_path.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle)
        handle.write("\n")
    os.replace(temporary_path, output_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output_path")
    arguments = parser.parse_args()
    write_environment(arguments.output_path)


if __name__ == "__main__":
    main()
