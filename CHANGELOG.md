# Changelog

## 1.1.0 — 2026-11-26

### Added

- **Scenes and High Scores.** A scene starts with its first spin and counts every landing. Two hand-drawn faces either side of Spin end it: the smile says player 1 wins, the frown says player 2 loses. A confirmation pops up first, and then the scene goes into the High Scores on the main menu with both names, the number of spins, the date and the verdict. The High Scores are ranked by most spins and stored in the browser on that device.
- **Vibration** on phones that can vibrate: a click for every pin that passes the pointer, in time with the tick sound and heavier as the wheel slows, plus a knock when it stops. It can be switched off in the settings, which only show the switch on devices that can vibrate.
- **A heartbeat for rare slots.** Landing on a rare slot (weight 3 or less, and less than an even share of the wheel) plays three racing heartbeats, in sound and vibration, before the slot's sound and the voice.
- **"Tap to read more"** on the result plaque ("click" with a mouse), so it's clear the plaque opens the full dare.

### Changed

- The opening titles can be skipped with a tap, click or key after the first 1.5 seconds.
- The result plaque has more room between "The Promulgator has decreed" and the result, which now gets a fine gold underline.

## 1.0.1 — 2026-11-17

- Licensed under the WTFPL (version 2). The code comes with no warranty. The music, fonts and photos keep their own licences.

## 1.0.0 — 2026-11-17

First public release.

- Weighted dare wheels, decided before the wheel turns, with equal-sized wedges
- The Workshop: edit wheels, slots, weights, pictures and sounds in the browser
- Spoken results via Piper text-to-speech, with the browser's own voice as a fallback
- Background music, LED timer, a log of results (the Record), age gate
- Runs on any PHP host; optional hardened Apache + PHP-FPM + systemd setup
