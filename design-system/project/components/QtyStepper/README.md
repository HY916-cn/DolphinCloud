# QtyStepper

面额张数录入：每种面额一张卡片，柜员点加减或直接输入张数，系统算出小计，不用心算。

- 外层 `dc-denoms`（2 列网格），每种面额一张 `dc-qty` 卡片：上方 `dc-qty-head`（面额 `dc-qty-face`“10 元”、小计 `dc-qty-sum`），下方一条步进控件 `dc-qty-ctrl`：减按钮、张数输入 `dc-qty-input`、加按钮连成一个圆角矩形。
- 面额卡的颜色跟着业务走：在 `dc-denoms` 上加 `dc-kind-save`（存款）或 `dc-kind-withdraw`（取款），张数为 0 的卡片保持中性（白底、海豚蓝按钮）；张数大于 0 的卡片加 `is-filled`，整张换成业务色：浅底、面额数字、小计、描边和加减按钮都用对应色系，一眼看出收了哪些面额。张数为 0 时减按钮禁用。
- 张数输入用 `inputmode="numeric"`，数字 22px 加粗、等宽；按钮 52px 宽，整条控件 52px 高。
- 面额顺序固定为 1、2、5、10 元，与柜台现金盒一致；所有屏幕都是 2 列。

使用者提供：面额列表、张数、小计计算和 `is-filled` 切换，以及每个按钮的 `aria-label`（“增加一张 10 元”）。合计放在 `SummaryList` 里；手机上放进 `ActionBar` 的 `dc-actions-total`。

动效：加减按钮按下变深；卡片有张数后描边变色（160ms）；小计数字变化时加 `dc-bump`。
