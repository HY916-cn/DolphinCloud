# PersonCard

办理对象卡：柜员办理前核对“是谁”，显示姓名、班级、学号和当前余额。

- 结构：`dc-person` 内 `dc-person-avatar`（`me` 图标）、`dc-person-main`（`dc-person-name` 姓名、`dc-person-meta` 班级和学号）、`dc-person-side`（余额 + 说明）。
- `cloud-100` 底、`radius-lg`；在 `AppShell` 里的手机宽度下不显示头像，变为紧凑的一条；班级和学号各包在 `<span>` 里，窄屏换行时不会从中间断开。

使用者提供：姓名、班级、学号、当前余额。办理页面上总是先显示这张卡，再录入金额。

动效：识别到学生时以 `dc-enter` 进入；余额可用 `data-count` 滚动显示。
