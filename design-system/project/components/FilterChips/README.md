# FilterChips

筛选标签：同时选择多个筛选条件，例如业务类型。

- 结构：`<div class="dc-chips">`，每个 `<button class="dc-chip" aria-pressed="true|false">对勾图标 + 名称</button>`。
- 未选：白底、`line-strong` 描边；选中：`cloud-100` 底、`dolphin` 描边，前面出现对勾。选中状态同时由对勾和颜色表示。
- 自动换行，每个最小 44px 高。

使用者提供：条件列表和选中状态。全部未选时等于“不筛选”；条件超过 8 个时改用 `Checkbox` 列表放进 `Sheet`。

动效：按下缩小到 0.96；选中时对勾弹出（320ms），底色和描边过渡；电脑悬停时描边变 `dolphin`。
