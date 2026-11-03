# HERO 68 Config

An open desktop configurator for the **AULA HERO 68 HE** (Hall-effect, wired) keyboard. It replaces the
WebHID site at hero.aulastar.com, which only runs in Chrome/Edge.

Built with Electron + WebHID: no drivers, no native modules, no browser needed.

> Unofficial project, not affiliated with or endorsed by AULA. Use at your own risk.

## Download

Grab the latest build from [Releases](https://github.com/MeWeGo/hero68-config/releases/latest):

- **HERO68-Config-Portable-x.y.z.exe**: just run it, nothing gets installed.
- **HERO68-Config-Setup-x.y.z.exe**: installer with a Start-menu shortcut.

Plug the keyboard in by USB and click **Connect** once. After that the app connects automatically.
Windows SmartScreen may warn because the exe isn't code-signed. Click *More info → Run anyway*.

## Build from source

```bash
npm install
npm start       # run in dev
npm run dist    # build the Windows installer + portable exe into dist/
```

## Releasing

Releases are built by GitHub Actions only when a version tag is pushed. Normal commits don't trigger a build.

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow sets the app version from the tag, builds both exes, and publishes them to a GitHub release
named after the tag.

## Features

| Tab | What it does |
| --- | --- |
| Performance | Per-key actuation point (0.10–4.00 mm) and Rapid Trigger press/release sensitivity (0.01–4.00 mm). Drag or Ctrl+click to multi-select. |
| Keymap | Remap any key on the Base / Fn1 / Fn2 layers, including media, mouse, shortcut combos, and the board's own functions (profiles, lighting controls). |
| Lighting | Main RGB mode/colour/brightness/speed, side light, per-key colours (for the "Custom" mode). |
| Settings | Polling rate (125 Hz – 8 kHz), Win-key lock, Mac mode, device info. |
| Header | Switch between onboard profiles P1–P3. |

Not done yet: macros, advanced keys (DKS, mod-tap, toggle, SOCD), switch calibration, sleep timer.
The protocol for all of these is in the official bundle (see `Lt` class notes below) if you want to add them.

## Protocol (reverse engineered)

Source: the `kb_by_v3_wired` controller in the official site's JS bundle. Every command below was
checked against a real board (firmware 3.20, UUID `0x110000000003`).

**Transport.** Vendor HID interface 2, usage page `0xFF60` / usage `0x61`. Output and input report id **9**,
63-byte payload:

```
[0] cmd  [1] sub/layer  [2] 0  [3] packet count  [4] packet index  [5] data len  [6..61] data  [62] checksum
checksum = 255 - (9 + sum(bytes[0..61])) % 256
```

Reads use `cmd | 0x80` and the reply echoes that byte. Writes are acked with an echo of the write `cmd`.
The `len` byte in a reply isn't always right (firmware reports 1 but carries 2 bytes), so read fixed offsets.

| Read | Write | Meaning | Data |
| --- | --- | --- | --- |
| `82 01` | – | UUID (model id) | 6 bytes BE |
| `82 02` | – | firmware | `lo, hi` (0x0320) |
| `82 06` / `82 08` | – | RT / distance precision | µm per unit (10 → 0.01 mm) |
| `84 01` | `04 01` | main lighting | `mode, rainbow?7:0, r, g, b, bright(0-20), speed(0-4)` |
| `84 06` | `04 06` | side light | same, bright 0-4. Write len = rainbow ? 4 : 7 |
| `84 11` | `04 11` | Mac mode | `0/1` |
| `84 15` | `04 15` | Win lock | `0/1` |
| `84 17` | `04 17` | polling level | 0=1k 1=500 2=250 3=125 4=8k 5=4k 6=2k. **The board re-enumerates on USB after a write.** |
| `90` | `10` | active profile | `0..2` |
| `83 <layer>` | `03 <layer>` | keymap | read: pos u16 list (≤9); entries `pos u16, keycode u32` |
| `93` | `13` | actuation | entries `pos u16, dist u16 (units), custom 0/1` (≤11/packet) |
| `99` | `19` | rapid trigger | entries `pos u16, enable, release u16, press u16, custom 0/1` (≤6/packet) |
| `86` | `06` | per-key RGB | entries `pos u16, r, g, b`. Writes are multi-packet using `[3]`/`[4]` |
| – | `11 <layer>` | reset layer | data `01` |

**Keycodes** are 32-bit `TT MM KK LL`:
- `00 00 00 xx` is a HID usage. `00 mm kk 00` is a modifier combo (mm: 1=Ctrl 2=Shift 4=Alt 8=Win).
- `01` = mouse, `02 00 xx xx` = consumer/media, `03` = macro, `0d` = Fn.
- `07` = system (`0e` Win / `0f` Mac mode).
- `08 AA BB CC` = lighting control (AA 0 on/off, 2 mode, 3 bright, 4 speed. BB 1 up, 2 down. CC 0 main, 1 side).
- `09 00 00 nn` = switch to profile nn+1.

Key positions (`pos`) and on-screen geometry are in `src/data/layout68.js`.
