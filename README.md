# ARTIFEX

<div align="center">

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![中文](https://img.shields.io/badge/lang-中文-red)](readme/readme_zh.md)

</div>

**Artifex** is a self-hosted image management tool designed for art enthusiasts and creators. It helps you organize, search, and browse your ComfyUI-generated illustrations with powerful tagging, metadata extraction, and visual grouping features.

---

![Global Search](readme/access/main_page.png)
## Features

### Global Tag Search

A blazing-fast full-text search engine powered by SQLite FTS5. Type any keyword into the search bar — available from every page — and instantly find every illustration whose tags match. Prefix matching means partial terms work too: type "suns" and you get "sunset", "sunshine", "sunlight".

<!-- Screenshot: placeholder for search bar / search results -->
![Global Search](readme/access/search_overlay.png)

### AI-Powered Auto-Tagging

Upload images and let the built-in [WD EVA02-Large Tagger v3](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3) (~800 MB) automatically generate descriptive tags. Supports GPU acceleration (CUDA) for faster processing, with automatic CPU fallback. You can also upload custom tagger models if you prefer a different one.

Auto-tagging can be toggled on/off globally in Settings — useful when you only want manual tags.

<!-- Screenshot: placeholder for settings page with auto-tag toggle -->
![Auto-Tag Settings](readme/access/settings_auto_tag.png)

### ComfyUI Metadata Extraction

Images generated through ComfyUI embed rich metadata — Gallery reads it all. For each illustration, the following properties are automatically extracted and displayed:

| Property | Example |
|----------|---------|
| **Model** | `dreamshaperXL_v21.safetensors` |
| **Positive Prompt** | Full text of the positive prompt |
| **Negative Prompt** | Full text of the negative prompt |
| **Seed** | `3478264912` |
| **Sampler** | `DPM++ 2M Karras` |
| **Scheduler** | `Karras` |
| **Steps** | `20` |
| **CFG Scale** | `7.0` |
| **LoRAs** | Name and strength values for each LoRA used |
| **Resolution** | `1920 x 1080` |
| **File Size** | `2.4 MB` |
| **Date** | File creation timestamp |

All metadata is viewable in the Lightbox details panel (press `Ctrl+D` to toggle).

<!-- Screenshot: placeholder for lightbox with metadata panel open -->
![ComfyUI Metadata](readme/access/lightbox_metadata.png)

### Custom Tag Editing

Tags aren't just read-only — you can edit them. In the Lightbox details panel, click the pencil icon to enter edit mode, then add or remove tags with autocomplete suggestions drawn from all existing tags across your entire library. Press Enter to add a tag, Save to persist.

Custom tags you add are immediately discoverable through the global search, the tags browser, and the in-page filter — they integrate seamlessly with every tag-aware feature.

<!-- Screenshot: placeholder for tag editing in lightbox -->
![Custom Tag Editing](readme/access/lightbox_tag_edit.png)

### Mutually Exclusive Color Grouping (Visual Clustering)

This is Gallery's signature organizing feature. Define **keyword pairs** — each pair specifies a set of keywords that must all match for an illustration to belong to that group. Illustrations are assigned to the **first** matching pair, making groups mutually exclusive. Anything unmatched falls into the "Other" group.

Each group gets a distinct color, and groups are rendered as **collapsible colored containers** — visually separating different themes, characters, or styles at a glance.

- **Tag-based groups**: match against illustration tags (auto-generated or custom)
- **Prompt-based groups**: match against the Positive and Negative Prompt text extracted from ComfyUI metadata
- 
<!-- Screenshot: placeholder for color grouping in action -->
![Color Grouping](readme/access/color_groups1.png)

![Color Grouping](readme/access/color_groups2.png)

You can switch between multiple saved grouping configurations (sets), each with its own independent group definitions.

<!-- Screenshot: placeholder for group configuration modal -->
![Group Configuration](readme/access/group_config_modal.png)

### Tags & Prompts Browsers

Dedicated pages (`/tags` and `/prompts`) list every unique tag and prompt term in your library. Browse them as filterable chips — click any tag to see how many illustrations carry it, or type to narrow the list. A great way to explore your collection's vocabulary.

<!-- Screenshot: placeholder for tags page -->
![Tags Browser](readme/access/tags_page.png)

### Group Management

Organize illustrations into **Groups** (think of them as albums or projects). Each group can have a cover illustration and shows a live count of its contents. Create, rename, or delete groups — deleting a group cascades to remove all its illustrations and files.

<!-- Screenshot: placeholder for home page with group grid -->
![Group Grid](readme/access/home_groups.png)

### Multi-Select & Batch Operations

Select illustrations using familiar keyboard shortcuts:
- **Click** to view in the Lightbox
- **Ctrl+Click** to toggle individual selection
- **Shift+Click** to range-select between two points

Once selected, batch **download** (with customizable file naming) or batch **delete** in one action.

<!-- Screenshot: placeholder for batch selection -->
![Batch Selection](readme/access/batch_selection.png)

### Custom Download Naming

Configure how downloaded files are named using a flexible template system. Insert placeholders like `<Model>`, `<Seed>`, `<Steps>`, `<Sampler>`, `<Resolution>`, `<Date>`, `<Group>`, and more — they are replaced with actual values from each illustration's data and metadata when downloading.

<!-- Screenshot: placeholder for download naming format settings -->
![Download Naming](readme/access/settings_download.png)

### Multi-Quality Thumbnails

Three quality levels for browsing — switch on the fly with the Quality dropdown:

| Quality | Max Size | Use Case |
|---------|----------|----------|
| **Low** | 400 px | Fast browsing, large pages |
| **Normal** | 1200 px | Balanced detail & performance |
| **Original** | Full size | Pixel-level inspection |

Thumbnails are generated on upload. Missing quality levels for pre-existing images are auto-generated on first request.

### Lightbox Viewer

Click any illustration to open the full-screen Lightbox. Navigate with arrow keys, toggle the details panel (`Ctrl+D`) to see file info, ComfyUI metadata, and tags. Set the current image as the group cover or delete it directly.

<!-- Screenshot: placeholder for lightbox view -->
![ComfyUI Metadata](readme/access/lightbox_metadata.png)

### Sort, Filter & Pagination

Inside any group or search result:
- **Sort** by resolution, file size, or date created (ascending/descending)
- **Filter** in-page by tags or prompt terms with autocomplete (works alongside color grouping)
- **Paginate** with configurable page sizes: 50, 100, 200, 500, 1000, or All

### Sequential Upload with Progress

Upload multiple images at once — they are processed one by one with a live progress bar showing filename and percentage. Failed files are reported but don't block the rest of the batch.

### Dark & Light Themes

Switch between dark and light color schemes with a single click. Your preference is persisted across sessions. Both themes are carefully designed with semantic color tokens for consistent, readable interfaces.

### Internationalization (i18n)

Built-in support for **English** and **中文 (Chinese)**. All user-facing text is keyed through the translation system. Switch languages in Settings — the change applies instantly without a page reload.

---

## Development Environment Setup

> **Target audience:** Developers who want to build and run Artifex from source, or contributors who need to modify the backend / frontend.
### 1. Clone the Project

```bash
git clone <repository-url>
cd Artifex-dev
```

The repository layout:

```
Artifex-dev/
├── backend-go/           # Go backend server
│   ├── main.go           # Entry point
│   ├── internal/
│   │   ├── server/       # HTTP handlers (chi router)
│   │   ├── tagger/       # ONNX auto-tagging engine
│   │   ├── database/     # SQLite init & helpers
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
└── README.md
```

### 2. Install Go SDK

**Windows:**

Download the installer from https://go.dev/dl/ and run it, or unzip the portable archive to `C:\Users\<username>\sdk\go1.26.4`. Then add Go to your system **PATH**:

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
export PATH=$PATH:/usr/local/go/bin  # add to ~/.bashrc for persistence
go version
```

### 3. Install Node.js (Frontend)

Download the LTS installer from https://nodejs.org/ (v20 LTS recommended). After installation, verify:

```cmd
node --version
npm --version
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

### 4. Build the Frontend

```bash
cd frontend
npm run build
```

This produces `frontend/build/` — the production-optimized static files. The Go backend serves them directly.

For development with hot-reload:

```bash
npm start
# Starts React dev server at http://localhost:3000
# API calls are proxied to the Go backend (configure in package.json "proxy")
```

<div align="center">

**[Optional] ONNX Auto-Tagging (Steps 5–7)**

</div>

> The following three steps are **only needed if you want AI-powered auto-tagging**. If you only need the core gallery features (upload, browse, search, manual tags, metadata, color groups), skip to **Step 9** and use the pure-Go build.

### 5. Install GCC (MinGW-w64 on Windows)

The ONNX Runtime Go bindings require **CGO**, which needs a C compiler.

**winlibs (quick, standalone):**

1. Go to https://github.com/brechtsanders/winlibs_mingw/releases
2. Download the latest **"Win64 Zip"** (without LLVM/Clang), e.g. `winlibs-x86_64-posix-seh-gcc-15.2.0-mingw-w64-13.0.0-r1.zip`
3. Extract to `C:\mingw64`
4. Add `C:\mingw64\bin` to your system **PATH**

```cmd
setx PATH "%PATH%;C:\mingw64\bin"
```

**Verify GCC:**

```cmd
:: Restart your terminal first, then:
gcc --version
:: Expected: gcc (MinGW-W64 ...) 15.2.0  (or similar)
```

**Linux:**

```bash
sudo apt install build-essential   # Debian/Ubuntu
# GCC is included
```

### 6. Install ONNX Runtime DLL

The ONNX Runtime shared library is required at **runtime** (not just build time). It must be discoverable by the OS dynamic linker.

**Windows:**

1. Go to https://github.com/microsoft/onnxruntime/releases
2. Download the latest release matching your Go bindings version (v1.21.x recommended):
   - Choose `onnxruntime-win-x64-<version>.zip`
3. Extract and copy `onnxruntime.dll` (and optionally `onnxruntime_providers_shared.dll` / `onnxruntime_providers_cuda.dll` for GPU) into the **same directory** as `artifex-server.exe`:

   ```
   backend-go/
   ├── artifex-server.exe
   ├── onnxruntime.dll          <-- required
   ├── onnxruntime_providers_shared.dll  <-- optional (GPU)
   └── ...
   ```

> On Windows the executable's directory is automatically searched for DLLs, so placing `onnxruntime.dll` next to the `.exe` is sufficient.

**Linux:**

```bash
# Download and install the .so
wget https://github.com/microsoft/onnxruntime/releases/download/v1.21.0/onnxruntime-linux-x64-1.21.0.tgz
tar -xzf onnxruntime-linux-x64-1.21.0.tgz
sudo cp onnxruntime-linux-x64-1.21.0/lib/libonnxruntime.so* /usr/local/lib/
sudo ldconfig
```

### 7. Download the AI Tagger Model

The tagger model (`wd-eva02-large-tagger-v3`, ~800 MB) can be downloaded in two ways:

**A) From the Settings page (recommended):**

