# Tabs

标签页：把同一页的内容按类别分开，例如交易明细的“全部 / 存入 / 支出 / 奖励”。

- 结构：`<div class="dc-tabs" role="tablist">`，每项 `<button class="dc-tabs-item" role="tab" aria-selected="true|false">名称<span class="dc-count">12</span></button>`。
- 选中项文字 `dolphin-deep`，下方 4px 圆头指示条从中间展开（160ms）；可选的数量 `dc-count` 用 `cloud-100` 胶囊。
- 标签放不下时可横向滑动；手机上字号缩到 16px，四个标签能完整放下。

使用者提供：标签名称（2～3 个字）、可选的数量、当前项，以及每个标签对应的 `tabpanel`。标签不超过 5 个。
