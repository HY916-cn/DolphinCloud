# TxnHistoryPage

交易明细页示例：搜索、时间范围、类型标签和按日期分组的交易列表。

- 外壳 `AppShell`（当前为“明细”）。左栏依次为 `SearchField`、时间范围 `Segmented`（本周 / 本月 / 本学期）、类型 `Tabs`（全部 / 存入 / 支出 / 奖励，带数量）、按日期分组的 `TxnList`，以及加载更早交易时的 `Skeleton`。
- 右栏为“本月收支”（`SummaryList`）和储蓄目标 `Progress`；手机与平板排在列表下方，电脑在右侧随页面固定。
- 没有交易时，列表位置显示 `EmptyState`。
