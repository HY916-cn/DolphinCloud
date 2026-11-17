# 海豚云 · 项目工作规范

海豚云是明德学校校园银行「海豚银行」的业务平台。产品、架构与接口以 `docs/` 为准：[PRODUCT.md](docs/product/PRODUCT.md)、[PHASE-1.md](docs/development/PHASE-1.md)、[PHASE-2.md](docs/development/PHASE-2.md)、[ACCEPTANCE.md](docs/development/ACCEPTANCE.md)；界面以 [设计系统 README](design-system/project/README.md) 为准；Expo 的用法见 [client/AGENTS.md](client/AGENTS.md)。本项目的具体做法以本文件为准，本文件没写到的按用户全局规则。

## 会话分工

| 会话 | 负责 | 不改 |
| --- | --- | --- |
| 💻后端开发 | `supabase/`、`docker/`、`.github/workflows/ci.yml`、`docs/development/`、README 的运维与测试部分；`client/e2e/` 只加用例或改测试基础设施（如 `helpers.ts` 的 `resetData()`） | `client/src/`、`design-system/` |
| 🎨前端设计 | `design-system/` 全部内容（本会话直接改）；`client/` 的界面实现（经子会话完成，由本会话验收提交） | `supabase/`、`docker/`、后端脚本；PHASE 文档的文案与后端约定后由后端改 |
| 🔀仓库管理 | 仓库整理、本文件、跨会话规范 | 业务代码 |

- 主会话负责拆分、派单、验收和小的文档改动，开发在子会话里做。
- 同一批文件同一时间只有一个写入者。主检出目录由多个会话共用：只用 pathspec 提交自己改的文件，不用 `git add -A`，不在别人未提交的工作区上 rebase 或提交。
- 别的会话的进程和容器（包括 8011 端口的 `dolphincloud` 容器）由它们自己跑完、自己清理。
- `docs/audit/` 的审查报告原文保持不变，复验另写新文件，如 `audit-2026-11-09-verification.md`。

## 子会话

- 一项任务一个会话，标题写“领域：具体任务”，如“后端：越权矩阵测试”“前端：M8 信用分页面与对接”。同一任务的追问和返工用 SendMessage 发回原会话，新任务新开。
- 后端子会话：`fresh`，`use_worktree: true`，`name` 用 `be-…`，专用镜像 `dolphin-cloud:beN`（每个会话不同）。完成后 rebase 到最新的 `origin/main`，测试通过后 `git push origin HEAD:main`。
- 前端子会话：`fresh`，`use_worktree: false`。只改 `client/`（含 e2e），设计系统缺的部分回报给🎨前端设计补；子会话不提交，由🎨前端设计验收后提交。
- 任务说明写清：基线提交；允许改和不改的范围；依据的文档章节和接口约定；预先分配的迁移时间戳和测试编号（后端）；要跑的测试；临时容器和镜像的清理；回报内容（签名、JSON 示例、错误码、做出的规则决定、留给后续的事项、前端要做的事）。
- 并行的后端子会话预先分好互不重叠的迁移时间戳和测试编号。
- 文档没写清时，子会话按最简单可靠的做法决定，同步到 PHASE 文档并在报告里写明。
- 验收：读完整报告，看 diff 和迁移，复跑检查，确认没有残留的容器和镜像，最后以 CI 结果为准。
- 用户亲口要求的那一轮直接开子会话，不先问用户。由其他会话的消息触发的那一轮只能提卡片：提出后用一句话请用户回复“开始”，并说明卡片在哪个会话里（远程控制时用户可能看不到）。

## 数据库

