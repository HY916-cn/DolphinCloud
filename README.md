# 海豚云

海豚云是明德学校校园银行「海豚银行」的业务平台：学生以海豚币办理存取和文创兑换，柜员在柜台办理业务，财务、库管、银行管理员和运维员在后台管理流水、商品、账号与系统。余额只能由业务流水推出，错账用冲正更正，记录不删除。前端是 Expo Router Web 应用，后端是自托管的 Supabase（Postgres、Auth、PostgREST、Storage）加 Caddy，全部打包在一个 Docker 镜像里，一条 `docker run` 启动并自动申请 HTTPS 证书。

完整的开发文档（架构、数据模型、接口、测试与验收）见 [docs/development/PHASE-1.md](docs/development/PHASE-1.md)，二期开发文档见 [docs/development/PHASE-2.md](docs/development/PHASE-2.md)，验收清单见 [docs/development/ACCEPTANCE.md](docs/development/ACCEPTANCE.md)，历次审查报告见 [docs/audit/](docs/audit/)。

## 仓库结构

```
client/          Expo 前端（src/ 源码，e2e/ Playwright 测试）
supabase/
  migrations/    数据库迁移（开发与生产共用）
  tests/         pgTAP 测试
  seed.sql       开发种子数据
docker/          Dockerfile、Caddyfile、supervisord.conf、init/、bin/（入口脚本与运维命令 dolphin）、测试脚本
design-system/   海豚云设计系统
docs/            产品文档、需求、开发文档、审查报告（audit/）与本地样例（samples/）
```

## 本地开发

前置：Node.js LTS、Docker Desktop。本地用正式镜像起一个后端容器，再用 Metro 开发服务器跑前端；Metro 把 `/auth`、`/rest`、`/storage`、`/config.js` 转发给 `https://localhost:18444` 上的容器，前端与 API 同源，与生产一致。

构建镜像：

```bash
docker build -f docker/Dockerfile -t dolphin-cloud:dev .
```

启动后端容器：

```bash
docker run -d --name dolphin-dev -e DOLPHIN_DOMAIN=localhost -p 127.0.0.1:18444:443 -v dolphin-dev-data:/data dolphin-cloud:dev
```

导入种子数据（银行管理员 `admin`、运维员 `ops01`、柜员 `teller01`、行长 `president01`、财务 `accountant01`、库管 `keeper01` 与三名学生，密码均为测试密码 `a12345678`，只用于本地）：

```bash
docker exec -i dolphin-dev psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/seed.sql
```

启动前端：

```bash
npm --prefix client run web
```

## 测试

前端类型检查、单元测试与代码检查：

```bash
npm --prefix client run typecheck
```

```bash
npm --prefix client test
```

```bash
npm --prefix client run lint
```

以下脚本都接受镜像名作参数（默认 `dolphin-cloud:dev`），各自起临时容器，结束后（包括失败和中断）删除本次创建的容器和数据卷。容器名带进程号（如 `dolphin-smoke-12345`），端口由 Docker 分配到本机空闲端口，多个脚本可以同时运行。

| 脚本 | 内容 |
| --- | --- |
| `docker/db-test.sh` | 在镜像上逐个运行 `supabase/tests/*.sql`（pgTAP） |
| `docker/smoke-test.sh` | 80 端口跳转 HTTPS、安全头、健康检查、登录与锁定、`create-admin`、图片上传、加密备份与恢复、容器重启 |
| `docker/e2e-test.sh` | 运行 `client/e2e` 的 Playwright 测试（Chromium 全部，WebKit 跑柜台和学生端，iPhone 尺寸跑学生端）。每个 spec 开始前重新导入种子数据，柜员的上班和种子业务都是当天的；上海时间零点前 3 分钟内开始的 spec 先等过零点，避免跨天；`E2E_SHARDS=3` 时分 3 份同时跑，各用一个容器；首次运行前执行 `npx --prefix client playwright install chromium webkit` |
| `docker/upgrade-test.sh <旧提交>` | 从旧提交的镜像升级到新镜像：迁移、升级前备份、余额与库存不变、自检 |
| `docker/perf-test.sh` | 2000 名学生、10 万笔流水下的计时，以及各身份直接修改余额、库存和流水全部被拒 |
| `docker/sim-test.sh` | 2000 名学生跑满一学期（18 周）的随机业务（含开定期与提前支取、买理财与赎回、放款与还款）与每天的定时任务：锚点始终在 1%～4%，每天自检无差异，单次 `run_daily` 不超过 30 秒，到期的定期和理财全部转回活期（更长的转入下学期）、贷款全部结清或逾期在册 |

