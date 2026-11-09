# Sheet

确认弹层：在手机上从底部升起，在平板和电脑上是居中的对话框。用于冲正、退出这类需要再确认一次的动作。

- 结构：`<div class="dc-scrim">` 遮罩内放 `<div class="dc-sheet" role="dialog" aria-modal="true">`：`dc-sheet-title` 标题、`dc-sheet-text` 说明、`dc-sheet-actions`（次按钮在前、主按钮在后）。
- 手机：贴底、上方圆角、顶部有拖动条，按钮整行堆叠、主按钮在上。平板与电脑：最宽 440px，按钮一行等分。
- 动效：打开时遮罩淡入，手机上升，平板和电脑从 96% 放大淡入（240ms）；关闭时给 `dc-scrim` 加 `is-leaving`，手机下沉、平板和电脑缩小淡出（160ms，`--ease-in`），动画结束后移除。
- 放在 `.dc-app` 里，弹层才能按屏幕宽度切换形态。
- 焦点：打开时移到弹层内第一个按钮，Tab 和 Shift+Tab 在弹层内循环，关闭后回到打开它的按钮。按 Esc 或点遮罩等于“取消”。
- 对象列表：批量确认在说明下方放 `<ul class="dc-sheet-list" tabindex="0" aria-label="本次涉及">`，每行 `<li><b>姓名</b><small>学号</small></li>`。列出全部对象，超过 5 行时在框内滚动。

使用者提供：标题（写清要确认的动作）、说明（写清对象、金额和后果）、两个按钮文字。