- 迁移：`supabase/migrations/YYYYMMDDHHMMSS_描述.sql`。时间戳是按顺序递增的编号，不对应真实日期；新一项取比现有更大的日期，同一项内按 `…000000`、`…000100`、`…000200` 递增。
- 已执行过的迁移永远不改，`dolphin-migrate` 校验 sha256，不一致会拒绝启动。改函数就在新迁移里 `create or replace`，并注明“as in <原文件>”。
- pgTAP：`supabase/tests/NN_描述.sql`，两位数递增；每个迁移配测试，改账务函数必须补测试。新增的每个对外函数都登记进 `20_rpc_matrix.sql`（它从 `pg_proc` 核对）。
- 函数：业务都写在 `security definer` 函数里，`set search_path = ''`；`revoke ... from public, anon` 后 `grant execute ... to authenticated`；用 `app_private.require_role(...)` 限制身份，行长不能做的事加 `app_private.forbid_president()`；内部函数放在 `app_private`；报错用 `app_private.fail('错误码', 详情jsonb)`。
- 表：业务表在 `public`，开启 RLS，`authenticated` 只有 `select`；加审计触发器 `app_private.audit_row`。对象名用英文蛇形；只用 Postgres 自带扩展。
- 账务：金额、数量都是整数，单位 HTB；时间用 `timestamptz`，“当天”按上海时间（`app_private.cn_date`）。余额只由流水推出，错账用冲正，流水只增不改。
- 种子数据只用于本地和测试，测试密码 `a12345678`。端到端测试的每个 spec 开始前，`resetData()` 恢复迁移完成时的状态，再重新执行 `seed.sql`。
- 已确认保留的取舍记在 ACCEPTANCE.md 2026-11-11 一节，审查时不当作问题重复提出。

## 设计系统与前端

- 设计系统（`design-system/project/`）是界面的唯一来源：`README.md` 写原则、文案、颜色、字体、图标和清单；`tokens.json` 与 `layout.md`、`motion.md`、`data.md` 是规范；组件是 `components/<Name>/README.md` 加 `preview.html`，样式只写在 `components/bundle.css`；图标在 `assets/Icons/`；索引是 `design-system.json`。
- 改设计系统的步骤：
  1. 改文档和 CSS；视觉有变化就同步 `preview.html`，用 Playwright 截图检查溢出、对比度和手机宽度。
  2. 更新 `design-system.json` 的 `lastChange`。
  3. 运行 `npm --prefix client run tokens`，生成 `client/src/theme/{tokens.css,bundle.css,icons.ts}`；生成物不手改。
  4. `design-system/` 和 `client/src/theme/` 放在同一个提交里。
  5. 发布到设计系统 Artifact（https://claude.ai/artifact/SM1TwrRscwoUyscrogRjtV，`root` 为 `design-system`）：先读线上版本，与改动前的仓库版本比对哈希再发布；新图标先作为资产上传，再登记进 `assetGroups.Icons`。
  6. 推送，再开前端子会话应用到 `client/`。
- 图标取自 `lucide-static`（ISC），从 npm 包取官方 SVG，描边 `#1f5ff5`，48×48，文件首行写来源注释。图标变形用 morphicons（MIT），只用于同一位置随状态换图标（见 `motion.md`），图标包在 `fill="none"` 的 svg 里。字体是 Nunito Sans 加 Noto Sans SC，正式站点自己托管。
- 代码位置：页面在 `client/src/app/`（Expo Router），组件在 `client/src/components/` 并从 `index.ts` 导出，纯函数在 `client/src/lib/` 并配 `*.test.mjs`。
- 样式只用设计系统生成的主题和 `dc-` 类，不写页面级 CSS，不用行内样式拼布局；缺样式先补设计系统。侧栏导航支持到 20 项，比窗口高时可以滚动。
- 文案按设计系统「文字与语气」，只写在组件和 `errors.ts` 中：正式，结果直接写结果，说明写清数字和下一步；单位 HTB，负号用 −，日期写“M月D日 HH:mm”；按钮 2～6 个字，不用全角括号；金额经 `lib/format.ts` 格式化。
- 适配：容器查询断点 600px 与 1024px；手机上页面主操作放进 `ActionBar`（后台也一样）；iPad Safari 可用；存折版是固定大小的一本，一屏放下、页面不滚动，加内容要实测 iPhone 13。
- 无障碍：文字对比度 ≥ 4.5:1，图形 ≥ 3:1；点击区 ≥ 44px，都有焦点环；弹层把焦点留在里面，关闭后还给触发按钮；减少动态效果时直接显示结果；仪表盘用 `role="meter"` 和完整的 `aria-*`；读不到金额时显示占位，不显示 0。

## 提交前的检查

