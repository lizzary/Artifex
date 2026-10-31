# Artifex

[![English](https://img.shields.io/badge/lang-English-blue)](../README.md)
[![中文](https://img.shields.io/badge/lang-%E4%B8%AD%E6%96%87-red)](readme_zh.md)
[![Release](https://img.shields.io/github/v/release/lizzary/Artifex)](https://github.com/lizzary/Artifex/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

**官网：** [https://artifex.havenlab.tech/](https://artifex.havenlab.tech/)

## 如何安装

### 1. 下载

打开[最新发行版](https://github.com/lizzary/Artifex/releases/latest)，下载适合你所用平台的压缩包：

| 平台 | 压缩包 |
| --- | --- |
| Windows x64 | `artifex-windows-amd64.zip` |
| Linux x64 | `artifex-linux-amd64.tar.gz` |
| macOS Apple 芯片 | `artifex-darwin-arm64.tar.gz` |

### 2. 解压并启动

将压缩包解压到有写入权限的文件夹，保持可执行文件、附带的 ONNX Runtime 运行库和 `frontend/` 目录放在一起。

- **Windows：** 双击 `artifex.exe`。
- **Linux / macOS：** 在解压后的目录打开终端，运行 `./artifex`。

在终端界面输入 `/open`，即可在浏览器中打开 Artifex，也可以直接访问终端显示的 URL。默认地址为 `http://127.0.0.1:8000`；如果端口被占用，Artifex 会依次尝试后续端口，请以启动时显示的地址为准。

### 3. 可选：安装打标模型

如需自动为图片打标签，在网页中打开**设置 → 图像索引 → 下载默认模型**。模型约为 **1.2 GB**，需要单独下载，不包含在发行版压缩包中。

不安装模型也可以使用 Artifex。如果上传时模型不可用，可以选择跳过自动打标并继续上传。

## ComfyUI 插件版

Artifex 的 ComfyUI 插件版仓库：[lizzary/ComfyUI-Artifex](https://github.com/lizzary/ComfyUI-Artifex)。
