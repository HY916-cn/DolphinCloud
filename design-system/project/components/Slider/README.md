# Slider

滑块：在一个范围内选择数值，并实时看到结果，例如“活期转为定期”的金额。

- 结构：`<div class="dc-slider">`：`dc-slider-head`（名称 + `<output class="dc-slider-value">300<small>HTB</small></output>`）、`<input type="range" style="--value:.625">`、`dc-slider-scale`（最小值与最大值说明）。
- 12px 轨道，已选部分 `dolphin`；36px 白色圆钮、`dolphin` 描边加厚底，按住时放大到 1.1 倍。
- 使用者在 `input` 事件里更新 `--value`（0～1）和显示的数值。

使用者提供：最小值、最大值、步长（金额以 10 为步长）、当前值。精确金额仍要能直接输入：滑块旁配一个 `Field` 或步进按钮。

动效：按住圆钮放大到 1.1 倍；数值变化即时显示，不做延迟动画。
