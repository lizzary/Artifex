# Frame Crab Bubble Tea viewer

A minimal Bubble Tea application that only displays the Frame Crab terminal pixel art.

The generated sprite compensates for the usual terminal-cell aspect ratio: a terminal
cell is approximately twice as tall as it is wide. The converter duplicates every
logical source pixel horizontally **before** 2×2 quadrant packing. This changes a
32×32 logical sprite from roughly 16×16 terminal cells to roughly 32×16 terminal
cells, so the displayed geometry is no longer horizontally compressed.

Do not fix the aspect ratio by duplicating the final Unicode glyphs. A glyph such as
`▌` contains its own left/right quadrant mask; repeating it would repeat that mask
instead of stretching the underlying logical pixels.

## Requirements

- Go 1.18 or newer
- A UTF-8 terminal
- True-color support is recommended

## Run

```bash
go mod tidy
go run .
```

Press `q`, `Esc`, or `Ctrl+C` to exit.

## Build

```bash
go build -o frame-crab .
./frame-crab
```

## Regenerate the sprite

Install Pillow and run the bundled converter:

```bash
python -m pip install Pillow
python tools/image_to_quadrant.py input.png \
  --format go \
  --horizontal-scale 2 \
  --package main \
  --name FrameCrab \
  --output frame_crab.go
```

`--horizontal-scale 2` is the aspect-correct mode and is now the default. Use
`--horizontal-scale 1` only for terminals or fonts whose character cells are close
to square.