Once the server is running, open http://127.0.0.1:8000, go to **Settings → Model Management**, and click **Download Model**. The server fetches the ONNX model + labels CSV from HuggingFace automatically.

**B) Manual download:**

```bash
cd backend-go
mkdir -p models/default

# Download from HuggingFace
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

### 8. Build the Backend

You have **two build modes** — pick one:

#### Build with ONNX Auto-Tagging

**Prerequisites:** Steps 6–8 must be completed first (GCC + onnxruntime.dll + model).

```cmd
cd backend-go

:: Windows CMD / PowerShell:
build.bat build

:: Or with Make:
make build
```

This produces `artifex-server.exe` with the full ONNX-powered auto-tagging pipeline.

> **Build script reference** — `build.bat` accepts these targets:
>
> | Command | Result |
> |---------|--------|
> | `build.bat` | Full CGO + ONNX |
> | `build.bat run` | Dev server (http://127.0.0.1:8000) |
> | `build.bat clean` | Remove build artifacts |
> | `build.bat dist` | Package into `dist/Artifex/` |
> | `build.bat dist-full` | Package with frontend included |

### 9. Run the Server

```cmd
cd backend-go

:: Start the server:
artifex-server.exe

:: Or specify custom host/port:
artifex-server.exe -host 0.0.0.0 -port 8080

