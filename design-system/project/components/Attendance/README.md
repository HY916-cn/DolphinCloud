# Attendance

考勤：柜员上下班和老师审核班次用的一组部件，用“中”“下”两个字的小标记表示中午班和下午班。

- 班次标记 `<i class="dc-shift is-confirmed">中</i>`，四种状态：`is-confirmed` 已确认（`success` 实底）、`is-pending` 待审（白底 `dolphin-deep` 描边）、`is-rejected` 已驳回（`danger-soft` 底加删除线）、`is-none` 未上班（`cloud-100` 底）。旁边总有文字或读屏文字，图例用 `dc-shift-legend`。
- 周选择 `dc-weekbar`：上一周、日期（`DatePicker is-bare`）、下一周，不在本周时多一个“本周”。页面主操作不放在这里，手机上放进 `ActionBar`。
- 上下班卡片 `dc-duty`：`dc-duty-main` 里 `<b>` 写状态、`<small>` 写一句说明，按钮放右边（多个时用 `dc-duty-actions`）。四种状态：
  - 未上班：“未上班”，说明两个班次的分界，主按钮“上班”。
  - 已上班：“已上班 · 11月10日 07:45 起”，说明现在的班次和下班前要打印总结，次按钮“下班”。
  - 跨天未下班 `is-stale`：进行中的上班开始于上海时间今天以前。写“上次上班还没下班”，说明前加 `warning` 图标：“从 11月9日 07:45 开始，已经跨天。先下班，再重新上班。”，描边和说明用 `danger`，主按钮“下班”，走原来的下班流程。这时柜台不进入搜索，存款、取款、兑换、冲正都不能办理；离线登记的存款照常。
  - 读不到上班状态：`Notice`（`danger`）“暂时无法确认上班状态”，加“重试”。
- 办理页在未上班和跨天未下班时，整页只有这张卡片，放大成 `EmptyState`：未上班用 `clock` 图标；跨天未下班用 `warning` 图标并加 `dc-empty-icon is-danger`（`danger-soft` 底、`danger` 图标），按钮是主按钮“下班”。
- 办理中服务器拒绝为跨天未下班（`STALE_DUTY`）时，用 `Notice`（`danger`）提示，结束这次办理后回到上面的整页卡片。
- 单个班次一行 `dc-shift-row`，内容放 `dc-shift-main`。
- 周表：`DataTable` 再加 `dc-week`，今天的列加 `is-today`，单元格里 `dc-week-marks` 放两个班次，可操作的是 `<button class="dc-week-btn">`，只读的是 `<span class="dc-week-btn">`；柜员自己的一周用 `dc-week-cell`（标记加文字）。`dc-week-btn` 是 32×36px，属于电脑表格内密集控件的例外。

使用者提供：每个班次的状态和完整的 `aria-label`（“小林 10月27日 中午班待审”）。

动效：无。
