# Artifex

[![English](https://img.shields.io/badge/lang-English-blue)](../README.md)
[![中文](https://img.shields.io/badge/lang-%E4%B8%AD%E6%96%87-red)](readme_zh.md)
[![Release](https://img.shields.io/github/v/release/lizzary/Artifex)](https://github.com/lizzary/Artifex/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

**Artifex 是一个面向 ComfyUI 输出的本地优先、自托管工作空间。** 它可以从 PNG 文件中
提取生成元数据，使用本地视觉模型为图片打标签，并为大型图片库提供图库、标签全文搜索、
批量工具以及交互式颜色分组白板。

数据库和图片始终保存在你的设备上。Artifex 不需要云端账户，也不收集遥测数据；只有在你
主动下载发行版或可选的标签模型时才需要访问网络。

> **截图占位符——颜色分组白板全景**
>
> 请截取一个完整白板视图：至少包含两个已有图片的彩色圆圈、**其他**区域、
> “手动归组 → 首条命中规则 → 其他”的说明条、配置按钮和缩放控件。
> 建议资源路径：`readme/access/whiteboard-overview.png`。

## Artifex 可以做什么

- **交互式颜色分组白板** —— 将一张或多张图片归入彩色圆圈，框选一个区域，在白板上
  平移和缩放，并且无需离开画布即可管理选中的图片。
- **手动优先的智能分组** —— 手动白板归组拥有最高优先级；可选的布尔规则随后对其余
  图片进行分类；所有未匹配的图片都会进入**其他**区域。
- **ComfyUI 元数据提取** —— 无需安装 ComfyUI，即可从 PNG 元数据中读取模型、提示词、
  种子、采样器、调度器、步数、CFG、LoRA、分辨率、文件大小和创建时间。
- **本地 AI 打标** —— 通过 ONNX Runtime 运行 WD EVA02-Large Tagger v3，默认使用 CPU
  推理，也可选择 CUDA 加速。
- **快速本地浏览** —— 基于 SQLite 的图库、标签前缀搜索、标签/提示词筛选、排序、分页、
  三档图片质量和原始宽高比视图。
- **完整的图片库工作流** —— 拖放上传、同名文件策略、可编辑标签、批量重新打标/下载/
  删除、可配置的下载文件名，以及支持键盘操作和幻灯片播放的灯箱。
- **本地、便携的存储** —— 除非你选择自定义路径，否则 SQLite、设置、模型、原图和
  缩略图都存放在应用程序旁边。

## 快速开始

### 1. 下载发行版

打开 **[最新发行版](https://github.com/lizzary/Artifex/releases/latest)**，下载适用于你所用
平台的压缩包：

| 平台 | 发行版压缩包 | 可执行文件 |
| --- | --- | --- |
| Windows x64 | `artifex-windows-amd64.zip` | `artifex.exe` |
| Linux x64 | `artifex-linux-amd64.tar.gz` | `artifex` |
| macOS Apple 芯片 | `artifex-darwin-arm64.tar.gz` | `artifex` |

目前尚未发布 Intel macOS 构建。

### 2. 解压并双击启动

请保持可执行文件、ONNX Runtime 库和 `frontend/` 目录与压缩包中的结构一致，并将它们
放在一起。

打开解压后的目录，然后双击对应平台的可执行文件：

- Windows：`artifex.exe`
- Linux / macOS：`artifex`

Artifex 会在终端界面中显示图库的实际 URL。它从 `http://127.0.0.1:8000` 开始监听；
如果该端口已被占用，则会依次尝试后续端口（默认尝试 30 次）。在终端界面中输入 `/open`
即可在浏览器中打开图库。

### 3. 可选：启用自动打标

发行版不附带默认模型。请在 Web 界面中打开**设置 → 图像索引 → 下载默认模型**。
经过校验的模型约为 **1.2 GB**，并保存在本地的 `models/default/` 目录中。

即使没有该模型，你仍然可以使用图库、元数据、手动标签、搜索、颜色规则和白板。如果上传时
模型不可用，可以选择不进行自动打标并继续上传。

## 颜色分组白板

白板是单个图库的空间化视图。每个已配置的颜色组都是一个圆圈；没有有效分组的图片会保留在
**其他**区域。

分组流程经过刻意设计，结果清晰可预测：

```text
手动白板归组  >  第一条命中的自动规则  >  其他
```

拖动卡片改变的是其分组归属，而不是永久保存的自由坐标。Artifex 会计算确定性的布局，因此
即使图片库发生变化，白板也能保持整洁。

### 白板操作

| 操作 | 结果 |
| --- | --- |
| 单击卡片 | 选中该卡片 |
| `Ctrl` / `Cmd` + 单击 | 在选区中添加或移除一张卡片 |
| `Shift` + 单击 | 选择一个范围 |
| 在空白处按住左键拖动 | 绘制选择框 |
| 将选中的卡片拖入圆圈 | 手动将所有选中图片归入该组 |
| 将选中的卡片拖到所有圆圈之外 | 清除手动归组，让它们重新由自动规则处理 |
| 按住右键拖动 | 平移白板 |
| 鼠标滚轮或 `+` / `−` | 以指针为中心，在 50% 到 200% 之间缩放 |
| 适应按钮 | 让所有颜色组适应当前视图 |

> **截图占位符——白板框选与拖拽交互**
>
> 请截取正在框选图片或拖动多张卡片的状态，同时显示选中边框、可放置的颜色组目标和
> 底部操作提示。建议资源路径：`readme/access/whiteboard-interactions.png`。

**其他**网格每行可显示 5–30 张缩略图。将鼠标悬停在任意卡片上，会显示清晰、保持原始比例的
预览，以及文件名和分组来源。

### 白板批量工具

选择工具栏可以下载或删除当前选区，还可以打开高级标签面板，该面板能够：

- 区分所有选中图片共有的标签与仅部分图片拥有的标签；
- 为整个选区添加一个或多个标签；
- 从所有选中图片中移除共有标签；
- 准确显示哪些图片拥有部分标签，并可选择性地将其移除。

白板打开时，也可以从操作系统将文件拖入图库；上传进度会持续显示在白板标题栏中。

> **截图占位符——白板批量标签工具**
>
> 请选择多张图片并打开可调整大小的**标签**面板，展示“全部拥有 / 部分拥有”的标签、
> 添加标签入口，以及展开后的部分标签持有图片。建议资源路径：
> `readme/access/whiteboard-batch-tags.png`。

### 手动归组与自动规则

自动规则并非必需。颜色组可以完全依靠手动归组，也可以通过以下来源的条件，将尚未归组的图片
自动纳入其中：

- 完整标签，不区分大小写进行匹配；
- 正向和负向提示词文本，以不区分大小写的子串方式进行匹配；
- 同时使用上述两种来源。

规则支持 `AND`、`OR`、`NOT` 和嵌套括号。`AND` 的结合优先级高于 `OR`；括号和 `NOT`
优先计算。自动规则按照独立的优先级顺序运行，并在第一条规则命中时停止。

显示顺序与规则优先级相互独立：前者控制圆圈和页面中的位置，后者控制首条命中规则的求值顺序。
颜色组还支持自定义名称、调色板颜色、精确的十六进制颜色，以及多套相互独立的配置。每套配置
分别保存自己的分组、规则、优先级和手动归组结果。

> **截图占位符——颜色分组配置**
>
> 请打开包含多个分组的配置对话框：其中一个分组仅手动归组，另一个使用嵌套布尔规则；
> 同时展示颜色选择、显示顺序和规则优先级。建议资源路径：
> `readme/access/color-group-config.png`。

### DOM 与 WebGL 渲染器

可在**设置 → 常规**中选择白板渲染器：

| 设置 | 适用场景 |
| --- | --- |
| **自动（推荐）** | 使用当前发行版所选的成熟兼容路径 |
| **WebGL 高性能** | 使用带有视口裁剪和纹理延迟加载的 PixiJS/WebGL 2 渲染器，适合大型白板 |
| **DOM 兼容** | 使用无障碍 HTML 渲染器，以获得最大程度的浏览器和 GPU 兼容性 |

如果 WebGL 2 不可用或其上下文丢失，Artifex 会回退到 DOM 渲染器。WebGL 白板还支持使用
方向键、`Home` / `End` 进行键盘导航，并可通过 `Enter` / `Space` 选择。

## 图库工作流

> **截图占位符——图库全景**
>
> 请截取一个包含多种图片的已打开图库，并完整展示顶栏搜索、排序、筛选、图片质量、
> 卡片大小、原始比例、颜色分组、白板入口和上传控件。建议资源路径：
> `readme/access/gallery-overview.png`。

### 图库与上传

- 创建、重命名、删除顶层图库，并通过拖动调整顺序。
- 从网格或灯箱中设置图库封面。
- 通过文件选择器上传，或将文件拖入图库/白板。
- 查看包含新增、跳过、覆盖和失败文件数量的最终汇总。
- 选择同一图库中原始文件名重复时的处理方式：**全部保留**、**跳过**或**覆盖**。
- 对选区重新运行 AI 标签器；重新打标会替换当前标签。

Artifex 支持 JPEG、PNG、GIF 和 WebP。原始文件会完整保留，不进行转码。上传时会生成
400 px 缩略图（质量 75）和 1200 px 缩略图（质量 85）；缺失的缩略图会在需要时重建。

### 浏览、排序、筛选与选择

- 按默认/最新顺序、分辨率面积、文件大小或创建时间排序，并可选择升序或降序。
- 按完整标签、正向提示词、负向提示词或两者筛选当前图库或搜索结果。
- 在低（400 px）、普通（1200 px）和原图质量之间切换。
- 调整卡片大小，并选择方形裁切或完整的原始宽高比。
- 每页可显示 50、100、200、500、1000 张或全部图片。
- 将颜色分组应用到网格，并折叠单独的颜色区块。
- 使用 `Ctrl` / `Cmd` 单击和 `Shift` 单击进行批量重新打标、下载或删除。

> **截图占位符——分组图库与批量操作**
>
> 请截取已启用颜色分组的图库，至少展示两个彩色区块、一个折叠区块、多张已选图片，
> 以及重新打标、下载和删除批量工具栏。建议资源路径：
> `readme/access/gallery-grouping-and-batch.png`。

### 搜索、标签与提示词

标题栏搜索使用针对**标签**的 SQLite FTS5 索引。它执行前缀匹配，因此 `suns` 可以匹配
`sunset`，多个词则使用 `AND` 组合。

## 灯箱、元数据与标签

单击图片可在全屏灯箱中打开原图。你可以在灯箱中浏览图片、设置图库封面、下载、删除、编辑标签、
查看详情或开始播放幻灯片。

| 快捷键 | 操作 |
| --- | --- |
| `←` / `↑` | 上一张图片 |
| `→` / `↓` | 下一张图片 |
| `Ctrl` / `Cmd` + `D` | 切换详情面板 |
| `Space` | 播放或暂停幻灯片 |
| `Esc` | 关闭灯箱 |

幻灯片间隔可在 1–60 秒之间设置，并提供 2/3/5/10 秒预设。

对于 ComfyUI PNG，详情面板可以显示：

| 类别 | 提取的值 |
| --- | --- |
| 文件 | 图库、分辨率、文件大小、创建时间 |
| 生成参数 | 模型、种子、采样器、调度器、步数、CFG 比例 |
| 提示词 | 正向和负向提示词 |
| 附加项 | LoRA 名称以及模型/CLIP 强度 |
| 图片库 | 可编辑标签 |

Artifex 会从受支持的 PNG 文本元数据中读取内嵌的 ComfyUI `prompt` 和 `workflow` JSON。
非 PNG 文件，以及不包含受支持工作流的 PNG，仍会保留其基本文件信息。

> **截图占位符——ComfyUI 元数据详情**
>
> 请使用一张 ComfyUI PNG，确保详情面板同时显示模型、种子、正负提示词、采样器、调度器、
> 步数、CFG 和至少一个 LoRA。建议资源路径：`readme/access/lightbox-metadata.png`。

## 本地 AI 打标

默认标签器为
[WD EVA02-Large Tagger v3](https://huggingface.co/lizzary111/wd-eva02-large-tagger-v3)，
通过 ONNX Runtime 在本地运行。

- 默认仅使用 CPU 推理。
- 可在设置中启用 CUDA；如果初始化失败，应用会回退到 CPU，并在应用日志中报告。
- 默认下载固定到一个已知版本，并在替换活动模型前校验预期文件大小和 SHA-256 哈希值。
- 可在设置中上传并选择自定义 `.onnx` 和 `.csv` 模型文件。
- 可以完全禁用自动打标。

> **截图占位符——模型管理与索引状态**
>
> 请截取**设置 → 图像索引**，展示活动模型选择器、默认模型下载/校验状态、CPU/CUDA 选项
> 和自定义模型上传区域。建议资源路径：`readme/access/model-management.png`。

官方发行版压缩包包含 ONNX Runtime，但**不包含**标签模型。



```text
artifex-directory/
├── artifex[.exe]
├── frontend/                 # 随发行版提供的 Web 应用；请与二进制文件放在一起
├── onnxruntime.*             # 发行版附带的平台运行时库
├── gallery.db                # SQLite 数据库
├── settings.json             # 保存设置后创建
├── models/
│   ├── default/
│   └── user_model/
└── uploads/
    └── <gallery-id>/
        ├── originals/
        ├── thumbnails/       # 400 px
        └── thumbnails_normal/ # 1200 px
```

### 下载文件名模板

下载会保留原始扩展名。模板区分大小写，并支持以下占位符：

`<date>`、`<Resolution>`、`<File Size>`、`<Date Created>`、`<group>`、
`<Model>`、`<Seed>`、`<Sampler>`、`<Steps>`、`<CFG Scale>` 和 `<Lora>`。

非法文件名字符和未解析的占位符会被移除。如果结果为空，Artifex 会使用原始文件名。

## 终端界面

在终端中启动 Artifex 会打开 Bubble Tea 状态界面。若要在服务、脚本或容器中使用纯文本日志，
请添加 `-no-ui`。

| 命令 | 用途 |
| --- | --- |
| `/status` | 显示当前服务器状态 |
| `/log` | 打开可滚动的应用日志 |
| `/theme auto\|dark\|light` | 更改并保存终端主题 |
| `/port-attempts 1-65536` | 设置下次启动时连续尝试端口的次数上限 |
| `/upload-workers 1-32` | 设置图片预处理并行数；对后续新上传立即生效 |
| `/tagger-slots 1-16` | 设置 tagger 推理并行槽位；对后续新推理立即生效 |
| `/open` | 打开当前图库 URL |
| `/home` | 返回状态页面 |
| `/help` | 列出命令 |
| `/quit` 或 `/exit` | 停止 Artifex |

日志视图支持方向键、Page Up/Down、`End`、按 `f` 切换跟随模式，以及按 `1`–`4` 筛选
日志级别。

> **截图占位符——交互式终端界面**
>
> 建议制作并排截图：左侧为 Bubble Tea 首页/状态页，右侧为日志页；需要清晰展示实际图库 URL、
> 运行状态、主题以及日志级别筛选。建议资源路径：`readme/access/terminal-ui.png`。

## 从源代码构建

### 环境要求

| 依赖项 | 当前项目要求 |
| --- | --- |
| Go | 1.26.4（来自 `backend-go/go.mod`） |
| Node.js | 20（发行工作流使用的版本） |
| C 工具链 | 必需，因为后端使用 CGO |
| ONNX Runtime | 1.26.0 共享库 |

当前后端始终包含 ONNX 绑定，不存在禁用 CGO 或纯 Go 的后端构建。

### 1. 克隆并构建前端

```bash
git clone https://github.com/lizzary/Artifex.git
cd Artifex/frontend
npm ci
npm run build
```

这会创建 `frontend/build/`。在仓库目录结构中，后端会自动检测该目录。

### 2. 安装 ONNX Runtime 1.26.0

从 [ONNX Runtime v1.26.0 发行版](https://github.com/microsoft/onnxruntime/releases/tag/v1.26.0)
下载与平台匹配的压缩包，并让可执行文件能够访问其共享库：

- Windows：`onnxruntime.dll`
- Linux：`libonnxruntime.so*`
- macOS：`libonnxruntime*.dylib`

Artifex 官方发行工作流会将这些文件放在可执行文件旁，并在 Linux/macOS 上添加相对于可执行文件的
运行时搜索路径。

### 3. 构建后端

**Windows PowerShell：**

```powershell
cd ..\backend-go
$env:CGO_ENABLED='1'
go build -trimpath -ldflags="-s -w" -o artifex.exe .
```

**Linux / macOS：**

```bash
cd ../backend-go
CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o artifex .
```

构建完成后，在文件管理器中打开 `backend-go` 目录：Windows 双击 `artifex.exe`，
Linux / macOS 双击 `artifex`。

若要使用前端热重载，请保持后端运行，并在一个从仓库根目录启动的新终端中，使用后端的实际
URL 启动 React：

```powershell
cd frontend
$env:REACT_APP_API_BASE_URL='http://127.0.0.1:8000'
npm start
```

```bash
cd frontend
REACT_APP_API_BASE_URL=http://127.0.0.1:8000 npm start
```

React 开发服务器默认监听 `http://localhost:3000`。

### 测试

```bash
cd frontend
CI=true npm test -- --watchAll=false

cd ../backend-go
CGO_ENABLED=1 go test ./...
```

### 运行参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-host` | `127.0.0.1` | 监听地址 |
| `-port` | `8000` | 首个尝试的端口 |
| `-db` | `<base>/gallery.db` | SQLite 数据库路径 |
| `-uploads` | `<base>/uploads` | 原图和缩略图存储路径 |
| `-models` | `<base>/models` | 默认和自定义模型存储路径 |
| `-frontend` | 自动检测 | 构建后的前端目录 |
| `-cli-theme` | 已保存的设置 | `auto`、`dark` 或 `light` 终端主题 |
| `-no-ui` | `false` | 禁用交互式终端界面 |

服务器默认仅监听回环地址。如果将 `-host` 设置为 `0.0.0.0`，Artifex 将可从你的网络访问，
并且不会添加身份验证；请仅在可信网络中，或在你自己的访问控制之后这样做。

## 架构

| 层 | 实现 |
| --- | --- |
| 前端 | React 19、React Router 7、Tailwind CSS 3、Framer Motion、Lucide |
| 白板 | DOM 兼容渲染器，以及 PixiJS 8 / WebGL 2 渲染器 |
| 后端 | Go 1.26、Chi 路由、Bubble Tea/Lipgloss 终端界面 |
| 存储 | WAL 模式的 SQLite，使用 FTS5 进行标签搜索 |
| 元数据 | 原生 Go PNG 数据块与 ComfyUI 工作流解析器 |
| 图片处理 | 原始文件，以及 400 px 和 1200 px JPEG 缩略图 |
| 标签器 | `onnxruntime_go`、ONNX Runtime 1.26.0、WD EVA02-Large Tagger v3 |
| 打包 | 可执行文件 + 外部 `frontend/` + 平台 ONNX Runtime 库 |

仓库目录结构：

```text
Artifex/
├── backend-go/
│   ├── main.go
│   └── internal/
│       ├── cli/
│       ├── database/
│       ├── metadata/
│       ├── server/
│       ├── settings/
│       ├── tagger/
│       └── thumbnail/
├── frontend/
│   ├── public/
│   └── src/
│       ├── components/
│       │   └── color-board/
│       ├── hooks/
│       ├── pages/
│       └── utils/
├── readme/access/          # README 截图
└── .github/workflows/release.yml
```

## 故障排除

### 前端空白或返回 404

请保持发行版压缩包的结构完整，确保 `frontend/index.html` 位于可执行文件旁；也可以从源代码构建
`frontend/build/`。可通过 `-frontend` 指定自定义目录。

### ONNX Runtime 初始化失败

请确保发行版附带的平台共享库仍位于可执行文件旁。从源代码构建时，必须使用项目所需的 ONNX
Runtime 版本（目前为 1.26.0）以及匹配的架构。

### 默认模型不可用

打开**设置 → 图像索引 → 下载默认模型**。下载失败或不完整的模型不会被激活；Artifex 会在替换
当前模型前校验文件。你也可以不进行自动打标并继续上传。

### CUDA 无法启动

官方压缩包包含 CPU 运行时。CUDA 需要兼容的执行提供程序库和驱动程序。Artifex 会记录初始化
失败并回退到 CPU；如果你不打算安装这些组件，请禁用 GPU 加速。

### WebGL 模式无法启动

使用**设置 → 常规 → 白板渲染器 → DOM 兼容**。当 WebGL 2 不可用时，Artifex 也会自动回退。

### 端口 8000 已被占用

请查看终端中显示的实际 URL。Artifex 通常会尝试端口 8000–8029。使用 `/port-attempts`
更改下次启动的尝试次数上限，或通过 `-port` 设置不同的起始端口。

## 许可证

[MIT](../LICENSE) © 2026 Perry Wong。
