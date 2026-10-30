# DatePicker

日期选择器：点开一张月历选一天，不用系统自带的日期控件，手机、平板、电脑上长得一样。用于查询某天的交易、选办理日期等。

- 结构：`<div class="dc-field dc-date">`：`<label class="dc-field-label" for>`（图标 + 字段名）、触发按钮 `dc-date-trigger`（显示“2026年10月27日 星期二”，右侧 `calendar` 图标），以及月历弹层 `dc-cal`（`role="dialog"`，关闭时加 `hidden`）。
- 月历：`dc-cal-head`（上个月 `dc-cal-nav`、标题 `dc-cal-title`“2026年10月”、下个月）、星期行 `dc-cal-week`（一 至 日，周一开头）、日期格 `dc-cal-grid dc-cal-days`（月初前用空 `<span>` 补位，每天一个 `dc-cal-day` 按钮）、底部 `dc-cal-foot`（一句规则说明和“今天”按钮）。
- 日期状态：今天 `is-today`（海豚蓝细框）；选中 `aria-pressed="true"`（海豚蓝实底、白字）；不可选 `disabled`（`cloud-300` 浅字），例如今天之后的日期。整月都不可选时，对应的翻月按钮也禁用。
- 尺寸：触发按钮 56px 高、`line-strong` 描边，与 `Select` 一致；月历最宽 380px，在手机上与输入框同宽，日期格是方形（约 46px），翻月按钮 44px。
- 键盘：打开后焦点落在选中日期上；方向键左右移一天、上下移一周，跨月自动翻页；Enter 或空格选中并关闭；Esc 关闭并把焦点还给触发按钮。点月历外面也会关闭。

使用者提供：字段名、当前日期、今天、可选范围（以及不可选的原因，写在 `dc-cal-foot`）。每个日期按钮的 `aria-label` 写完整日期（“10月27日 星期二”）。

动效：月历打开时上移淡入（`dc-rise`，160ms）；触发按钮展开时描边变 `dolphin-deep`。
