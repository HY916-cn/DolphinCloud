# BalanceCard

余额卡：首页最显眼的一块，让学生一眼看到“我有多少海豚币”。

- 底色从 `dolphin` 到 `grape-ink` 的斜向渐变，右上角一枚半透明光斑，底部三层 `dc-waves` 海浪，圆角 `radius-lg`。卡内文字一律 `on-dolphin`（≥5.2:1）。
- 标题行：金色 `coin` 图标 + “我的海豚币”（`heading`）。
- 金额用 `amount` 样式（Nunito Sans 800，40px，等宽数字），千分位逗号，单位 `HTB` 跟在后面。
- 下方 `dc-balance-split` 列出活期、定期、利息，每项是深色半透明胶囊。

使用者提供：总余额、活期/定期/利息三项数字。金额永远是整数海豚币；负数不会出现在这里。一页只放一张余额卡。

动效：随页面以 `dc-enter` 进入；余额变化时用 `data-from` / `data-count` 从旧值滚动到新值（600ms）。
