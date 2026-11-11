# CreditGauge

信用仪表盘：海豚信用分（0～1000）的唯一呈现方式。半圆的浅色轨道从左到右是 0 到 1000 分，实色进度从 0 走到当前分数，圆钮停在进度末端，中间大字写分数。所有地方的信用分都用它，不单独写数字；变动记录里的 +5、−50 仍是文字。

## 结构

```html
<div class="dc-gauge is-lg">
  <div class="dc-gauge-dial" role="meter" aria-label="海豚信用分" aria-valuemin="0" aria-valuemax="1000"
    aria-valuenow="680" aria-valuetext="海豚信用分 680 分" style="--score:680">
    <span class="dc-gauge-arc"></span>
    <span class="dc-gauge-tick"></span>
    <span class="dc-gauge-mark">可贷款</span>
    <span class="dc-gauge-pointer"></span>
    <b class="dc-gauge-score">680<small>分</small></b>
  </div>
  <p class="dc-gauge-ends" aria-hidden="true"><span>0</span><span>1000</span></p>
  <p class="dc-gauge-foot">贷款额度 <b>165 HTB</b></p>
  <p class="dc-gauge-next">再涨 8 分，额度加 5 HTB</p>
</div>
```

- `dc-gauge-dial` 带 `role="meter"` 和全部 `aria-*`，分数写在 `--score` 里。`meter` 的子元素不会被读屏读出，所以额度和“再涨 N 分”放在它外面。
- 弧线 `dc-gauge-arc`：`cloud-100` 轨道上画进度，两端圆头。400 分以上进度用 `success`；400 分以下，`dc-gauge-dial` 加 `is-low`，进度换成 `danger`。进度由浅到深：起点是同色混入 30% 白（`color-mix`，不支持时为实色），末端是满色，正好落在圆钮上；小号用实色。
- 400 分处有一道刻度 `dc-gauge-tick`：在轨道上切一道 3px 的白缝，进度走过时也看得见分界，弧线外侧再有一小段 `ink-muted` 短线；上方标“可贷款”（`dc-gauge-mark`）。
- 指针 `dc-gauge-pointer` 是白底圆钮，描边与进度同色，带一层浅阴影，停在进度末端。
- 大号和中号在弧线两端下方写 `0` 和 `1000`（`dc-gauge-ends`，对读屏隐藏）。

## 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `score` | 0～1000 的整数 | 当前分数，写进 `--score`、`aria-valuenow`、`aria-valuetext` 和中间的数字。超出范围时按 0 或 1000 显示。 |
| `size` | `lg` / `md` / `sm` | 尺寸，对应 `is-lg`、`is-md`、`is-sm`。 |
| `limit` | 数字或 `null` | 单笔贷款额度，只有 `lg` 和 `md` 显示。`null` 表示不能贷款，这一行写“400 分以上才能贷款”。 |
| `next` | 数字或 `null` | 再涨多少分额度加 5 HTB，只有 `lg` 显示；`null`（不能贷款或额度已到最高）时不显示这一行。 |

额度和 `next` 都由使用方按参数 `credit_curve` 算好传入，组件不做计算。

## 尺寸

| 尺寸 | 弧线宽 | 分数字号 | 附带内容 | 用在 |
| --- | --- | --- | --- | --- |
| `is-lg` | 280px | 48px | 贷款额度，以及“再涨 N 分，额度加 5 HTB” | 学生“信用”页、后台学生信用详情 |
| `is-md` | 200px | 36px | 贷款额度 | 柜台“贷款”“定期”面板、学生首页、贷款详情 |
| `is-sm` | 28px | 16px | 无，只有弧线和数字，与文字同高 | 柜台学生卡片、后台各列表里的一行 |

小号的写法：

```html
<span class="dc-gauge is-sm">
  <span class="dc-gauge-dial" role="meter" aria-label="海豚信用分" aria-valuemin="0" aria-valuemax="1000"
    aria-valuenow="680" aria-valuetext="海豚信用分 680 分" style="--score:680">
    <span class="dc-gauge-arc"></span><span class="dc-gauge-pointer"></span>
  </span>
  <b class="dc-gauge-score" aria-hidden="true">680</b>
</span>
```

小号没有刻度、“可贷款”和两端的数，数字放在弧线右边，并对读屏隐藏，避免读两遍。400 分以下同样加 `is-low`。

## 各分数的表现

| 分数 | 圆钮位置 | 额度一行 | “再涨”一行（大号） |
| --- | --- | --- | --- |
| 0 | 最左端，红色 | 400 分以上才能贷款 | 不显示 |
| 399 | 刻度左侧，红色 | 400 分以上才能贷款 | 不显示 |
| 400 | 正好在刻度上，变成绿色 | 贷款额度 50 HTB | 再涨 12 分，额度加 5 HTB |
| 600 | 偏左上方，绿色 | 贷款额度 130 HTB | 再涨 4 分，额度加 5 HTB |
| 1000 | 最右端，绿色，轨道走满 | 贷款额度 300 HTB | 不显示（已到最高） |

示例里“再涨”的分数按 PHASE-2 §8.1 的公式算出，实际值由使用方传入。

## 颜色

- 进度只有两种颜色，用的是状态色：`success` 表示能贷款，`danger` 表示还不能贷款。颜色从不单独表达意思：总有分数数字、“可贷款”刻度和额度文字。
- 进度最浅的起点在 `surface-raised` 上也高于 3:1（`success` 3.3:1，`danger` 3.2:1）；轨道 `cloud-100` 只是底色，不表达意思。
- 颜色全部取变量。设计系统目前没有深色主题，以后加深色主题时，弧线、圆钮和文字会跟着变量变化。

## 动效

- 分数变化时，圆钮沿弧线转到新位置，同时中间的数字从旧值滚动到新值，600ms（`--motion-count`，`--ease-out`），和余额滚动相同；首次显示不转、不滚。
- 系统开启“减少动态效果”时，圆钮和数字直接停在新位置。
- 圆钮转动用注册过的 `--score` 属性过渡；浏览器不支持时直接跳到新位置。

使用者提供：分数、尺寸，以及大号和中号的额度、大号的“再涨 N 分”。
