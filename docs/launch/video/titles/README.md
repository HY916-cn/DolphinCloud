# 发布会字卡与动画

海豚云发布会（`docs/launch/SCRIPT.md`）的字卡、标题、大屏、设计短片、数字页和功能墙。Remotion 项目，白底；版面按 1920×1080 写，渲染时放大 2 倍，输出 3840×2160、30 fps。

- 颜色、圆角、字体和组件样式直接取自 `client/src/theme/`（由设计系统生成）；字体用 `client/public/fonts` 里自托管的 Nunito Sans 和 Noto Sans SC，标志用 `client/public/logo.png`。
- 真实界面来自 `docs/launch/storyboard/` 的截图；设计短片里的宫格、按钮、开关是 `bundle.css` 的真实组件。

## 内容

| 编号 | 合成 | 脚本位置 | 时长 | 输出 |
| --- | --- | --- | --- | --- |
| P1 | `P1-Sub-Small`、`P1-Sub-Counts` | 1.2 字幕“一张，很小。”“每一笔，都算数。” | 各 4 秒 | 透明 ProRes 4444 |
| P1 | `P1-Chapter-Counter`、`-Students`、`-Bank` | 三、四、五段章节字卡 | 各 3 秒 | ProRes 422 HQ |
| P1 | `P1-Name-Teller`、`-President`、`-Admin` | 人物字条 | 各 5 秒 | 透明 ProRes 4444 |
| P1 | `P1-EndCredit` | 九段 11:52 片尾字幕（黑场） | 3 秒 | ProRes 422 HQ |
| P2 | `P2-Title-Light` | 1.5 标题 | 15 秒 | ProRes 422 HQ + H.264 |
| P3 | `P3-Waves`、`P3-Theme` | 大屏海浪、结尾的海浪与主题 | 36 秒无缝循环 | H.264 |
| P3 | `P3-Sheet`、`-Launch`、`-Three`、`-Principles`、`-Numbers` | 开场白的表格、发布、三件事，五段四条原则，七段数字 | 进场后停 1 分钟 | H.264 |
| P5 | `P5-Design` | 4.1 设计短片 | 36 秒 | ProRes 422 HQ + H.264 |
| P10 | `P10-Numbers` | 七段数字页 | 26 秒 | ProRes 422 HQ + H.264 |
| P14 | `P14-Wall` | 六段功能墙 | 37 秒 | ProRes 422 HQ + H.264 |

`P2-Title-Dark` 是标题的黑底版，需要黑底时用。

## 命令

```bash
npm install
npm run dev          # Remotion Studio 预览
npm run numbers      # 重新数提交、组件、图标和数据库测试，写进 src/numbers.json
npm run render       # 渲染全部到 ../out/titles/
npm run render -- P5 P14   # 只渲染其中几组
npm run lint
```

- 出片前先跑 `npm run numbers`，数字页用的是当时仓库的实际数。
- 人物字条的姓名在 `src/Captions.tsx` 的 `PEOPLE` 里。
- 功能墙每组出现的帧在 `src/Wall.tsx` 的 `GROUPS[].at`，按画外音调整；设计短片的分段在 `src/Design.tsx` 的 `DESIGN`。
- 音乐和音效放在 `audio/`（不进仓库），来源与许可见 `AUDIO.md`。