| 改动 | 检查 |
| --- | --- |
| 前端代码（每次） | `npm --prefix client run typecheck`、`npm --prefix client run lint`、`npm --prefix client test` |
| 后端（每次） | `docker build -f docker/Dockerfile -t dolphin-cloud:beN .`，再跑 `docker/db-test.sh dolphin-cloud:beN`、`docker/smoke-test.sh dolphin-cloud:beN` |
| 迁移、种子数据、客户端可见的行为、功能性前端改动、里程碑收尾 | 加跑 `E2E_SHARDS=3 docker/e2e-test.sh <镜像>`（分 3 份、各用一个容器同时跑，约 5 分钟）；小返工只跑相关 spec |
| 有迁移的里程碑、备份与恢复 | 加跑 `docker/upgrade-test.sh <线上版本>` 和 `docker/rollback-test.sh <线上版本>`（当前线上版本 `50c538d`） |
| 视觉变化 | 截图核对 |
| 依赖变化 | `npm --prefix client run build`，对比体积 |

- 测试脚本可以并行：容器和数据卷名带进程号，端口由 Docker 分配。新写的脚本也照此办理。`perf-test.sh` 由 CI 每周运行，需要时手动跑。
- 推送后看 CI：check、image（构建镜像、pgTAP、冒烟）和分 4 份的 e2e 同时开始，约 10 分钟；全部通过后 publish 给 image 测过的镜像打上 `main` 标签。只改 Markdown 或 `docs/` 的推送不触发 CI，也不会取消正在跑的运行。新推送会取消同一分支上还在跑的运行，以最新一次为准，“cancelled”不算失败；代码改动尽量攒成一次推送。失败时先读日志找根因：后端或测试基础设施的问题开后端子会话修，前端的问题交给🎨前端设计。

## Git

- 在 `main` 上工作，测试通过就提交并推送到 `main`，不开 PR；推送前先 `git pull --rebase`。推送到 `main` 且 CI 通过后自动发布镜像。
- 提交信息：英文祈使句标题写结果，正文简述行为，一次提交一件事，末尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 名册等含真实姓名的 `.xlsx` 不进仓库（`.gitignore` 已忽略）。

## 文档同步

- 产品范围变化：先改 `docs/product/PRODUCT.md`，再改 PHASE 文档。
- PHASE-2.md：子会话做出的规则决定、§18 里程碑、§19 验收勾选、错误码表。
- PHASE-1.md：运维命令（§9.3）、备份与升级回滚（§9.4、§9.5）、权限、种子账号、测试说明（§10）。
- README.md：运维命令表、测试脚本表、种子账号。
- ACCEPTANCE.md：一批工作或一个里程碑收尾时，新增带日期的一节：本次运行、完成事项及证据、已确认的取舍、上线前仍需完成的事项。
- 前端调整了文案，告诉后端，由后端同步 PHASE 文档。
- 规范和文档只写最终状态。人称代词不默认性别，写“这位学生”。

## 会话交接

- 后端 → 前端：后端推送并核对后，用 SendMessage 发给🎨前端设计，写明提交号、文档章节、函数签名、JSON 返回示例、错误码及建议文案、界面要体现的规则、要做的页面和要补的 e2e，并注明“先改 design-system，再应用到 client”。纯设计系统的工作可以在后端完成前先发。
- 前端 → 后端：完成后回复设计系统版本号、提交号和设计系统的改动；发现后端问题时带证据发给后端。后端再核对客户端调用是否符合接口约定，并看 CI。
- 转达用户的同意时附上用户原话。用户说过不做的事，不主动转交。

## 经验

- 子会话报告“测试通过”之后，CI 仍可能因时序或环境失败，以 CI 为准，修根因。偶发失败先找到能稳定复现的用例，再判断是应用还是测试的问题。
- 恢复备份先恢复到新库再替换，`pg_restore --clean` 原地恢复会被升级新增的外键挡住；回滚到旧镜像时，用新镜像里的 `dolphin` 恢复。
- 补跑多天定时任务时，按日期交替执行每日和每周任务，结果才与每天正常运行一致；改规则时注意学期边界。
- Artifact 发布前必须先读线上版本，否则会被拒绝。
