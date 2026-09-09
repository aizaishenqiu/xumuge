# CosyVoice Windows 安装剧本（Agent / MCP）

> 产品种子。执行顺序强制：**先依赖 → 再环境包 → 再仓库 → 最后默认模型 CosyVoice2-0.5B**。  
> 禁止跳过探测与用户确认的选盘。禁止默认走 HuggingFace（国内常超时）。

## 工具顺序

1. `cosyvoice_probe` — 对照门槛，列出 missingDeps  
2. 向用户确认：安装盘、模型源（ModelScope 优先）、语音模式  
3. `cosyvoice_plan` — 展示 disclosure（磁盘分项、耗时、将装依赖）  
4. 用户勾选已知悉  
5. `cosyvoice_ensure_deps` — Git（须已有）/ Miniconda 静默 / py3.10 / MSVC（须已有）/ pynini  
6. `cosyvoice_install` — clone → pip → ModelScope 单模型 → 冒烟 → `phase=ready`  
7. 轮询 `cosyvoice_status`

## 依赖阶段

- 无 conda：下载清华镜像 Miniconda，静默装到 `{installRoot}/miniconda`
- `conda create -n cosyvoice python=3.10`
- Windows：**不装** ttsfrd；用 wetext；**pynini 走 conda-forge**
- 跳过 requirements 中 linux-only 包

## 本体阶段

- `git clone --recursive --depth 1` CosyVoice → `{installRoot}/repo`
- pip（阿里云镜像）装 requirements + modelscope + wetext
- ModelScope 仅 `iic/CosyVoice2-0.5B` → `{installRoot}/models/CosyVoice2-0.5B`
- 冒烟：python 可启动且模型目录非空 → `ready`

## 禁止

- 未选盘开装  
- 依赖未齐标 ready  
- 向用户展示裸下载 URL 堆栈（错误用摘要 + fouAlert）
