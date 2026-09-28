---
title: Ubuntu 桌面更新与导出
description: Ubuntu 签名 OTA 更新、原生文件导出及账号切换。
---

`jasonlee539/NexCode` 的 Ubuntu 桌面版从 1.0.1 开始支持签名 OTA 更新。
1.0.0 不包含 OTA 客户端，因此需要先手动安装一次 1.0.1 的 Debian 包。

点击窗口标题栏或托盘菜单中的 **Check for Updates**。已安装版本也会在启动时检查一次。
升级包必须匹配 Ubuntu 和当前 CPU 架构，并通过内置 Ed25519 公钥签名、大小、
SHA-256 以及 Debian 包身份校验。Windows 和 Mac 的发布不影响 Ubuntu 更新通道。

下载和校验完成后，Ubuntu 会请求管理员授权，通过 APT 安装升级包。安装完成后重新打开
NexCode。取消授权或安装失败时会重新启动本地管理服务。账号和配置保留在用户目录中。
安装由 Debian 包管理器负责，目前不提供应用层自动回滚。

线程的 **导出** 按钮会打开系统原生保存对话框。选择 Markdown 文件名和目录，覆盖已有
文件前需要确认；只有实际写入成功才提示成功，取消不会显示成功。其他管理界面下载也使用
系统保存对话框。

账号切换使用加密的原生登录档案，保留 Codex 刷新的凭据，并支持切回原始登录。
缺少身份令牌的旧账号会要求重新登录。切换后重新打开 Codex，即可使用所选账号。

Ubuntu 启动器设置 `NEXCODE_MANAGEMENT_ONLY=1`：模型代理端点及通用服务商、客户端集成、
Lab 管理 API 仍不可用。不设置该标志的通用 CLI 代理运行时保留需要认证的管理 API。
这一模式区分不会在桌面界面中重新添加服务商页面。

维护者发布升级包时请参照
[UBUNTU.md](https://github.com/jasonlee539/NexCode/blob/Ubuntu/UBUNTU.md) 的签名流程。
