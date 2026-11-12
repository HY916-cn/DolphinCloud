# RankingPage

存款排名示例：回答“我在学部里排第几、离前一名还差多少”。

- 外壳 `AppShell`（当前为“排名”），标题“存款排名”，副标题“小学部”。
- 名次卡（`dc-card dc-rank-card`）：大号名次徽章 `dc-medal is-lg` 和“第 12 名”（`amount` 字号）；金色提示条 `dc-rank-next` 写“再存 14 HTB 超过第 11 名”；名次刻度 `dc-rank-scale` 从“第 486 名”到“第 1 名”，蓝点停在自己的真实位置，下面一句“超过了小学部 474 位同学”。电脑上在右栏随页面固定；手机和平板排在榜单后面。
- 领奖台 `dc-podium`（“小学部存款榜”）：前三名从左到右为第 2、1、3 名，台子一个比一个高；徽章和台面分别是银（`cloud-200`）、金（`coin`）、浅金（`coin-soft`），台面上写存款；自己在台上时徽章外加一圈海豚蓝，`aria-current="true"`。
- 第 4 名起是排行榜 `dc-ranks`：每行 `dc-rank` 是名次圆、姓名和班级、存款，下面一条 `dc-rank-bar` 金色细条，长度是该同学存款占第 1 名的比例。
- 右栏名次卡下面是“我的前后”：自己和前后各一名；自己的一行 `is-me`（`cloud-100` 底、海豚蓝描边、蓝色名次圆、“我”标签，`aria-current="true"`）。
- 行内部件：`dc-rank-no` 名次圆、`dc-rank-who` 里放 `dc-rank-name` 和 `dc-rank-class`、`dc-rank-amount` 存款、`dc-rank-sum` 汇总；名次卡的 `dc-rank-head`、`dc-rank-place`，刻度的 `dc-rank-track`、`dc-rank-ends`；台面文字 `dc-podium-step`。
- 名次用金、银、浅金三色（奖励类）；“我”用海豚蓝的选中态，不另加颜色。

使用者提供：前 10 名、自己的名次和存款、前一名的存款、学部人数，以及自己和前后各一名。

排名按存款排，存款 = 活期 + 定期（`deposit_ranking` 的 `balance`）；页面上写“存款”，不写“余额”。
