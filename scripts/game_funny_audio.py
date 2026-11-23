#!/usr/bin/env python3
"""Generate original, royalty-free chiptune beds and cartoon foley offline."""
import argparse
from array import array
import math
import random
import wave
from pathlib import Path

SR = 48000
SECONDS = 60
N = SR * SECONDS


def add_tone(buf, start, duration, freq0, amp, freq1=None, shape="sine", decay=4.0, pan=0.0):
    first = max(0, int(start * SR))
    count = min(int(duration * SR), N - first)
    if count <= 0:
        return
    freq1 = freq0 if freq1 is None else freq1
    left_gain = math.sqrt((1 - max(-1, min(1, pan))) * 0.5)
    right_gain = math.sqrt((1 + max(-1, min(1, pan))) * 0.5)
    inv_dur = 1.0 / max(duration, 1e-6)
    attack_len = max(1, int(min(0.025, duration * 0.12) * SR))
    phase = 0.0
    prev_freq = freq0
    for i in range(count):
        t = i / SR
        blend = min(1.0, t * inv_dur)
        freq = freq0 + (freq1 - freq0) * blend
        phase += math.tau * (prev_freq + freq) * 0.5 / SR
        prev_freq = freq
        s = math.sin(phase)
        if shape == "square":
            s = math.tanh(s * 4.5)
        elif shape == "triangle":
            s = (2.0 / math.pi) * math.asin(s)
        elif shape == "saw":
            s = 2.0 * ((phase / math.tau) % 1.0) - 1.0
        attack = min(1.0, i / attack_len)
        release = min(1.0, max(0.0, (count - i) / max(1, int(duration * 0.14 * SR))))
        env = attack * release * math.exp(-decay * t)
        value = s * amp * env
        j = (first + i) * 2
        buf[j] += value * left_gain
        buf[j + 1] += value * right_gain


def add_noise(buf, start, duration, amp, decay=5.0, pan=0.0, seed=1234):
    first = max(0, int(start * SR))
    count = min(int(duration * SR), N - first)
    if count <= 0:
        return
    rng = random.Random(seed)
    left_gain = math.sqrt((1 - max(-1, min(1, pan))) * 0.5)
    right_gain = math.sqrt((1 + max(-1, min(1, pan))) * 0.5)
    attack_len = max(1, int(min(0.012, duration * 0.08) * SR))
    for i in range(count):
        t = i / SR
        attack = min(1.0, i / attack_len)
        release = min(1.0, max(0.0, (count - i) / max(1, int(duration * 0.16 * SR))))
        value = rng.uniform(-1.0, 1.0) * amp * attack * release * math.exp(-decay * t)
        j = (first + i) * 2
        buf[j] += value * left_gain
        buf[j + 1] += value * right_gain


