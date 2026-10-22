# Chladni Modal — Max for Live instrument

The web app's plate turned into a playable modal synthesizer. Each voice is a bank of
up to 64 two-pole resonators, one for each plate mode. They are tuned to the plate's
eigenfrequencies and weighted by how strongly the drive point couples to each mode.
A mallet strike, the app's drive waveform, or both excite the bank. The display draws
sand settling on the modes that are currently sounding.

Requires Live 12 / Max 9 (`v8ui`, `mc.gen~`).

## Files

| file | what |
|---|---|
| `Chladni Modal.amxd` | the device (generated, do not edit by hand) |
| `chladni.js` | v8ui: mode catalogue, tables for the voices, sand display |
| `chladni_voice.genexpr` | gen~ voice code, embedded into the device by the build |
| `build_amxd.py` | regenerates the `.amxd` from the two files above |

## Install

1. Keep `Chladni Modal.amxd` and `chladni.js` in the same folder, and drop the device on a MIDI track.
2. If Max reports `chladni.js: can't find file`, open the device in the Max editor and add
   this folder under *Options → File Preferences*. You can also click **Freeze Device** in the
   editor toolbar and save, which embeds the script so the `.amxd` works on its own.

After editing `chladni.js` or `chladni_voice.genexpr`, run `python3 build_amxd.py`.

## Controls

**Plate**
- *Geometry*: rectangle or disc.
- *Edge*: free / supported / clamped / mixed. Mixed clamps x and frees y; on a disc it falls back to clamped.
- *Dispersion*: plate (ω∝k²) or membrane (ω∝k).
- *Aspect*: rectangle only.
- *Q*: resonance; also sets the ring time.
- *Drive X / Y*: also settable by clicking or dragging on the display. The driver doubles as the pickup, so a mode's level is its coupling².

**Pitch**
- *Mapping*:
  - **chromatic**: the note sets pitch.
  - **ladder**: the plate stays at *Plate Tune* and each semitone above that note drives the next resonance, as in the app's "notes → resonances".
- *Voices*: mono (legato, with *Glide*) or 8-voice poly.
- *Plate Tune*: the plate fundamental when it isn't tracking; also rung 1 of the ladder.
- *Key Track*: how far the plate follows the note in chromatic mode.
  - 100%: a normal instrument with a fixed inharmonic timbre.
  - 0%: the plate stays put and the drive sweeps through its resonances, which is the app's behaviour.
- *Release Damp*: how much Q a note-off takes away, like a hand on the plate.

**Excite**
- *Strike*, *Hardness*: mallet level, and contact time as a fraction of the plate's period.
- *Drive*, *Partials*, *Attack / Release*: the sustained drive waveform and its envelope. It is normalised so a partial exactly on a resonance comes out at unity, and between resonances it is nearly silent.

**Drive tone**
- *Waveform*, *Tilt*, *Focus*, *Focus Width*: the app's partial shaping.

**Sand**
- *Field*: off / motion / rms underlay.
- *Palette*, *Grains*, *Trails*, *Crawl*, *Hop*, *Jitter*, *Feed*, *Sand Hue*: as in the app.

## Left out

These parts of the app were dropped:

- Triangle and ring plates, and the ring's inner radius.
- Finger damping, real units (material / size / thickness), and on-screen plate size. In a synth the pitch comes from MIDI.
- LFOs, CC mapping and learn, presets / JSON. Live already does these.
- Plate spin, snap to resonance, sand/powder media, momentary modes, PNG/video export, keyboard shortcuts and parameter search.

## Notes

- In ladder mode the plate doesn't move, so a pure strike sounds the same on every key. Use the drive to hear the ladder.
- The display is an estimate built from the same note events the voices receive, not an analysis of the audio. It normalises to the current level, so the figure fades with the ring-down.
- Each instance has its own tables (`---` buffer names), so several instances don't interfere.
