# LoginPage

登录页示例：天空与海浪托起登录面板，学生和工作人员从同一入口登录。

- 结构：`.dc-app` → `dc-login`：`dc-login-hero`（标志、`display` 标题、一句说明、电脑上显示的三条要点 `dc-login-points`、平移的海浪）和 `<form class="dc-login-panel">`。
- 面板内容：标题“登录”、身份选择（`ChoiceCard`：学生 / 工作人员）、学号或账号、密码（附首次登录说明）、整行登录按钮 `dc-btn-block`、忘记密码说明。
- 手机：面板从海浪上方升起，占满屏幕下部；平板：居中卡片，最宽 480px；电脑：左侧天空区，右侧 520px 登录面板。
- 登录中按钮加 `is-loading` 并改为“正在登录”；账号或密码不对时在按钮上方放 `Notice`（“账号或密码不正确”）并让密码框 `dc-nudge`。