def music_bed(buf, mood="bright"):
    beat = 0.5
    # C / G / Am / F, with a playful major-pentatonic lead.
    roots = (130.81, 98.0, 110.0, 87.31)
    lead = (523.25, 659.25, 783.99, 659.25, 587.33, 698.46, 880.0, 698.46,
            523.25, 587.33, 698.46, 783.99, 659.25, 587.33, 523.25, 392.0)
    for b in range(int(SECONDS / beat)):
        t = b * beat
        root = roots[(b // 4) % len(roots)]
        add_tone(buf, t, 0.28, root, 0.07, shape="triangle", decay=2.8, pan=-0.08)
        if b % 2 == 0:
            add_tone(buf, t, 0.16, 86, 0.14, freq1=45, shape="sine", decay=8.0)
        elif b % 4 == 1:
            add_noise(buf, t, 0.095, 0.035, decay=15, seed=1000 + b)
        add_noise(buf, t + 0.25, 0.028, 0.016, decay=48, pan=0.18 if b % 2 else -0.18, seed=2000 + b)
        for half in (0, 1):
            note_idx = (b * 2 + half + (0 if mood == "bright" else 3)) % len(lead)
            add_tone(buf, t + half * 0.25, 0.17, lead[note_idx], 0.037, shape="square", decay=3.4, pan=0.16 if half else -0.16)
        if b % 4 == 0:
            # Soft chord stabs keep the backing musical instead of just percussion.
            for ratio in (1.0, 1.25, 1.5):
                add_tone(buf, t, 0.76, root * ratio, 0.018, shape="triangle", decay=1.2, pan=0.24)


def sfx(buf, kind, t, pan=0.0, seed=17):
    if kind == "block":
        add_tone(buf, t, 0.13, 190, 0.26, 95, "sine", 7, pan)
        add_noise(buf, t, 0.07, 0.12, 20, pan, seed)
    elif kind == "click":
        add_tone(buf, t, 0.1, 950, 0.23, 430, "square", 10, pan)
    elif kind == "boing":
        add_tone(buf, t, 0.38, 620, 0.35, 135, "sine", 3.7, pan)
        add_tone(buf, t + 0.02, 0.22, 820, 0.12, 280, "triangle", 5.2, pan)
    elif kind == "whoosh":
        add_noise(buf, t, 0.46, 0.16, 2.5, pan, seed)
        add_tone(buf, t, 0.33, 210, 0.07, 560, "sine", 4.0, pan)
    elif kind == "bonk":
        add_tone(buf, t, 0.2, 245, 0.34, 75, "triangle", 8.0, pan)
        add_tone(buf, t, 0.07, 710, 0.14, 390, "sine", 15, pan)
    elif kind == "pop":
        add_noise(buf, t, 0.065, 0.24, 25, pan, seed)
        add_tone(buf, t, 0.12, 330, 0.22, 120, "sine", 11, pan)
    elif kind == "boom":
        add_noise(buf, t, 0.85, 0.32, 3.8, pan, seed)
        add_tone(buf, t, 0.75, 90, 0.42, 36, "sine", 4.0, pan)
        add_tone(buf, t + 0.05, 0.22, 165, 0.18, 65, "triangle", 7.0, pan)
    elif kind == "oink":
        add_tone(buf, t, 0.28, 225, 0.24, 150, "saw", 4.5, pan)
        add_tone(buf, t + 0.04, 0.22, 455, 0.08, 320, "triangle", 5.0, pan)
    elif kind == "sneeze":
        add_noise(buf, t, 0.18, 0.2, 10, pan, seed)
        add_tone(buf, t + 0.06, 0.25, 280, 0.28, 940, "sine", 5.5, pan)
        add_noise(buf, t + 0.24, 0.07, 0.23, 22, pan, seed + 1)
    elif kind == "ding":
        for i, hz in enumerate((784, 988, 1175)):
            add_tone(buf, t + i * 0.075, 0.55, hz, 0.12, shape="sine", decay=2.2, pan=pan)
    elif kind == "win":
        for i, hz in enumerate((523, 659, 784, 1047)):
            add_tone(buf, t + i * 0.12, 0.5, hz, 0.15, shape="square", decay=2.2, pan=pan)
        add_noise(buf, t + 0.35, 0.6, 0.13, 3, pan, seed)
    elif kind == "fuse":
        add_noise(buf, t, 1.05, 0.11, 0.7, pan, seed)
        for i in range(5):
            add_tone(buf, t + i * 0.19, 0.08, 680 + i * 80, 0.08, 1100 + i * 110, "sine", 8, pan)
    elif kind == "rotor":
        for i in range(9):
            add_tone(buf, t + i * 0.07, 0.11, 240 + (i % 3) * 55, 0.13, 130, "sine", 5, pan)
        add_noise(buf, t, 0.62, 0.09, 2.2, pan, seed)
    elif kind == "scratch":
        add_tone(buf, t, 0.7, 1450, 0.19, 180, "saw", 1.4, pan)
        add_noise(buf, t, 0.25, 0.09, 10, pan, seed)
    elif kind == "stomp":
        add_tone(buf, t, 0.16, 125, 0.24, 45, "sine", 8, pan)
        add_noise(buf, t, 0.05, 0.06, 18, pan, seed)
    elif kind == "sparkle":
        for i, hz in enumerate((1175, 1568, 2093, 1760)):
            add_tone(buf, t + i * 0.07, 0.36, hz, 0.11, shape="sine", decay=3.0, pan=pan)


MINECRAFT_EVENTS = [
    (2.3, "sparkle", 0.18), (6.2, "click", -0.2), (8.0, "block", -0.25), (9.1, "block", 0.05),
    (10.2, "block", 0.22), (12.9, "pop", 0.1), (14.0, "ding", 0), (18.4, "whoosh", -0.18),
    (20.0, "bonk", 0), (21.1, "boing", 0.05), (29.7, "click", -0.2), (30.5, "fuse", 0),
    (30.6, "boom", 0), (31.2, "whoosh", 0.12), (32.0, "oink", 0.25), (40.2, "whoosh", -0.2),
    (43.5, "boing", -0.25), (45.4, "boing", 0.25), (47.2, "rotor", 0), (49.5, "pop", -0.2),
    (55.2, "sneeze", 0.2), (56.1, "sparkle", -0.1), (57.1, "win", 0),
]

ROBLOX_EVENTS = [
    (1.6, "click", 0), (5.1, "ding", 0.1), (8.5, "boing", -0.1), (11.4, "whoosh", 0.15),
    (14.5, "rotor", 0), (16.2, "bonk", -0.15), (19.8, "boing", 0.15), (23.5, "stomp", -0.2),
    (28.4, "ding", -0.1), (31.0, "click", 0), (32.2, "boing", -0.1), (35.6, "whoosh", 0.2),
    (38.2, "whoosh", -0.2), (40.5, "rotor", 0), (43.8, "stomp", 0.1), (47.0, "win", 0),
    (49.2, "pop", -0.25), (49.45, "pop", 0.2), (50.1, "sparkle", 0), (55.3, "scratch", 0),
    (58.0, "win", 0),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=("minecraft", "roblox"), required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    buf = array("f", [0.0]) * (N * 2)
    music_bed(buf)
    events = MINECRAFT_EVENTS if args.kind == "minecraft" else ROBLOX_EVENTS
    for i, (t, kind, pan) in enumerate(events):
        sfx(buf, kind, t, pan, seed=4300 + i)
    # Gentle editorial fade and peak normalization.
    peak = max(abs(v) for v in buf)
    gain = min(1.0, 0.88 / peak) if peak else 1.0
    fade_n = int(0.8 * SR)
    for frame in range(N):
        fade = min(1.0, frame / fade_n, (N - 1 - frame) / fade_n)
        j = frame * 2
        buf[j] *= gain * fade
        buf[j + 1] *= gain * fade
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    pcm = array("h", (max(-32767, min(32767, int(v * 32767))) for v in buf))
    if pcm.itemsize != 2:
        pcm.byteswap()
    with wave.open(str(out), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(SR)
        wav.writeframes(pcm.tobytes())
    print(f"Wrote {out} ({SECONDS}s, 48 kHz stereo)")


if __name__ == "__main__":
    main()
