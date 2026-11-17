#!/usr/bin/env python3
"""Wheel of Misfortune worker: renders the jobs api.php queues.

Started by wom-worker.path whenever $WOM_DATA/queue is non-empty, runs as user
wom in a sandbox with no network (wom-worker.service), drains the queue and exits.

  {"type": "sound", "in": "incoming/<hex>.in", "out": "media/<hex>.mp3"}
      an uploaded sound: first 10 s, loudness-normalised, metadata stripped, mp3.
  {"type": "tts", "voice": "<piper model>", "text": "...", "out": "media/tts/<sha>.mp3"}
      a slot name spoken by Piper.

A job is moved to work/ before it runs, so a crash can't re-trigger the path unit
forever; whatever is left in work/ at start-up is marked failed.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

DATA = Path(os.environ.get("WOM_DATA", "/var/lib/wom"))
PIPER_DIR = Path(os.environ.get("WOM_PIPER", "/opt/piper"))  # the piper binary + voices/<model>.onnx
PIPER = str(PIPER_DIR / "piper")
VOICES = PIPER_DIR / "voices"
QUEUE, WORK, FAILED = DATA / "queue", DATA / "work", DATA / "failed"
OUT_RE = re.compile(r"^media/(?:tts/[0-9a-f]{64}|[0-9a-f]{16})\.mp3$")
IN_RE = re.compile(r"^incoming/[0-9a-f]{16}\.in$")
VOICE_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
# both clips end with a short fade so a 10 s cut never clicks
SOUND_AF = "afade=t=out:st=9.6:d=0.4,loudnorm=I=-16:TP=-1.5:LRA=11"
VOICE_AF = "adelay=60,loudnorm=I=-16:TP=-1.5:LRA=11"


def ffmpeg(*args, timeout=120):
    subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", *args],
        check=True, timeout=timeout, stdin=subprocess.DEVNULL,
    )


def part(out: str) -> Path:
    """Where to encode `out`: a dot-file in its final directory, so it is created there and
    inherits media/'s setgid group (http, which serves it). A file renamed in from work/ keeps
    group wom and Apache can't read it."""
    dest = DATA / out
    dest.parent.mkdir(parents=True, exist_ok=True)
    return dest.parent / f".{dest.name}.part"


def publish(tmp: Path, out: str):
    os.replace(tmp, DATA / out)


def sound(job, tmpdir: Path):
    src, out = job.get("in", ""), job.get("out", "")
    if not IN_RE.match(src) or not OUT_RE.match(out):
        raise ValueError("bad paths")
    try:
        mp3 = part(out)
        ffmpeg("-i", str(DATA / src), "-t", "10", "-vn", "-sn", "-dn", "-map_metadata", "-1",
               "-af", SOUND_AF, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-q:a", "3",
               "-f", "mp3", str(mp3))
        publish(mp3, out)
    finally:
        (DATA / src).unlink(missing_ok=True)
        part(out).unlink(missing_ok=True)


def tts(job, tmpdir: Path):
    voice, text, out = job.get("voice", ""), job.get("text", ""), job.get("out", "")
    model = VOICES / f"{voice}.onnx"
    if not VOICE_RE.match(voice) or not model.is_file() or not OUT_RE.match(out):
        raise ValueError("bad voice job")
    text = " ".join(str(text).split())[:200]
    if not text:
        raise ValueError("empty text")
    if (DATA / out).exists():
        return
    wav, mp3 = tmpdir / "v.wav", part(out)
    # a touch slower than default: deliberate, not chirpy
    subprocess.run([PIPER, "--quiet", "--model", str(model), "--length_scale", "1.12",
                    "--output_file", str(wav)], input=text.encode(), check=True, timeout=120,
                   stdout=subprocess.DEVNULL)
    try:
        ffmpeg("-i", str(wav), "-af", VOICE_AF, "-ar", "44100", "-ac", "1", "-c:a", "libmp3lame",
               "-q:a", "4", "-f", "mp3", str(mp3))
        publish(mp3, out)
    finally:
        mp3.unlink(missing_ok=True)


def main():
    os.umask(0o027)
    for d in (QUEUE, WORK, FAILED):
        d.mkdir(parents=True, exist_ok=True)
    for stale in WORK.glob("*.json"):
        os.replace(stale, FAILED / stale.name)

    done = failed = 0
    for _ in range(1000):  # bounded: a runaway producer can't pin the worker forever
        jobs = sorted(QUEUE.glob("*.json"))
        if not jobs:
            break
        for qf in jobs:
            wf = WORK / qf.name
            try:
                os.replace(qf, wf)
            except FileNotFoundError:
                continue
            try:
                job = json.loads(wf.read_text())
                with tempfile.TemporaryDirectory(dir=WORK) as tmp:
                    {"sound": sound, "tts": tts}[job.get("type")](job, Path(tmp))
                wf.unlink()
                done += 1
            except Exception as e:  # noqa: BLE001 — one bad job must not stop the rest
                failed += 1
                print(f"wom-worker: {qf.name}: {type(e).__name__}: {e}", file=sys.stderr)
                os.replace(wf, FAILED / qf.name)
    # keep failed/ from growing without bound
    for old in sorted(FAILED.glob("*.json"), key=lambda p: p.stat().st_mtime)[:-200]:
        old.unlink(missing_ok=True)
    print(f"wom-worker: {done} done, {failed} failed")


if __name__ == "__main__":
    main()
