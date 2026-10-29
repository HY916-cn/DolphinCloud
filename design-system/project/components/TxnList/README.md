# TxnList

交易明细列表：每一笔都有图标、名称、时间和带文字的金额。

- `<ul class="dc-txns">` 内每条 `<li class="dc-txn">`：`dc-txn-icon`（业务图标）、`dc-txn-title`（“业务 · 详情”）、`dc-txn-time`、`dc-txn-amount`。
- 收入加 `is-in`，用 `success` 色并写 “+”；支出用 `ink` 色写 “−”。金额下方总是有一个字说明方向（存入 / 支出 / 奖励），不只靠颜色。
- 条目之间用 `line` 色的虚线分隔。
- 在 `dc-txn` 上加业务类别类（存款 `dc-kind-save`、取款与转账 `dc-kind-withdraw`、兑换 `dc-kind-exchange`、奖励与利息 `dc-kind-reward`），图标块随之换色，扫一眼就能分出钱是怎么动的。收支方向仍由金额的 `+` / `−` 和文字说明。

使用者提供：交易数组（业务类型、标题、时间、金额、方向）。时间写“10月27日 14:20”，不写年份（当年内）。

动效：列表加 `dc-stagger` 时逐条上移淡入（每条延后 40ms）；新到账的一条加 `is-new`，淡蓝底色在 1.2 秒内褪去。
