# Attendance

考勤：柜员上下班和老师审核班次用的一组部件，用“中”“下”两个字的小标记表示中午班和下午班。

- 班次标记 `<i class="dc-shift is-confirmed">中</i>`，四种状态：`is-confirmed` 已确认（`success` 实底）、`is-pending` 待审（白底 `dolphin-deep` 描边）、`is-rejected` 已驳回（`danger-soft` 底加删除线）、`is-none` 未上班（`cloud-100` 底）。旁边总有文字或读屏文字，图例用 `dc-shift-legend`。
- 周选择 `dc-weekbar`：上一周、日期（`DatePicker is-bare`）、下一周，不在本周时多一个“本周”。页面主操作不放在这里，手机上放进 `ActionBar`。
- 上下班卡片 `dc-duty`：`dc-duty-main` 写状态，`dc-duty-actions` 放按钮。
- 单个班次一行 `dc-shift-row`，内容放 `dc-shift-main`。
- 周表：`DataTable` 再加 `dc-week`，今天的列加 `is-today`，单元格里 `dc-week-marks` 放两个班次，可操作的是 `<button class="dc-week-btn">`，只读的是 `<span class="dc-week-btn">`；柜员自己的一周用 `dc-week-cell`（标记加文字）。`dc-week-btn` 是 32×36px，属于电脑表格内密集控件的例外。

使用者提供：每个班次的状态和完整的 `aria-label`（“小林 10月27日 中午班待审”）。

动效：无。