:: Or use the build script (pure Go dev mode):
build.bat run
```

**Command-line flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `-host` | `127.0.0.1` | Listen address (use `0.0.0.0` for LAN access) |
| `-port` | `8000` | Listen port |
| `-db` | `<basedir>/gallery.db` | SQLite database path |
| `-uploads` | `<basedir>/uploads` | Image storage directory |
| `-models` | `<basedir>/models` | ONNX model directory |
| `-frontend` | auto-detect | Frontend build directory |

Open your browser to **http://127.0.0.1:8000**.

On first launch:

1. The server creates `gallery.db` (SQLite) automatically
2. If auto-tag is enabled in `settings.json`, it tries to load the ONNX model
3. If the model is missing, it prints a message and continues without auto-tagging
4. Go to **Settings → Model Management** to download the model

### 10. Distribution Packaging

To create a standalone distribution for deployment:

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

Copy the `dist/Artifex/` folder to any Windows machine and run `Artifex.exe`.

### 11. Troubleshooting

<details>
<summary><b>"Tagger not available: failed to initialize ONNX Runtime"</b></summary>

`Onnxruntime.dll` was not found at runtime. Verify:

1. The `.dll` file is in the **same directory** as `artifex-server.exe`
2. If the DLL is in PATH but not next to the exe, check with `where onnxruntime.dll`
3. The DLL architecture (x64) matches your Windows and Go build (`GOARCH=amd64`)

</details>

<details>
<summary><b>"Tagger not available: default model not found"</b></summary>

The ONNX model file is missing. Either:

- Go to **Settings → Model Management → Download Model** from the web UI, or
- Manually download as described in Step 8
</details>

<details>
<summary><b>"gcc: executable file not found in %PATH%"</b></summary>

GCC/MinGW is not installed or not in PATH. Follow Step 6, then restart your terminal. Verify with `gcc --version`.
</details>

<details>
<summary><b>Auto-tagging produces empty / incorrect tags</b></summary>

1. Check the model files are complete (all 3 files in `models/default/`)
2. Check server console output — it should say `Tagger ready (<N> tags).`
3. If using GPU (`settings.json` → `gpu_enabled: true`), try disabling it: the CUDA provider may be unavailable
</details>

<details>
<summary><b>Frontend shows blank page or 404</b></summary>

The server couldn't find the frontend build. Either:

- Build the frontend first: `cd frontend && npm run build`
- Or point to the build directory explicitly: `artifex-server.exe -frontend ../frontend/build`
- The server auto-detects `_internal/frontend/` (packaged), then `../frontend/build` (dev)
</details>

<details>
<summary><b>Port 8000 is already in use</b></summary>

```cmd
:: Windows — find and kill the process:
netstat -ano | findstr :8000
taskkill /PID <PID> /F

:: Or just use a different port:
artifex-server.exe -port 8001
```
</details>

