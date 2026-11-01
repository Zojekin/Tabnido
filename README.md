<div align="center">

  <img src="public/brand/logo.svg" alt="Tabnido Logo" width="280" />

  <p><strong>基于真实物理交互检测的智能闲置标签页自动收纳扩展</strong></p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL%20v3.0-blue.svg" alt="License: GPL v3" /></a>
    <img src="https://img.shields.io/badge/Manifest-V3-success.svg" alt="Manifest V3" />
    <a href="https://github.com/Zojekin/tabnido/releases"><img src="https://img.shields.io/badge/Release-1.0.0-orange.svg" alt="Release 1.0.0" /></a>
  </p>

</div>

---

## 功能亮点

- **真实动作探测**：深入网页底层监听按键、点击、拖动与页面滚动等物理操作，精准识别真实阅读与使用状态，告别仅靠切前后台导致的机械误关。
- **灵活时长粒度**：支持多维度自定义闲置关闭时间，支持 1–60 分钟、1–23 小时、1–30 天以及 1–12 个月。
- **常驻状态徽标**：浏览器工具栏图标实时呈现运行监控状态（如 `15m`、`1h`），暂停时显示低调灰色 `OFF`。
- **域名白名单保护**：支持域名原位即时编辑与匹配规则保护，重要工作页面绝不误关。
- **可搜索历史归档**：自动保留多达 500 条历史归档记录，支持按标题与网址实时检索，一键恢复已关标签。
- **纯本地隐私安全**：零外部远程网络依赖、零分析遥测与用户追踪，所有配置与归档数据 100% 留存在本地浏览器存储中。
- **适配高分屏与双色主题**：精心打磨的微交互反馈与紧凑布局，原生适配浅色与深色系统主题。

---

## 安装与使用

1. 前往 [Releases](https://github.com/Zojekin/tabnido/releases) 页面，下载最新的发布包 `tabnido-1.0.0.zip` 并解压到本地；
2. 打开 Chromium 内核浏览器（如 Google Chrome、Microsoft Edge 等）：
   - Chrome 地址栏输入 `chrome://extensions`
   - Edge 地址栏输入 `edge://extensions`
3. 开启页面右上角的 **「开发者模式」**；
4. 点击左上角的 **「加载已解压的扩展程序」**，选择刚才解压出来的文件夹；
5. 在浏览器工具栏固定 **Tabnido** 图标，点击即可展开配置。

---

## 开源协议

本项目采用 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 开源协议。第三方字体与图标资产遵循各自的原生开源许可（详见 `licenses/` 目录）。
