# 测测你是哪条上海地铁 — V4.2 滚动修复版

[开始测试](https://oiiaioiiiiai123.github.io/shmetro-personality/) · [个人主页](https://oiiaioiiiiai123.github.io/) · [源码仓库](https://github.com/oiiaioiiiiai123/shmetro-personality)

2026-10-26 已通过 GitHub Pages 发布。无需登录或安装软件，两个网站可以独立更新。

## 修复问题

上一版每次选择答案会调用 `showQuestion()`，其内部的 `show('quiz')` 无条件执行 `window.scrollTo({top:0})`，导致页面被拉回顶部。

V4.2 修改为：
- 点击、取消选项，选项重新排序、清空重排：保留当前答题位置；不会跳到顶部。
- 点击下一题、上一题，以及开始、重新测试、进入结果页：正常定位到新页面/题目顶部。
- 点击选项时保留键盘焦点并用 `focus({preventScroll:true})` 阻止额外滚动。
- 排序条高度变化时尽量保持刚点击选项在屏幕中的位置。

其他内容全部沿用 V4.1：20 道题、排序多选规则、22 个人物结果、人物文案、权重、标题与封面。

## 如何打开

下载 ZIP 解压后，用 Chrome/Safari/Edge 打开 `index.html` 即可。也可将 `index.html` 上传 GitHub Pages 仓库根目录。

单文件 HTML 已内嵌所有所需数据和图片，不需要联网或安装依赖。

## GitHub Pages 部署

- 使用独立仓库 `shmetro-personality`，从 `main` 分支的 `/(root)` 发布。
- `index.html` 就在仓库根目录，`.nojekyll` 保留静态页面原样。
- 图片与数据已内嵌在 HTML 中，不依赖根路径、localhost 或外部服务，支持 `/shmetro-personality/` 子路径。
- `shmetro_data.json`、`shmetro_questions.md` 和 `shmetro_cover.webp` 保留为原版随附资料。
- ZIP 只作本地备份，已由 `.gitignore` 排除；不要上传令牌、`.env` 或测试产物。
- 原版数据中的 `meta.version` 仍标记为 `4.1`，这是 V4.2 沿用的题目数据版本；V4.2 的滚动修复位于 HTML 脚本中，不修改题目、权重或人物设定。

本地预览可以运行 `python3 -m http.server 4174 --bind 127.0.0.1`，然后访问 `http://127.0.0.1:4174/`。正式网站由 GitHub Pages 提供，不需要本机运行服务器。

## 浏览器回归

`scripts/check-metro.cjs` 通过 Playwright 和 Chrome 实际检查桌面/触摸排序、滚动位置、20题完整流程、所有角色的结果可达性、重测和刷新。设置 `METRO_QA_URL` 可指定线上或本机地址，`METRO_QA_OUT` 指定证据输出目录；`PLAYWRIGHT_MODULE` 与 `CHROME_PATH` 可指定已有测试工具。测试工具不参与网站运行。报告与截图默认位于已忽略的 `test-results/metro/`。
