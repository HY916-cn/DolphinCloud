# 发布会演示片段

`docs/launch/SCRIPT.md` 里的演示 1～18：用 Playwright 录真实运行的海豚云（本地种子数据），在 Remotion 里放进悬浮在 3D 空间里的设备外框：讲到的界面从屏幕里浮出成独立的层，镜头缓慢转动、推近，旁边用海豚蓝标注说明。成片 3840×2160、30 fps，每段一份 ProRes 422 HQ（剪辑用）和一份 H.264（预览用），输出到 `docs/launch/video/out/demos/`。

| 目录 | 内容 |
| --- | --- |
| `capture/` | 录制脚本：`lib.mjs` 录制与合成，`prep.mjs` 录制前补几笔业务，`counter.mjs` 等每条录屏的操作，`reset.sh` 保存、恢复数据快照 |
| `captures/` | 录屏 `<名称>.mp4` 与时间标记、元素位置 `<名称>.json`（不进仓库） |
| `src/` | Remotion：`stage.tsx` 场景、设备、浮层、标注、触点与运镜；`Timer.tsx` 计时器；`Counter.tsx` 演示 1～2 |

## 录制

页面按设备尺寸原生 2 倍渲染，三路截图并行（约 55 fps），每帧记下拍摄时刻，再按时刻合成 30 fps，播放速度与实际一致；动效按 `motion.md` 原样，不加速、不改界面。操作用触摸点击，悬停样式不出现。

1. 构建并启动后端（端口由 Docker 分配），导入种子数据，保存快照：

   ```bash
   docker build -f docker/Dockerfile -t dolphin-cloud:video1 .
   docker run -d --name dolphin-video1 -e DOLPHIN_DOMAIN=localhost -p 127.0.0.1::443 -v dolphin-video1-data:/data dolphin-cloud:video1
   docker port dolphin-video1 443
   docker exec -i dolphin-video1 psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/seed.sql
   ```

2. 启动前端，指向这个容器（端口换成上一步看到的）：

   ```bash
   CI=1 DOLPHIN_DEV_API=https://localhost:<端口> npm --prefix client run web -- --port 8093
   ```

3. 用柜台补几笔业务（王小雨存款、兑换），再保存快照：

   ```bash
   cd docs/launch/video/demos && node capture/prep.mjs && capture/reset.sh save
   ```

4. 录制（每次先恢复快照）。一条录屏可以供几段演示用，`counter` 供演示 1、2：

   ```bash
   npm run record:counter
   ```

## 渲染

```bash
npm run render
npm run render -- Demo01 Demo02
```

`npm run dev` 打开 Remotion Studio 预览。

## 清理

```bash
docker rm -f dolphin-video1 && docker volume rm dolphin-video1-data && docker rmi dolphin-cloud:video1
```
