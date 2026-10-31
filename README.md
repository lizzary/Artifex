# Artifex

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![中文](https://img.shields.io/badge/lang-%E4%B8%AD%E6%96%87-red)](readme/readme_zh.md)
[![Release](https://img.shields.io/github/v/release/lizzary/Artifex)](https://github.com/lizzary/Artifex/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Website:** [https://artifex.havenlab.tech/](https://artifex.havenlab.tech/)

## How to install

### 1. Download

Open the [latest release](https://github.com/lizzary/Artifex/releases/latest) and download the archive for your platform:

| Platform | Archive |
| --- | --- |
| Windows x64 | `artifex-windows-amd64.zip` |
| Linux x64 | `artifex-linux-amd64.tar.gz` |
| macOS Apple Silicon | `artifex-darwin-arm64.tar.gz` |

### 2. Extract and launch

Extract the archive to a folder you can write to. Keep the executable, the bundled ONNX Runtime library, and the `frontend/` directory together.

- **Windows:** double-click `artifex.exe`.
- **Linux / macOS:** open a terminal in the extracted folder and run `./artifex`.

Enter `/open` in the terminal interface to open Artifex in your browser, or visit the URL shown in the terminal. The default address is `http://127.0.0.1:8000`; if the port is occupied, Artifex tries subsequent ports, so use the address displayed at startup.

### 3. Optional: install the tagging model

To enable automatic image tagging, open **Settings → Image Indexing → Download Default Model** in the web interface. The model is about **1.2 GB** and is downloaded separately from the release archive.

You can use Artifex without the model. If it is unavailable during upload, choose to continue without automatic tags.

## ComfyUI plugin

For the ComfyUI plugin version of Artifex, visit [lizzary/ComfyUI-Artifex](https://github.com/lizzary/ComfyUI-Artifex).
