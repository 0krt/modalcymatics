# chladni // modal

A Chladni plate simulator in a single dependency-free HTML file. A thin plate is
driven at a frequency, its vibration is built from a superposition of the
plate's modes, and grains of sand are bounced off the moving regions until they
settle on the nodal lines.

Open `index.html` in a browser. There is no build step.

## Panel

The controls are split into four tabs.

- **Plate** — shape, edge condition (free, simply supported, clamped, mixed),
  aspect ratio and size; real units (material, size, thickness) for physical
  frequencies; the excitation point; and the list of modes, with a spectrum
  strip that shows the drive partials against the plate's modes.
- **Drive** — presets, waveform, audio output, an EQ with an equal-loudness
  curve, and LFOs that can modulate any mappable parameter.
- **Sand** — grain style, count and behaviour, rendering, and the 2d / 3d view.
  The 3d view lays the current picture over a surface that moves with the
  plate's displacement; drag to orbit, ctrl-scroll to zoom.
- **Setup** — MIDI (notes and CC mapping), PNG, SVG and video export at a fixed
  frame aspect and resolution, key reference,
  and an **About** section that explains the physics.

## Keys

| Key | Action |
|-----|--------|
| `/` or `ctrl-k` | find any parameter |
| `←` `→` | frequency |
| `↑` `↓` | previous / next mode |
| `1`–`9` | the first nine modes (held: momentary) |
| `space` | pause |
| `r` / `g` | scatter grains / randomize |
| `m` | momentary mode |
| `d` / `f` / `y` | grains / field mode / style |
| `t` | 2d / 3d view |
| `s` / `v` | save PNG / record video |
| `h` | show or hide the panel |

On the plate: drag to move the driver, shift-click to pin a damping finger,
scroll to sweep the frequency. In 3d, drag orbits the camera, alt-drag moves
the driver, ctrl-scroll zooms and double-click resets the camera. Double-click a slider to reset it, double-click
a readout to type a value, and use ☆ to pin a parameter under the plate.

Typing `intro` in the search starts a guided introduction that unlocks the
controls one level at a time; progress is kept per browser.

## Storage

Folded sections, pins, LFOs, MIDI mappings and intro progress are kept in
`localStorage`. Nothing leaves the browser.
