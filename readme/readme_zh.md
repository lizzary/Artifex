# Artifex

[![English](https://img.shields.io/badge/lang-English-blue)](../README.md)
[![中文](https://img.shields.io/badge/lang-%E4%B8%AD%E6%96%87-red)](readme_zh.md)
[![Release](https://img.shields.io/github/v/release/lizzary/Artifex)](https://github.com/lizzary/Artifex/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

一款用于管理 **ComfyUI** 生成图片的自托管图库。Artifex
能读取每张 PNG 中嵌入的工作流元数据(模型、提示词、种子、
采样器、LoRA 等),通过本地视觉模型自动打标签,并让你能在
本地机器上搜索、分组、浏览成千上万张图片 —— 完全无需上云,
也无任何遥测数据。

![Artifex 主界面](access/main_page.png)

## 为什么需要 Artifex

用 ComfyUI 生成图片很容易,*管理输出*却不简单。工作几周之后,
你会得到一个扁平的文件夹,里面塞满了 `ComfyUI_00042.png`、
`ComfyUI_00043.png`……,而所有有价值的上下文(用的是哪个
checkpoint?哪段提示词?哪套 LoRA 组合?)都只能通过把每张
PNG 重新拖回 ComfyUI 才能找回。通用图片管理器无法解析
ComfyUI 的元数据,而现有的 ComfyUI 扩展又难以应对几百张以上
的规模。

Artifex 介于 ComfyUI 与文件系统之间:

- **上传时解析 ComfyUI 工作流元数据** —— 模型、正向/负向
  提示词、种子、采样器、调度器、步数、CFG、每个 LoRA 及其
  强度、分辨率。PNG 的 `tEXt`/`iTXt` 块解析器为从头自研,
  无需安装 ComfyUI 本体。
- **本地视觉模型自动打标签** —— 通过 ONNX Runtime 调用
  [WD EVA02-Large Tagger v3](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3);
  优先使用 CUDA 执行提供程序,无 GPU 时自动回退到 CPU。
- **基于标签和提示词的全文搜索** —— 由 SQLite FTS5 驱动,
  支持前缀匹配:搜 "suns" 能找到 "sunset"、"sunshine"、
  "sunlight"。
- **互斥的智能分组** —— 在同一规则中组合标签与提示词,
  支持 `AND`、`OR`、`NOT` 和括号;每张图片会被归入优先级最高的
  命中规则,并渲染在带颜色的可折叠容器中。匹配优先级与
  页面显示顺序可以分别配置。

## 快速上手

### 方式 A —— 下载发行版(Windows)

1. 从 **[Releases](https://github.com/lizzary/Artifex/releases)**
   下载最新的 `Artifex_Win64.zip`。
2. 解压到任意目录,运行 `Artifex.exe`。
3. 打开 <http://127.0.0.1:8000>。
4. *(可选,启用 AI 自动打标签)* 进入 **设置 → 模型管理 →
   下载模型** —— 一次性从 HuggingFace 下载约 800 MB。

服务端首次启动会自动创建 `gallery.db`;上传的图片存放在
二进制文件旁的 `uploads/` 目录下。

### 方式 B —— 从源码构建

参见 **[开发环境搭建](#开发环境搭建)**。需求一览:

- Go 1.26+
- Node.js 20 LTS(用于构建前端)
- GCC / MinGW-w64 —— *可选*,仅 ONNX 自动打标签功能需要;
  也支持不带 GCC 的纯 Go 构建。

## 技术栈

| 层级         | 技术与用途                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 前端         | React,自研颜色分组渲染器,支持键盘操作和多选的灯箱组件                                                   |
| 后端         | Go,[chi](https://github.com/go-chi/chi) 路由,单一静态二进制文件,内嵌前端资源                          |
| 存储         | SQLite + FTS5 虚拟表,用于标签/提示词全文搜索                                                             |
| 自动打标签   | ONNX Runtime(通过 CGO)+ WD EVA02-Large Tagger v3;支持 CUDA 执行提供程序,自动回退到 CPU                |
| 元数据       | 自研 PNG `tEXt`/`iTXt` 块解析器;无需 ComfyUI 即可读取其序列化的工作流 JSON                              |
| 缩略图       | 三档画质(400 px / 1200 px / 原图),首次请求时按需生成                                                  |
| 打包         | 便携式 zip 分发;二进制 + DLL + 前端打包到一个目录中,无需安装程序                                       |
| 国际化       | 内置英文与中文;运行时无需刷新即可切换                                                                    |

## 截图

| 颜色分组(招牌功能)                            | 灯箱中的 ComfyUI 元数据                            |
| ----------------------------------------------- | -------------------------------------------------- |
| ![颜色分组](access/color_groups1.png)            | ![灯箱元数据](access/lightbox_metadata.png)         |

| 全局 FTS5 搜索                                   | 带自动补全的标签编辑器                          |
| ------------------------------------------------ | ----------------------------------------------- |
| ![搜索](access/search_overlay.png)               | ![标签编辑](access/lightbox_tag_edit.png)        |

---

## 功能特性

### 互斥的颜色分组

Artifex 的招牌组织功能。每条规则都可以在同一表达式中组合
**标签、正向提示词和负向提示词**。条件支持 `AND`、`OR`、`NOT`
与嵌套括号,并按照常规优先级计算:先括号和 `NOT`,再 `AND`,
最后 `OR`。

每个分组拥有独立的**匹配优先级**。优先级越高越先匹配,
图片一旦命中就立即退出匹配流程,因此分组天然互斥;未命中
任何规则的图片会落入 "Other"。匹配优先级与页面显示顺序
彼此独立。

每个分组会被分配独立的颜色,并以可折叠容器的形式呈现,
在视觉上将不同主题、角色或风格清晰区分开。

- **混合来源补全** —— 每个条件的下拉菜单同时提示现有标签与
  提示词,并标明来源
- **按条件指定来源** —— 每个关键词可匹配标签、提示词或两者
- **双重顺序** —— 拖动完整卡片调整页面顺序,拖动优先级小块
  调整首命中顺序

你可以保存多套分组配置(分组集),并在它们之间切换;
每一套都有自己独立的定义。

![颜色分组示例](access/color_groups2.png)
![分组配置](access/group_config_modal.png)

### AI 驱动的自动打标签

上传图片后,内置的
[WD EVA02-Large Tagger v3](https://huggingface.co/SmilingWolf/wd-eva02-large-tagger-v3)
(约 800 MB)会自动生成描述性标签。可用时使用 CUDA 加速;
在不支持 GPU 的机器上,会自动回退到 CPU。

可以在设置中开关自动打标签功能;如果你想用其他标签模型,
也可以上传自定义模型。

![自动打标签设置](access/settings_auto_tag.png)

### 全局标签搜索(SQLite FTS5)

由 SQLite FTS5 驱动的全文搜索,在每个页面都可用。在搜索栏
输入任意关键词,即可立即找到所有标签匹配的图片。前缀匹配
意味着搜索词不完整也能工作:"suns" 会返回 "sunset"、
"sunshine"、"sunlight"。

### ComfyUI 元数据提取

Artifex 会解析 ComfyUI 嵌入到每张生成 PNG 中的工作流元数据,
并在灯箱的详情面板中展示以下字段(按 `Ctrl+D` 切换显示):

| 字段             | 示例                                  |
| ---------------- | ------------------------------------- |
| **模型**         | `dreamshaperXL_v21.safetensors`       |
| **正向提示词**   | 正向提示词的完整文本                  |
| **负向提示词**   | 负向提示词的完整文本                  |
| **种子**         | `3478264912`                          |
| **采样器**       | `DPM++ 2M Karras`                     |
| **调度器**       | `Karras`                              |
| **步数**         | `20`                                  |
| **CFG 强度**     | `7.0`                                 |
| **LoRA**         | 每个 LoRA 的名称及强度值              |
| **分辨率**       | `1920 × 1080`                         |
| **文件大小**     | `2.4 MB`                              |
| **日期**         | 文件修改时间                          |

![灯箱元数据](access/lightbox_metadata.png)

### 自定义标签编辑

标签并非只读。在灯箱的详情面板中,点击铅笔图标进入编辑模式,
然后即可添加或删除标签,并享受来自全库已有标签的自动补全
建议。回车添加,保存生效。

自定义标签会立即出现在全局搜索、标签浏览器和页面内筛选器中
—— 它与所有依赖标签的功能无缝衔接。

![自定义标签编辑](access/lightbox_tag_edit.png)

### 群组管理

将图片组织进**群组**(可以理解为相册或项目)。每个群组都可
设置封面图片,并显示其内容的实时数量。可以创建、重命名或
删除群组 —— 删除群组会级联删除其所有图片与文件。

![群组网格](access/home_groups.png)

### 灯箱查看器

点击任意图片即可打开全屏灯箱。使用方向键导航,按 `Ctrl+D`
切换详情面板,把当前图片设为群组封面,或直接删除。

### 多选与批量操作

使用熟悉的键盘快捷键选择图片:

- **单击** —— 在灯箱中查看
- **Ctrl+点击** —— 切换单张选中状态
- **Shift+点击** —— 在两点间区间选择

选中后,可以一次性进行批量**下载**(支持自定义文件命名)
或批量**删除**。

![批量选择](access/batch_selection.png)

### 标签与提示词浏览器

专用页面 (`/tags` 和 `/prompts`) 以可筛选的标签条形式列出
图库中每一个唯一的标签和提示词。点击任意标签可查看持有该
标签的图片数量,或输入文字快速缩小列表 —— 这是探索图库
"词汇构成" 的便捷方式。

![标签浏览器](access/tags_page.png)

### 自定义下载命名

通过模板系统配置下载文件的命名方式。可以插入
`<Model>`、`<Seed>`、`<Steps>`、`<Sampler>`、`<Resolution>`、
`<Date>`、`<Group>` 等占位符 —— 它们会在下载时被替换为每张
图片的实际值。

![下载命名](access/settings_download.png)

### 其他贴心功能

- **任意视图内排序 / 筛选 / 分页** —— 可按分辨率、文件大小或
  日期排序;按标签或提示词筛选,并配备自动补全(可与颜色
  分组组合使用);每页显示 50 / 100 / 200 / 500 / 1000 / 全部。
- **多档画质缩略图** —— 400 px / 1200 px / 原图,通过画质
  下拉菜单实时切换。对已存在但缺失某档缩略图的图片,在首次
  请求时按需生成。
- **顺序上传 + 实时进度** —— 实时显示文件名与百分比;失败
  的文件会被记录,但不会阻塞批次中的其他文件。
- **深色与浅色主题** —— 跨会话持久化,采用语义化色彩 token
  保证可读性一致。
- **国际化** —— 提供英文与中文;在设置中切换,无需刷新页面。

---

## 开发环境搭建

> **目标读者:** 想从源码构建 Artifex,或修改后端 / 前端的
> 开发者。终端用户请改用
> **[快速上手 → 方式 A](#方式-a--下载发行版windows)**。

### 1. 克隆仓库

```bash
git clone https://github.com/lizzary/Artifex.git
cd Artifex
```

仓库结构:

```
Artifex/
├── backend-go/           # Go 后端服务
│   ├── main.go           # 入口
│   ├── internal/
│   │   ├── server/       # HTTP 处理器(chi 路由)
│   │   ├── tagger/       # ONNX 自动打标签引擎
│   │   ├── database/    # SQLite 初始化与辅助函数
│   │   ├── metadata/     # ComfyUI PNG 元数据解析
│   │   ├── thumbnail/    # 缩略图生成
│   │   ├── settings/     # JSON 配置加载
│   │   └── models/       # 共享数据结构
│   ├── build.bat         # Windows 构建脚本 (CMD)
│   ├── Makefile          # 构建脚本 (GNU Make)
│   └── settings.json     # 默认配置
├── frontend/             # React 前端
│   ├── src/
│   ├── public/
│   └── build/            # 生产构建产物
├── readme/               # README 资源(截图、中文翻译)
└── README.md
```

### 2. 安装 Go

**Windows:** 从 <https://go.dev/dl/> 下载安装包并运行,
或将便携版压缩包解压到 `C:\Users\<username>\sdk\go1.26.4`,
然后将其加入 `PATH`:

```cmd
setx PATH "%PATH%;C:\Users\<username>\sdk\go1.26.4\bin"
```

重启终端并验证:

```cmd
go version
:: 预期: go version go1.26.4 windows/amd64
```

**Linux:**

```bash
wget https://go.dev/dl/go1.26.4.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.26.4.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin   # 加入 ~/.bashrc 以持久化
go version
```

### 3. 安装 Node.js

从 <https://nodejs.org/> 下载 LTS 安装包(推荐 v20 LTS)。
验证:

```bash
node --version
npm --version
```

安装前端依赖:

```bash
cd frontend
npm install
```

### 4. 构建前端

```bash
cd frontend
npm run build
```

此命令会生成 `frontend/build/` —— 经过生产环境优化的静态
文件。Go 后端会直接服务这些文件。

带热重载的开发模式:

```bash
npm start
# 在 http://localhost:3000 启动 React 开发服务器
# API 调用会代理到 Go 后端(在 package.json 的 "proxy" 中配置)
```

---

> **第 5–7 步仅在需要 AI 自动打标签时才必要。**
> 如果只用核心功能(上传、浏览、搜索、手动标签、元数据、
> 颜色分组),可直接跳到
> **[第 8 步 → 不带 ONNX 的构建](#不带-onnx-的构建纯-go无自动打标签)**。

### 5. 安装 GCC(Windows 上使用 MinGW-w64)

ONNX Runtime 的 Go 绑定需要 **CGO**,而 CGO 需要 C 编译器。

**Windows —— winlibs(便捷的独立版本):**

1. 访问 <https://github.com/brechtsanders/winlibs_mingw/releases>
2. 下载最新的 **Win64 Zip**(不带 LLVM/Clang 的版本),例如
   `winlibs-x86_64-posix-seh-gcc-15.2.0-mingw-w64-13.0.0-r1.zip`
3. 解压到 `C:\mingw64`
4. 将 `C:\mingw64\bin` 加入系统 `PATH`:

```cmd
setx PATH "%PATH%;C:\mingw64\bin"
```

重启终端并验证:

```cmd
gcc --version
:: 预期: gcc (MinGW-W64 ...) 15.2.0 (或类似版本)
```

**Linux:**

```bash
sudo apt install build-essential   # Debian/Ubuntu —— 包含 GCC
```

### 6. 安装 ONNX Runtime 共享库

ONNX Runtime 的共享库不仅在构建时需要,**运行时也必须**
能被操作系统的动态链接器找到。

**Windows:**

1. 访问 <https://github.com/microsoft/onnxruntime/releases>
2. 下载与 Go 绑定版本匹配的发行版(推荐 v1.21.x):
   `onnxruntime-win-x64-<version>.zip`
3. 解压后,将 `onnxruntime.dll`(以及可选的
   `onnxruntime_providers_shared.dll` /
   `onnxruntime_providers_cuda.dll`,用于 GPU)复制到
   `artifex-server.exe` **所在的同一目录**:

```
backend-go/
├── artifex-server.exe
├── onnxruntime.dll                    <-- 必需
├── onnxruntime_providers_shared.dll   <-- 可选(GPU)
└── ...
```

> Windows 上可执行文件所在目录会自动被加入 DLL 搜索路径,
> 因此把 `onnxruntime.dll` 放在 `.exe` 旁边即可。

**Linux:**

```bash
wget https://github.com/microsoft/onnxruntime/releases/download/v1.21.0/onnxruntime-linux-x64-1.21.0.tgz
tar -xzf onnxruntime-linux-x64-1.21.0.tgz
sudo cp onnxruntime-linux-x64-1.21.0/lib/libonnxruntime.so* /usr/local/lib/
sudo ldconfig
```

### 7. 下载标签模型

标签模型 (`wd-eva02-large-tagger-v3`,约 800 MB) 有两种
获取方式:

**A) 从设置页面获取(推荐):**

服务器启动后,打开 <http://127.0.0.1:8000>,进入
**设置 → 模型管理**,点击 **下载模型**。服务器会自动从
HuggingFace 拉取 ONNX 模型与标签 CSV。

**B) 手动下载:**

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

预期的文件:

```
backend-go/models/default/
├── wd-eva02-large-tagger-v3.onnx       (约 800 MB)
├── wd-eva02-large-tagger-v3.onnx.data  (外部权重)
└── tags.csv                            (标签标注)
```

### 8. 构建后端

两种构建模式 —— 任选其一。

#### 带 ONNX 自动打标签的构建

**前置条件:** 已完成第 5–7 步(GCC + `onnxruntime.dll` + 模型)。

```cmd
cd backend-go

:: Windows CMD / PowerShell:
build.bat build

:: 或用 Make:
make build
```

此命令会生成 `artifex-server.exe`,带有完整的 ONNX 自动
打标签流水线。

### 9. 运行服务器

```cmd
cd backend-go

:: 启动服务器:
artifex-server.exe

:: 或指定自定义 host / port:
artifex-server.exe -host 0.0.0.0 -port 8080

:: 或通过构建脚本(开发模式):
build.bat run
```

**命令行参数:**

| 参数        | 默认值                  | 说明                                                |
| ----------- | ----------------------- | --------------------------------------------------- |
| `-host`     | `127.0.0.1`             | 监听地址(局域网访问请用 `0.0.0.0`)                |
| `-port`     | `8000`                  | 监听端口                                            |
| `-db`       | `<basedir>/gallery.db`  | SQLite 数据库路径                                   |
| `-uploads`  | `<basedir>/uploads`     | 图片存储目录                                        |
| `-models`   | `<basedir>/models`      | ONNX 模型目录                                       |
| `-frontend` | 自动检测                | 前端构建目录                                        |

在浏览器中打开 **<http://127.0.0.1:8000>**。

首次启动时:

1. 服务器会自动创建 `gallery.db` (SQLite)。
2. 若 `settings.json` 启用了自动打标签,会尝试加载 ONNX 模型。
3. 若模型缺失,服务器会输出一条日志,然后在不带自动打标签的
   情况下继续运行。
4. 进入 **设置 → 模型管理** 即可下载模型。

### 10. 分发打包

打包成独立、可分发的版本:

```cmd
cd backend-go

:: 仅后端 + 配置:
build.bat dist

:: 后端 + 配置 + 前端:
build.bat dist-full
```

产物结构:

```
dist/Artifex/
├── Artifex.exe              # 服务器二进制
├── settings.json            # 默认配置
├── models/
│   ├── default/             # ONNX 模型(需单独下载)
│   └── user_model/          # 用户自定义模型
├── uploads/                 # 图片存储
└── _internal/
    └── frontend/            # React 构建产物(仅 dist-full)
```

将 `dist/Artifex/` 目录复制到任意 Windows 机器上,运行
`Artifex.exe` 即可。

---

## 故障排查

**"Tagger not available: failed to initialize ONNX Runtime"**

运行时找不到 `onnxruntime.dll`。请检查:

1. DLL 是否位于 `artifex-server.exe` **所在的同一目录**。
2. 如果 DLL 在 `PATH` 上的其他位置,用 `where onnxruntime.dll`
   确认。
3. DLL 架构(x64)需与 Go 构建匹配 (`GOARCH=amd64`)。

**"Tagger not available: default model not found"**

ONNX 模型文件缺失。两种解决方式:

- 在网页 UI 中打开 **设置 → 模型管理 → 下载模型**,或
- 按 **[第 7 步](#7-下载标签模型)** 所述手动下载。

**"gcc: executable file not found in %PATH%"**

GCC / MinGW 未安装或不在 `PATH` 中。请按
**[第 5 步](#5-安装-gccwindows-上使用-mingw-w64)** 操作,
然后重启终端。可用 `gcc --version` 验证。

**自动打标签输出为空或不准确**

1. 检查 `models/default/` 目录下三个模型文件是否齐全。
2. 检查服务器控制台 —— 应当能看到 `Tagger ready (<N> tags).`。
3. 若 `settings.json → gpu_enabled` 为 `true`,可尝试关闭;
   有可能本机不支持 CUDA 执行提供程序。

**前端显示空白页或 404**

服务器找不到前端构建产物。两种解决方式:

- 构建前端: `cd frontend && npm run build`,或
- 显式指定构建目录:
  `artifex-server.exe -frontend ../frontend/build`。

服务器会自动检测 `_internal/frontend/`(打包后的产物优先),
然后是 `../frontend/build`(开发态结构)。

**8000 端口被占用**

```cmd
:: Windows —— 找出并结束占用进程:
netstat -ano | findstr :8000
taskkill /PID <PID> /F

:: 或换一个端口:
artifex-server.exe -port 8001
```

---

## 许可证

[MIT](../LICENSE) —— 详见 LICENSE 文件。
