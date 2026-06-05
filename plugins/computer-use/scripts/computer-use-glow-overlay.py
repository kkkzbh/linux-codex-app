#!/usr/bin/env python3

import json
import math
import os
import queue
import sys
import threading
import time


HOT_X = 15
HOT_Y = 15
SIZE = 72
CENTER = 36


def build_glow_pixmap():
    from PyQt6 import QtCore, QtGui

    image = QtGui.QImage(SIZE, SIZE, QtGui.QImage.Format.Format_ARGB32)
    image.fill(QtCore.Qt.GlobalColor.transparent)
    painter = QtGui.QPainter(image)
    painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, True)

    for radius, alpha in ((31, 22), (25, 38), (18, 64), (12, 110)):
        color = QtGui.QColor(40, 150, 255, alpha)
        painter.setBrush(color)
        painter.setPen(QtCore.Qt.PenStyle.NoPen)
        painter.drawEllipse(QtCore.QPointF(CENTER, CENTER), radius, radius)

    pen = QtGui.QPen(QtGui.QColor(80, 180, 255, 210), 3)
    painter.setPen(pen)
    painter.setBrush(QtCore.Qt.BrushStyle.NoBrush)
    painter.drawEllipse(QtCore.QPointF(CENTER, CENTER), 14, 14)
    painter.end()
    return QtGui.QPixmap.fromImage(image)


class GlowWindow:
    def __init__(self, app, commands):
        from PyQt6 import QtCore, QtWidgets

        self.app = app
        self.commands = commands
        self.widget = QtWidgets.QWidget(None)
        self.widget.setWindowFlags(
            QtCore.Qt.WindowType.FramelessWindowHint
            | QtCore.Qt.WindowType.WindowStaysOnTopHint
            | QtCore.Qt.WindowType.Tool
            | QtCore.Qt.WindowType.X11BypassWindowManagerHint
        )
        self.widget.setAttribute(QtCore.Qt.WidgetAttribute.WA_TranslucentBackground, True)
        self.widget.setAttribute(QtCore.Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.widget.setFocusPolicy(QtCore.Qt.FocusPolicy.NoFocus)
        self.widget.resize(SIZE, SIZE)
        self.pixmap = build_glow_pixmap()
        self.x = 0
        self.y = 0
        self.visible = False
        self.pulses = []
        self.widget.paintEvent = self.paint_event

        self.timer = QtCore.QTimer()
        self.timer.timeout.connect(self.tick)
        self.timer.start(16)

    def tick(self):
        dirty = False
        while True:
            try:
                command = self.commands.get_nowait()
            except queue.Empty:
                break
            dirty = True
            self.handle(command)

        now = time.monotonic()
        old_count = len(self.pulses)
        self.pulses = [pulse for pulse in self.pulses if now - pulse["time"] < 0.45]
        dirty = dirty or old_count != len(self.pulses)
        if dirty:
            self.widget.update()

    def handle(self, command):
        action = command.get("action")
        if action == "move":
            self.x = float(command.get("x", self.x))
            self.y = float(command.get("y", self.y))
            self.widget.move(round(self.x - CENTER + HOT_X), round(self.y - CENTER + HOT_Y))
            if not self.visible:
                self.widget.show()
                self.visible = True
            self.widget.raise_()
        elif action == "pulse":
            self.pulses.append({"time": time.monotonic(), "button": command.get("button", "left")})
        elif action == "stop":
            self.app.quit()

    def paint_event(self, event):
        from PyQt6 import QtCore, QtGui

        painter = QtGui.QPainter(self.widget)
        painter.setRenderHint(QtGui.QPainter.RenderHint.Antialiasing, True)
        painter.drawPixmap(0, 0, self.pixmap)

        now = time.monotonic()
        for pulse in self.pulses:
            age = now - pulse["time"]
            t = max(0.0, min(1.0, age / 0.45))
            alpha = round(180 * (1 - t) * (1 - t))
            radius = 12 + 32 * t
            pen = QtGui.QPen(QtGui.QColor(90, 190, 255, alpha), 3)
            painter.setPen(pen)
            painter.setBrush(QtCore.Qt.BrushStyle.NoBrush)
            painter.drawEllipse(QtCore.QPointF(CENTER, CENTER), radius, radius)
        painter.end()


def reader(commands):
    for line in sys.stdin:
        try:
            commands.put(json.loads(line))
        except json.JSONDecodeError:
            continue
    commands.put({"action": "stop"})


def main():
    from PyQt6 import QtWidgets

    commands = queue.Queue()
    threading.Thread(target=reader, args=(commands,), daemon=True).start()
    app = QtWidgets.QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    GlowWindow(app, commands)
    return app.exec()


if __name__ == "__main__":
    os.environ.setdefault("QT_QPA_PLATFORM", "xcb")
    raise SystemExit(main())