```bash
docker/upgrade-test.sh <生产环境当前的提交>
```

CI（`.github/workflows/ci.yml`）在每次推送和 PR 上同时运行依赖审计、类型检查、代码检查与单元测试，构建镜像跑 pgTAP 与冒烟测试，以及分 4 份并行的端到端测试（只改 Markdown 或 `docs/` 的推送不运行）；推送到 `main` 通过后把镜像发布到 `ghcr.io/hy916-cn/dolphin-cloud`。性能测试和升级测试（从一周前的 `main` 升级）每周运行一次，也可手动触发。

## 部署

```bash
docker run -d --name dolphin-cloud --restart unless-stopped -p 80:80 -p 443:443 -v dolphin-data:/data -e DOLPHIN_DOMAIN=bank.example.edu.cn -e ACME_EMAIL=it@example.edu.cn ghcr.io/hy916-cn/dolphin-cloud:1.0.0
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DOLPHIN_DOMAIN` | 必填 | 访问域名，不含端口；本地测试用 `localhost` |
| `ACME_EMAIL` | — | 证书到期通知邮箱；由 Let's Encrypt 签发时必填 |
| `DOLPHIN_PORT` | `443` | 容器内 HTTPS 监听端口，放在端口转发或隧道后面时使用；对外地址始终是 `https://$DOLPHIN_DOMAIN` |
| `BACKUP_TIME` | `02:00` | 每日备份时间 |
| `BACKUP_RETENTION_DAYS` | `30` | 备份保留天数 |
| `BACKUP_RECIPIENT` | — | age 公钥（`age1…`），设置后备份加密为 `.tar.gz.age`；生产环境应设置 |

挂载了 `/certs/fullchain.pem` 与 `/certs/privkey.pem` 时使用这两个证书文件。数据库密码与各项密钥在首次启动时自动生成，保存在 `/data/secrets/`。

首次启动后创建银行管理员账号（全系统一个），命令打印初始密码，登录后设置新密码：

```bash
docker exec -it dolphin-cloud dolphin create-admin admin
```

## 运维命令

在容器里运行 `dolphin <命令>`，如 `docker exec dolphin-cloud dolphin status`。

| 命令 | 作用 |
| --- | --- |
| `dolphin backup` | 立即备份 |
| `dolphin backups` | 列出备份文件 |
| `dolphin restore <文件名>` | 恢复指定备份，恢复前自动再备份一次当前数据；加密备份从标准输入读私钥 |
| `dolphin check` | 核对余额与流水，有不一致时退出码为 1 |
| `dolphin jobs` | 定时任务处理到哪天、最后成功时间、有没有失败，以及当前学期 |
| `dolphin jobs run` | 立即补跑定时任务；有任务失败时退出码为 1 |
| `dolphin jobs fetch` | 立即取理财参考指数（沪深 300）最近 10 个开盘日的日线，依次试腾讯、新浪、东方财富；都取不到时写日志并退出码为 1。`dolphin-jobs` 每天 00:05 补跑前和 15:30 收盘后会自动执行，取不到时每 10 分钟重试 6 次、之后每小时重试到当天结束 |
| `dolphin status` | 各进程状态、版本、最近一次备份、备份是否加密、定时任务是否正常 |
| `dolphin health` | 镜像健康检查：Auth、PostgREST、Storage 应答且 Caddy 在运行 |
| `dolphin reset-admin` | 银行管理员忘记密码时生成新的初始密码，解除停用和登录锁定 |

恢复加密备份：

```bash
docker exec -i dolphin-cloud dolphin restore <文件名> < backup-key.txt
```

备份、升级与安全细节见 [PHASE-1.md 第 9 节](docs/development/PHASE-1.md#9-部署与运维)。
