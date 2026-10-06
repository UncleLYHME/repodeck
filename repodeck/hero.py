"""The Home banner: a pixel-art coast whose light follows the time of day.

Layers from data/hero/<phase>/ are drawn with nearest-neighbour scaling so pixels stay crisp.
Motion is slow and stepped in whole art pixels: clouds drift, stars twinkle and the lighthouse
beam pulses (dusk and night). A change of phase cross-fades. All motion stops while the banner
is off screen, and when the desktop asks for reduced animation.
"""

import random
import time
from datetime import datetime
from pathlib import Path

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Adw", "1")
from gi.repository import Adw, Gdk, GLib, Graphene, Gsk, Gtk  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data" / "hero"
ART_W, ART_H = 480, 118
TICK_MS = 500
DRIFT_SECONDS = 1.5  # per art pixel of cloud drift
BEAM_STEPS = [1.0, 0.85, 0.6, 0.4, 0.6, 0.85]  # a slow sweep, one step per tick


def phase_for(hour):
    if 5 <= hour < 8:
        return "dawn"
    if 8 <= hour < 17:
        return "day"
    if 17 <= hour < 20:
        return "dusk"
    return "night"


def greeting(hour):
    if 5 <= hour < 12:
        return "Good morning"
    if 12 <= hour < 17:
        return "Good afternoon"
    if 17 <= hour < 22:
        return "Good evening"
    return "Burning the midnight oil"


MOTION = {"enabled": True}  # Preferences → Animated banner


def animations_enabled():
    return MOTION["enabled"] and Gtk.Settings.get_default().get_property("gtk-enable-animations")


class HeroScene(Gtk.Widget):
    def __init__(self, on_phase=lambda phase: None):
        super().__init__(hexpand=True)
        self.on_phase = on_phase
        self.textures = {}
        self.phase = phase_for(datetime.now().hour)
        self.previous = None
        self.fade = 1.0
        self.twinkle = False
        self.beam_step = 0
        self.start = time.monotonic()
        self._tick = 0
        target = Adw.CallbackAnimationTarget.new(self._on_fade)
        self.crossfade = Adw.TimedAnimation.new(self, 0, 1, 2500, target)
        self.crossfade.set_easing(Adw.Easing.EASE_IN_OUT_CUBIC)
        self.connect("map", lambda *_: self._start())
        self.connect("unmap", lambda *_: self._stop())
        GLib.timeout_add_seconds(60, self._check_phase)

    # -- time of day ---------------------------------------------------------------

    def _check_phase(self):
        self.set_phase(phase_for(datetime.now().hour))
        return GLib.SOURCE_CONTINUE

    def set_phase(self, phase):
        if phase == self.phase:
            return
        self.previous, self.phase = self.phase, phase
        self.on_phase(phase)
        if animations_enabled() and self.get_mapped():
            self.crossfade.reset()
            self.crossfade.play()
        else:
            self._on_fade(1.0)

    def _on_fade(self, value):
        self.fade = value
        if value >= 1:
            self.previous = None
        self.queue_draw()

    # -- motion ----------------------------------------------------------------------

    def _start(self):
        self._check_phase()
        if not self._tick and animations_enabled():
            self._tick = GLib.timeout_add(TICK_MS, self._step)

    def motion_changed(self):
        self._stop()
        if self.get_mapped():
            self._start()
        self.queue_draw()

    def _stop(self):
        if self._tick:
            GLib.source_remove(self._tick)
            self._tick = 0

    def _step(self):
        if random.random() < 0.3:
            self.twinkle = not self.twinkle
        self.beam_step = (self.beam_step + 1) % len(BEAM_STEPS)
        self.queue_draw()
        return GLib.SOURCE_CONTINUE

    def drift(self):
        if not animations_enabled():
            return 0
        return int((time.monotonic() - self.start) / DRIFT_SECONDS) % ART_W

    # -- drawing ----------------------------------------------------------------------

    def texture(self, phase, layer):
        key = (phase, layer)
        if key not in self.textures:
            self.textures[key] = Gdk.Texture.new_from_filename(str(DATA / phase / f"{layer}.png"))
        return self.textures[key]

    def do_measure(self, orientation, for_size):
        if orientation == Gtk.Orientation.VERTICAL:
            return 330, 330, -1, -1  # scrolled pages hand out minimum heights: ask for the real one
        return 320, ART_W * 2, -1, -1

    def do_snapshot(self, snapshot):
        w, h = self.get_width(), self.get_height()
        scale = max(w / ART_W, h / ART_H)  # cover, like a background image
        x0, y0 = (w - ART_W * scale) / 2, (h - ART_H * scale) / 2
        snapshot.push_clip(Graphene.Rect().init(0, 0, w, h))
        if self.previous:
            self._draw(snapshot, self.previous, x0, y0, scale)
            snapshot.push_opacity(self.fade)
            self._draw(snapshot, self.phase, x0, y0, scale)
            snapshot.pop()
        else:
            self._draw(snapshot, self.phase, x0, y0, scale)
        snapshot.pop()

    def _layer(self, snapshot, phase, layer, x, y, scale):
        rect = Graphene.Rect().init(x, y, ART_W * scale, ART_H * scale)
        snapshot.append_scaled_texture(self.texture(phase, layer), Gsk.ScalingFilter.NEAREST, rect)

    def _draw(self, snapshot, phase, x0, y0, scale):
        self._layer(snapshot, phase, "sky2" if self.twinkle else "sky", x0, y0, scale)
        off = self.drift() * scale  # clouds wrap: two copies side by side
        self._layer(snapshot, phase, "clouds", x0 - off, y0, scale)
        self._layer(snapshot, phase, "clouds", x0 - off + ART_W * scale, y0, scale)
        snapshot.push_opacity(BEAM_STEPS[self.beam_step] if animations_enabled() else 1.0)
        self._layer(snapshot, phase, "beam", x0, y0, scale)
        snapshot.pop()
        self._layer(snapshot, phase, "fg", x0, y0, scale)
