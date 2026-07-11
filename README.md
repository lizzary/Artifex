# Artifex

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![中文](https://img.shields.io/badge/lang-%E4%B8%AD%E6%96%87-red)](readme/readme_zh.md)
[![Release](https://img.shields.io/github/v/release/lizzary/Artifex)](https://github.com/lizzary/Artifex/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A self-hosted gallery for the images you generate in **ComfyUI**. Artifex
reads the workflow metadata embedded in each PNG (model, prompts, seed,
sampler, LoRAs, …), auto-tags them with a local vision model, and lets
you search, group, and browse a library of thousands — all on your own
machine, with no cloud and no telemetry.

![Artifex main view](readme/access/main_page.png)

## Why Artifex

Generating with ComfyUI is easy; *managing the output* is not. After a
few weeks of work you have a flat folder of `ComfyUI_00042.png`,
`ComfyUI_00043.png`, …, with all the interesting context (which
checkpoint? which prompt? which LoRA stack?) only retrievable by opening
each PNG back in ComfyUI itself. Generic image managers don't parse
ComfyUI's metadata, and existing ComfyUI extensions don't scale past a
few hundred images.

Artifex sits between ComfyUI and the filesystem:

- **Parses ComfyUI workflow metadata at upload time** — model,
  positive/negative prompt, seed, sampler, scheduler, steps, CFG,
  every LoRA + strength, resolution. The PNG `tEXt`/`iTXt` chunk
  parser is written from scratch; ComfyUI itself does not need to be
  installed.
- **Auto-tags with a local vision model** — [WD EVA02-Large Tagger v3](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3)
  via ONNX Runtime; CUDA execution provider when available, CPU
  fallback otherwise.
- **Full-text search over tags and prompts** — SQLite FTS5 with prefix
  matching: "suns" finds "sunset", "sunshine", "sunlight".
- **Mutually-exclusive smart grouping** — combine tags and prompt terms
  with `AND`, `OR`, `NOT`, and parentheses; each image is assigned to the
  highest-priority matching rule and rendered inside a colored,
  collapsible container. Match priority and page order are configured
  independently.

## Quick start

### Option A — Download the release (Windows)

1. Grab the latest `Artifex_Win64.zip` from
   **[Releases](https://github.com/lizzary/Artifex/releases)**.
2. Extract anywhere and run `Artifex.exe`.
3. Open <http://127.0.0.1:8000>.
4. *(Optional, for AI auto-tagging)* Go to **Settings → Model
   Management → Download Model** — a one-time ~800 MB download from
   HuggingFace.

The server creates `gallery.db` on first launch; uploads land under
`uploads/` next to the binary.

### Option B — Build from source

See **[Development Environment Setup](#development-environment-setup)**.
Requirements at a glance:

- Go 1.26+
- Node.js 20 LTS (for the frontend build)
- GCC / MinGW-w64 — *optional*, only needed for the ONNX auto-tagger;
  a pure-Go build without it is also supported.

## Tech stack

| Layer        | What & why                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Frontend     | React, custom color-grouping renderer, keyboard-driven lightbox with multi-select                       |
| Backend      | Go, [chi](https://github.com/go-chi/chi) router, single static binary serving the embedded frontend     |
| Storage      | SQLite with FTS5 virtual tables for full-text tag/prompt search                                         |
| Auto-tagger  | ONNX Runtime via CGO + WD EVA02-Large Tagger v3; CUDA execution provider with CPU fallback              |
| Metadata     | Custom PNG `tEXt`/`iTXt` chunk parser; reads ComfyUI's serialized workflow JSON without ComfyUI present |
| Thumbnails   | Three quality tiers (400 px / 1200 px / original), lazy-generated on first request                      |
| Packaging    | Portable zip distribution; binary + DLL + frontend in one directory, no installer                       |
| i18n         | Built-in English and 中文; switchable at runtime without reload                                          |

## Screenshots

| Color grouping (signature feature)              | ComfyUI metadata in lightbox                       |
| ----------------------------------------------- | -------------------------------------------------- |
| ![Color groups](readme/access/color_groups1.png) | ![Lightbox metadata](readme/access/lightbox_metadata.png) |

| Global FTS5 search                                | Tag editor with autocomplete                    |
| ------------------------------------------------- | ----------------------------------------------- |
| ![Search](readme/access/search_overlay.png)       | ![Tag edit](readme/access/lightbox_tag_edit.png) |

---

## Features

### Mutually-exclusive color grouping

Artifex's signature organizing feature. Each rule can combine **tags and
positive/negative prompt terms** in one expression. Conditions support
`AND`, `OR`, `NOT`, and nested parentheses, with standard precedence:
parentheses and `NOT` first, then `AND`, then `OR`.

Rules have an explicit **match priority**. Higher-priority groups run
first, and an image leaves the pipeline as soon as it matches, keeping
groups mutually exclusive; anything unmatched falls into "Other".
Match priority is independent from the drag order used to arrange groups
on the page.

Each group gets a distinct default color and is rendered as a collapsible
container. You can also choose a palette color or an exact custom color for
each group, visually separating themes, characters, or styles at a glance.

- **Mixed-source autocomplete** — every condition suggests both existing
  tags and prompt terms, with a source badge
- **Source-aware conditions** — search tags, prompts, or both for each term
- **Independent ordering** — drag full cards for page order and compact
  priority blocks for first-match order

You can save multiple grouping configurations (sets) and switch between
them; each has its own independent definitions.

![Color grouping example](readme/access/color_groups2.png)
![Group configuration](readme/access/group_config_modal.png)

### AI-powered auto-tagging

Upload images and the built-in
[WD EVA02-Large Tagger v3](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3)
(~800 MB) automatically generates descriptive tags. CUDA acceleration is
used when available; on machines without a supported GPU, the tagger
falls back to CPU automatically.

Auto-tagging can be toggled on/off in Settings, and you can upload
custom tagger models if you prefer a different one.

![Auto-tag settings](readme/access/settings_auto_tag.png)

### Global tag search (SQLite FTS5)

Full-text search powered by SQLite FTS5, available from every page. Type
any keyword in the search bar and instantly find every image whose tags
match. Prefix matching means partial terms work too: "suns" returns
"sunset", "sunshine", "sunlight".

### ComfyUI metadata extraction

Artifex parses the workflow metadata that ComfyUI embeds in every
generated PNG and surfaces the following fields in the lightbox details
panel (press `Ctrl+D` to toggle):

| Field               | Example                                     |
| ------------------- | ------------------------------------------- |
| **Model**           | `dreamshaperXL_v21.safetensors`             |
| **Positive prompt** | Full text of the positive prompt            |
| **Negative prompt** | Full text of the negative prompt            |
| **Seed**            | `3478264912`                                |
| **Sampler**         | `DPM++ 2M Karras`                           |
| **Scheduler**       | `Karras`                                    |
| **Steps**           | `20`                                        |
| **CFG scale**       | `7.0`                                       |
| **LoRAs**           | Name and strength values for each LoRA used |
| **Resolution**      | `1920 × 1080`                               |
| **File size**       | `2.4 MB`                                    |
| **Date**            | File mtime                                  |

![Lightbox metadata](readme/access/lightbox_metadata.png)

### Custom tag editing

Tags aren't read-only. In the lightbox details panel, click the pencil
icon to enter edit mode, then add or remove tags with autocomplete
suggestions drawn from every existing tag across your library. Press
Enter to add, Save to persist.

Custom tags are immediately discoverable through global search, the tags
browser, and in-page filters — they integrate with every tag-aware
feature.

![Custom tag editing](readme/access/lightbox_tag_edit.png)

### Group management

Organize images into **Groups** (think of them as albums or projects).
Each group can have a cover image and shows a live count of its
contents. Create, rename, or delete groups — deleting a group cascades
to remove all its images and files.

![Group grid](readme/access/home_groups.png)

### Lightbox viewer

Click any image to open the full-screen lightbox. Navigate with arrow
keys, toggle the details panel with `Ctrl+D`, set the current image as
the group cover, or delete it directly.

### Multi-select & batch operations

Select images using familiar keyboard shortcuts:

- **Click** — view in the lightbox
- **Ctrl+Click** — toggle individual selection
- **Shift+Click** — range-select between two points

Once selected, batch **download** (with customizable file naming) or
batch **delete** in one action.

![Batch selection](readme/access/batch_selection.png)

### Tags & Prompts browsers

Dedicated pages (`/tags` and `/prompts`) list every unique tag and
prompt term in your library, as filterable chips. Click any tag to see
how many images carry it, or type to narrow the list — a quick way to
explore your collection's vocabulary.

![Tags browser](readme/access/tags_page.png)

### Custom download naming

Configure how downloaded files are named with a template system. Insert
placeholders such as `<Model>`, `<Seed>`, `<Steps>`, `<Sampler>`,
`<Resolution>`, `<Date>`, `<Group>`, and others — they are replaced with
each image's actual values at download time.

![Download naming](readme/access/settings_download.png)

### Other niceties

- **Sort / filter / paginate inside any view** — sort by resolution,
  file size, or date; filter by tags or prompt terms with autocomplete
  (composable with color grouping); page sizes of 50 / 100 / 200 / 500
  / 1000 / All.
- **Multi-quality thumbnails** — 400 px / 1200 px / original, switchable
  on the fly via the quality dropdown. Missing tiers for pre-existing
  images are generated lazily on first request.
- **Sequential upload with live progress** — filename and percentage
  shown in real time; failed files are reported but don't block the
  rest of the batch.
- **Dark & light themes** — persisted across sessions, with semantic
  color tokens for consistent readability.
- **Internationalization** — English and 中文; switchable in Settings
  without page reload.

---

## Development Environment Setup

> **Target audience:** Developers who want to build Artifex from source
> or modify the backend / frontend. End users should follow
> **[Quick start → Option A](#option-a--download-the-release-windows)** instead.

### 1. Clone the repository

```bash
git clone https://github.com/lizzary/Artifex.git
cd Artifex
```

Repository layout:

```
Artifex/
├── backend-go/           # Go backend server
│   ├── main.go           # Entry point
│   ├── internal/
│   │   ├── server/       # HTTP handlers (chi router)
│   │   ├── tagger/       # ONNX auto-tagging engine
│   │   ├── database/    # SQLite init & helpers
│   │   ├── metadata/     # ComfyUI PNG metadata parser
│   │   ├── thumbnail/    # Thumbnail generation
│   │   ├── settings/     # JSON settings loader
│   │   └── models/       # Shared data structs
│   ├── build.bat         # Windows build script (CMD)
│   ├── Makefile          # Build script (GNU Make)
│   └── settings.json     # Default config
├── frontend/             # React frontend
│   ├── src/
│   ├── public/
│   └── build/            # Production build output
├── readme/               # README assets (screenshots, zh translation)
└── README.md
```

### 2. Install Go

**Windows:** download the installer from <https://go.dev/dl/> and run
it, or extract the portable archive to `C:\Users\<username>\sdk\go1.26.4`
and add it to `PATH`:

```cmd
setx PATH "%PATH%;C:\Users\<username>\sdk\go1.26.4\bin"
```

Restart the terminal and verify:

```cmd
go version
:: Expected: go version go1.26.4 windows/amd64
```

**Linux:**

```bash
wget https://go.dev/dl/go1.26.4.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.26.4.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin   # add to ~/.bashrc for persistence
go version
```

### 3. Install Node.js

Download the LTS installer from <https://nodejs.org/> (v20 LTS
recommended). Verify:

```bash
node --version
npm --version
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

### 4. Build the frontend

```bash
cd frontend
npm run build
```

This produces `frontend/build/` — the production-optimized static files.
The Go backend serves them directly.

For development with hot reload:

```bash
npm start
# Starts React dev server at http://localhost:3000
# API calls are proxied to the Go backend (configure in package.json "proxy")
```

---

> **Steps 5–7 are only needed if you want AI-powered auto-tagging.**
> If you only need the core features (upload, browse, search, manual
> tags, metadata, color grouping), skip to
> **[Step 8 → Build without ONNX](#build-without-onnx-pure-go-no-auto-tagging)**.

### 5. Install GCC (MinGW-w64 on Windows)

The ONNX Runtime Go bindings require **CGO**, which needs a C compiler.

**Windows — winlibs (quick, standalone):**

1. Go to <https://github.com/brechtsanders/winlibs_mingw/releases>
2. Download the latest **Win64 Zip** without LLVM/Clang, e.g.
   `winlibs-x86_64-posix-seh-gcc-15.2.0-mingw-w64-13.0.0-r1.zip`
3. Extract to `C:\mingw64`
4. Add `C:\mingw64\bin` to your system `PATH`:

```cmd
setx PATH "%PATH%;C:\mingw64\bin"
```

Restart the terminal and verify:

```cmd
gcc --version
:: Expected: gcc (MinGW-W64 ...) 15.2.0 (or similar)
```

**Linux:**

```bash
sudo apt install build-essential   # Debian/Ubuntu — GCC included
```

### 6. Install the ONNX Runtime shared library

The ONNX Runtime shared library is required **at runtime**, not just at
build time. It must be discoverable by the OS dynamic linker.

**Windows:**

1. Go to <https://github.com/microsoft/onnxruntime/releases>
2. Download the release matching your Go bindings version (v1.21.x
   recommended): `onnxruntime-win-x64-<version>.zip`
3. Extract and copy `onnxruntime.dll` (and optionally
   `onnxruntime_providers_shared.dll` / `onnxruntime_providers_cuda.dll`
   for GPU) into the **same directory** as `artifex-server.exe`:

```
backend-go/
├── artifex-server.exe
├── onnxruntime.dll                    <-- required
├── onnxruntime_providers_shared.dll   <-- optional (GPU)
└── ...
```

> On Windows the executable's directory is automatically searched for
> DLLs, so placing `onnxruntime.dll` next to the `.exe` is sufficient.

**Linux:**

```bash
wget https://github.com/microsoft/onnxruntime/releases/download/v1.21.0/onnxruntime-linux-x64-1.21.0.tgz
tar -xzf onnxruntime-linux-x64-1.21.0.tgz
sudo cp onnxruntime-linux-x64-1.21.0/lib/libonnxruntime.so* /usr/local/lib/
sudo ldconfig
```

### 7. Download the tagger model

The tagger model (`wd-eva02-large-tagger-v3`, ~800 MB) can be obtained
in two ways:

**A) From the Settings page (recommended):**

Once the server is running, open <http://127.0.0.1:8000>, go to
**Settings → Model Management**, and click **Download Model**. The
server fetches the ONNX model and label CSV from HuggingFace
automatically.

**B) Manual download:**

```bash
cd backend-go
mkdir -p models/default

curl -L -o models/default/wd-eva02-large-tagger-v3.onnx \
  https://huggingface.co/lizzary111/wd-eva02-large-tagger-v3/resolve/main/wd-eva02-large-tagger-v3.onnx

curl -L -o models/default/wd-eva02-large-tagger-v3.onnx.data \
  https://huggingface.co/lizzary111/wd-eva02-large-tagger-v3/resolve/main/wd-eva02-large-tagger-v3.onnx.data

curl -L -o models/default/tags.csv \
  https://huggingface.co/lizzary111/wd-eva02-large-tagger-v3/resolve/main/tags.csv
```

Expected files:

```
backend-go/models/default/
├── wd-eva02-large-tagger-v3.onnx       (~800 MB)
├── wd-eva02-large-tagger-v3.onnx.data  (external weights)
└── tags.csv                            (tag labels)
```

### 8. Build the backend

Two build modes — pick one.

#### Build with ONNX auto-tagging

**Prerequisites:** steps 5–7 completed (GCC + `onnxruntime.dll` + model).

```cmd
cd backend-go

:: Windows CMD / PowerShell:
build.bat build

:: Or with Make:
make build
```

This produces `artifex-server.exe` with the full ONNX-powered
auto-tagging pipeline.

### 9. Run the server

```cmd
cd backend-go

:: Start the server:
artifex-server.exe

:: Or specify a custom host/port:
artifex-server.exe -host 0.0.0.0 -port 8080

:: Or via the build script (dev mode):
build.bat run
```

**Command-line flags:**

| Flag        | Default                | Description                                   |
| ----------- | ---------------------- | --------------------------------------------- |
| `-host`     | `127.0.0.1`            | Listen address (use `0.0.0.0` for LAN access) |
| `-port`     | `8000`                 | Listen port                                   |
| `-db`       | `<basedir>/gallery.db` | SQLite database path                          |
| `-uploads`  | `<basedir>/uploads`    | Image storage directory                       |
| `-models`   | `<basedir>/models`     | ONNX model directory                          |
| `-frontend` | auto-detect            | Frontend build directory                      |

Open your browser at **<http://127.0.0.1:8000>**.

On first launch:

1. The server creates `gallery.db` (SQLite) automatically.
2. If auto-tagging is enabled in `settings.json`, it tries to load the
   ONNX model.
3. If the model is missing, the server logs a message and continues
   without auto-tagging.
4. Go to **Settings → Model Management** to download the model.

### 10. Distribution packaging

To create a standalone, redistributable build:

```cmd
cd backend-go

:: Backend + config only:
build.bat dist

:: Backend + config + frontend:
build.bat dist-full
```

Output structure:

```
dist/Artifex/
├── Artifex.exe              # Server binary
├── settings.json            # Default config
├── models/
│   ├── default/             # ONNX models (download separately)
│   └── user_model/          # Custom user models
├── uploads/                 # Image storage
└── _internal/
    └── frontend/            # React build (dist-full only)
```

Copy the `dist/Artifex/` folder to any Windows machine and run
`Artifex.exe`.

---

## Troubleshooting

**"Tagger not available: failed to initialize ONNX Runtime"**

`onnxruntime.dll` was not found at runtime. Check that:

1. The DLL is in the **same directory** as `artifex-server.exe`.
2. If the DLL lives elsewhere on `PATH`, verify with
   `where onnxruntime.dll`.
3. The DLL architecture (x64) matches your Go build (`GOARCH=amd64`).

**"Tagger not available: default model not found"**

The ONNX model file is missing. Either:

- Open **Settings → Model Management → Download Model** in the web UI, or
- Download manually as described in **[Step 7](#7-download-the-tagger-model)**.

**"gcc: executable file not found in %PATH%"**

GCC / MinGW is not installed or not on `PATH`. Follow
**[Step 5](#5-install-gcc-mingw-w64-on-windows)** and restart the
terminal. Verify with `gcc --version`.

**Auto-tagging produces empty or incorrect tags**

1. Check that all three model files are present in `models/default/`.
2. Check the server console — it should print `Tagger ready (<N> tags).`.
3. If `settings.json → gpu_enabled` is `true`, try disabling it; the
   CUDA execution provider may be unavailable on this machine.

**Frontend shows a blank page or 404**

The server couldn't locate the frontend build. Either:

- Build the frontend: `cd frontend && npm run build`, or
- Point to the build directory explicitly:
  `artifex-server.exe -frontend ../frontend/build`.

The server auto-detects `_internal/frontend/` (packaged build first),
then `../frontend/build` (dev layout).

**Port 8000 is already in use**

```cmd
:: Windows — find and kill the process:
netstat -ano | findstr :8000
taskkill /PID <PID> /F

:: Or pick a different port:
artifex-server.exe -port 8001
```

---

## License

[MIT](LICENSE) — see the LICENSE file.
