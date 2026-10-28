# Radio

单选列表：在 3～6 个文字选项里选一项，选项需要说明时使用。

- 结构：与 `Checkbox` 相同，`input` 改为 `type="radio"` 并共用一个 `name`，外观 span 改为 `dc-radio-dot`。
- 28px 圆圈，选中后描边变 `dolphin`，中间圆点轻微弹出。

使用者提供：组名、选项、默认选中项。2～4 个可用图标表示的选项用 `ChoiceCard`；2～3 个短选项、用于切换视图时用 `Segmented`；选项超过 6 个用 `Select`。
