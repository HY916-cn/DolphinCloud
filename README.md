<div align="center">

# 海豚云 · DolphinCloud

**面向校园银行的一体化业务平台——让每笔业务可追溯，让柜台、财务与运营协同在同一套系统中。**

[![Expo](https://img.shields.io/badge/Expo-58-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-self--hosted-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Docker-one--image-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

[![Stars](https://img.shields.io/github/stars/HY916-cn/DolphinCloud?logo=github&label=Stars)](https://github.com/HY916-cn/DolphinCloud/stargazers)
[![Forks](https://img.shields.io/github/forks/HY916-cn/DolphinCloud?logo=github&label=Forks)](https://github.com/HY916-cn/DolphinCloud/network/members)
[![Last Commit](https://img.shields.io/github/last-commit/HY916-cn/DolphinCloud?logo=git&logoColor=white)](https://github.com/HY916-cn/DolphinCloud/commits/main)
[![Repo Size](https://img.shields.io/github/repo-size/HY916-cn/DolphinCloud)](https://github.com/HY916-cn/DolphinCloud)
[![Issues](https://img.shields.io/github/issues/HY916-cn/DolphinCloud?logo=github&label=Issues)](https://github.com/HY916-cn/DolphinCloud/issues)

学生以海豚币办理存取、定期、理财、贷款与文创兑换；<br/>
柜员、行长、财务、库管、银行管理员与运维员分角色完成日常经营。

</div>

---

## 核心能力

- **完整的校园银行业务**：覆盖存取、定期、理财、贷款、利息、信用分、文创商品与库存管理。
- **不可变流水**：余额由业务流水推出，错账通过冲正更正，保留完整审计轨迹。
- **分角色工作台**：学生、柜员、行长、财务、库管、银行管理员和运维员拥有各自的界面与权限。
- **单镜像自托管**：Expo Router Web 前端、Supabase 后端与 Caddy 集成在一个 Docker 镜像中，支持自动 HTTPS、备份、恢复与健康检查。
- **面向上线的验证链路**：包含单元测试、pgTAP、Playwright 端到端测试、性能测试、学期模拟、升级与上线演练。

完整的开发文档（架构、数据模型、接口、测试与验收）见 [docs/development/PHASE-1.md](docs/development/PHASE-1.md)，二期开发文档见 [docs/development/PHASE-2.md](docs/development/PHASE-2.md)，验收清单见 [docs/development/ACCEPTANCE.md](docs/development/ACCEPTANCE.md)，历次审查报告见 [docs/audit/](docs/audit/)。

## 仓库结构

```text
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
npm --prefix client ci
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
| `docker/smoke-test.sh` | 80 端口跳转 HTTPS、安全头、健康检查、登录与锁定、`create-admin`、图片上传、公开页面（大屏时间、利率看板、文件传输经 Storage 上传 100 MB 与下载、来源 IP、PROXY 协议、后台删除与清理）、加密备份与恢复、容器重启（Postgres 正常关闭） |
| `docker/e2e-test.sh` | 运行 `client/e2e` 的 Playwright 测试（Chromium 全部，WebKit 跑柜台和学生端，iPhone 尺寸跑学生端）。每个 spec 开始前重新导入种子数据，柜员的上班和种子业务都是当天的；上海时间零点前 3 分钟内开始的 spec 先等过零点，避免跨天；`E2E_SHARDS=3` 时分 3 份同时跑，各用一个容器；首次运行前执行 `npx --prefix client playwright install chromium webkit` |
| `docker/upgrade-test.sh <旧提交>` | 从旧提交的镜像升级到新镜像：旧容器正常关闭、迁移、升级前备份、余额与库存不变、自检 |
| `docker/perf-test.sh` | 2000 名学生、10 万笔流水下的计时，以及各身份直接修改余额、库存和流水全部被拒 |
| `docker/sim-test.sh` | 2000 名学生跑满一学期（18 周）和之后一周假期的随机业务（含开定期与提前支取、买理财与赎回、放款与还款）与每天的定时任务：每个周一都有锚点且始终在 1%～4%，每天都计活期利息（含假期），每天自检无差异，单次 `run_daily` 不超过 30 秒，到期的定期和理财全部转回活期（更长的转入下学期），全部到期的贷款都已结清或逾期在册 |
| `docker/rehearsal-test.sh` | 上线前演练（约 1～2 分钟）：两个容器用同一份数据按天跑过今天之前的 16 天。学期结转后余额、信用分和未结的定期、理财、贷款原样转入下学期，上学期按学期可查、只有补录和编辑能改；一个容器 `docker stop` 几天再 `docker start`，Postgres 正常关闭，`dolphin-jobs` 自己补跑，结果与每天运行的容器逐行相同 |

```bash
docker/upgrade-test.sh <生产环境当前的提交>
```

CI（`.github/workflows/ci.yml`）在每次推送和 PR 上同时运行依赖审计、类型检查、代码检查与单元测试，构建镜像跑 pgTAP 与冒烟测试，以及分 4 份并行的端到端测试（只改 Markdown 或 `docs/` 的推送不运行）；推送到 `main` 通过后把镜像发布到 `ghcr.io/hy916-cn/dolphin-cloud`。性能测试、模拟、演练和升级测试（从一周前的 `main` 升级）每周运行一次，也可手动触发。

## 部署

```bash
docker run -d --name dolphin-cloud --restart unless-stopped --stop-timeout 120 \
  -p 80:80 -p 443:443 \
  -v dolphin-data:/data \
  -e DOLPHIN_DOMAIN=bank.example.edu.cn \
  -e ACME_EMAIL=it@example.edu.cn \
  -e BACKUP_RECIPIENT='age1...' \
  ghcr.io/hy916-cn/dolphin-cloud:main
```

将 `age1...` 替换为实际的 age 公钥；容器会自动备份业务数据，生产环境应始终配置加密接收者。`--stop-timeout 120` 让 Postgres 在 Docker 强制结束前写完关闭检查点；用 docker compose 时写 `stop_grace_period: 2m`（见 PHASE-1.md §9.2）。

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DOLPHIN_DOMAIN` | 必填 | 访问域名，不含端口；本地测试用 `localhost` |
| `ACME_EMAIL` | — | 证书到期通知邮箱；由 Let's Encrypt 签发时必填 |
| `DOLPHIN_PORT` | `443` | 容器内 HTTPS 监听端口，放在端口转发或隧道后面时使用；对外地址始终是 `https://$DOLPHIN_DOMAIN` |
| `BACKUP_TIME` | `02:00` | 每日备份时间 |
| `BACKUP_RETENTION_DAYS` | `30` | 备份保留天数 |
| `BACKUP_RECIPIENT` | — | age 公钥（`age1…`），设置后备份加密为 `.tar.gz.age`；生产环境应设置 |
| `DOLPHIN_PROXY_PROTOCOL` | — | 前面的转发程序发送 PROXY 协议头时，填它连到容器的来源网段（CIDR，空格分隔），Caddy 从头部取访问者 IP；文件传输按 IP 限流，见 PHASE-1.md §3.3 |

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
| `dolphin jobs clean` | 立即清理文件传输：到期的取件、2 小时内没传完的发送及其文件；`dolphin-jobs` 每天 00:05 自动执行 |
| `dolphin status` | 各进程状态、版本、最近一次备份、备份是否加密、定时任务是否正常 |
| `dolphin health` | 镜像健康检查：Auth、PostgREST、Storage 应答且 Caddy 在运行 |
| `dolphin reset-admin` | 银行管理员忘记密码时生成新的初始密码，解除停用和登录锁定 |

恢复加密备份：

```bash
docker exec -i dolphin-cloud dolphin restore <文件名> < backup-key.txt
```

备份、升级与安全细节见 [PHASE-1.md 第 9 节](docs/development/PHASE-1.md#9-部署与运维)。
