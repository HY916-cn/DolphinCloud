// P14 · 功能墙（脚本第六段，9:40–10:20 里的制作画面）。
// 一组组真实界面悬在纵深里，镜头一组一组往前推，停留越来越短；最后所有卡片退到远处排成一面墙。
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import lockIcon from "../../../../../design-system/project/assets/Icons/lock.svg";
import uploadIcon from "../../../../../design-system/project/assets/Icons/upload.svg";
import rateIcon from "../../../../../design-system/project/assets/Icons/rate.svg";
import savingsIcon from "../../../../../design-system/project/assets/Icons/savings.svg";
import fileIcon from "../../../../../design-system/project/assets/Icons/file.svg";
import checkIcon from "../../../../../design-system/project/assets/Icons/check.svg";
import { fade, loadFonts } from "./brand";
import { Card, CARD_W, cardHeight } from "./Card";
import { SHOTS, type Shot } from "./shots";

type Item = { label: string; shot?: Shot; icon?: string };
// `at` is the frame the camera arrives at the group, following the voice-over lines.
const GROUPS: { at: number; items: Item[] }[] = [
  { at: 0, items: [{ label: "导入名册", shot: SHOTS.importStudents }, { label: "导入工作人员", shot: SHOTS.importStaff }] },
  { at: 150, items: [{ label: "补录流水", shot: SHOTS.txnsNew }] },
  {
    at: 300,
    items: [
      { label: "商品", shot: SHOTS.products },
      { label: "出入库", shot: SHOTS.stock },
      { label: "库存预警", shot: SHOTS.alerts },
    ],
  },
  {
    at: 420,
    items: [
      { label: "信用分开关", shot: SHOTS.credit },
      { label: "利率参数", shot: SHOTS.rates },
      { label: "理财参数", shot: SHOTS.wealth },
      { label: "取款上限", shot: SHOTS.settings },
    ],
  },
  { at: 570, items: [{ label: "学生管理", shot: SHOTS.students }] },
  { at: 645, items: [{ label: "多账号切换", shot: SHOTS.counterMe }] },
  { at: 720, items: [{ label: "首次登录改密码", icon: lockIcon }] },
  { at: 780, items: [{ label: "断网登记", icon: uploadIcon }] },
  { at: 885, items: [{ label: "文件传输", shot: SHOTS.transfer }] },
  {
    at: 975,
    items: [
      { label: "每天计息", icon: rateIcon },
      { label: "每周结息", icon: savingsIcon },
      { label: "每日备份", icon: fileIcon },
      { label: "余额自检", icon: checkIcon },
    ],
  },
];
export const WALL = { start: 1035, frames: 1110 };

loadFonts(GROUPS.flatMap((g) => g.items.map((i) => i.label)).join(""));

const P = 2000; // CSS perspective
const GAP = 80;
const STEP_Z = 3600; // depth between groups

// Lay each group out side by side at its own depth, weaving left and right.
const placed = GROUPS.flatMap((g, gi) =>
  g.items.map((item, i) => {
    const n = g.items.length;
    const offset = (i - (n - 1) / 2) * (CARD_W + GAP);
    return {
      ...item,
      group: gi,
      x: (gi % 2 ? 260 : -260) + offset,
      y: (gi % 3) * 60 - 60,
      z: -gi * STEP_Z,
      rotY: n > 1 ? (i - (n - 1) / 2) * -6 : 0,
    };
  }),
);

// Camera distance that makes a group of n cards fill a comfortable width.
const distFor = (n: number) => {
  const width = n * CARD_W + (n - 1) * GAP;
  const scale = (n === 1 ? 980 : 1700) / width;
  return P / scale - P;
};

// The final wall: rows of five, centred, well behind the last group.
const COLS = 5;
const wallZ = -(GROUPS.length + 1) * STEP_Z;
const rowH = cardHeight(SHOTS.importStudents) + 80;
const wallSlot = (k: number) => {
  const row = Math.floor(k / COLS);
  const inRow = Math.min(COLS, placed.length - row * COLS);
  const col = k % COLS;
  const rows = Math.ceil(placed.length / COLS);
  return { x: (col - (inRow - 1) / 2) * (CARD_W + GAP), y: (row - (rows - 1) / 2) * rowH, z: wallZ };
};
const wallDist = distFor(COLS) * 1.08;

// Camera keyframes: hold on each group, then glide to the next in `lead` frames, landing on its beat.
const stops = GROUPS.map((g, gi) => ({ at: g.at, x: gi % 2 ? 260 : -260, y: (gi % 3) * 60 - 60, z: -gi * STEP_Z + distFor(g.items.length) }));
const legs = [...stops, { at: WALL.start + 60, x: 0, y: 0, z: wallZ + wallDist }];
const keys = { t: [] as number[], x: [] as number[], y: [] as number[], z: [] as number[] };
legs.forEach((s, i) => {
  if (i > 0) {
    const prev = legs[i - 1];
    const lead = i === legs.length - 1 ? 60 : Math.min(24, (s.at - prev.at) / 2);
    keys.t.push(s.at - lead);
    keys.x.push(prev.x);
    keys.y.push(prev.y);
    keys.z.push(prev.z);
  }
  keys.t.push(s.at);
  keys.x.push(s.x);
  keys.y.push(s.y);
  keys.z.push(s.z);
});
const glide = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) } as const;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const Wall: React.FC = () => {
  const frame = useCurrentFrame();
  const cam = {
    x: interpolate(frame, keys.t, keys.x, glide),
    y: interpolate(frame, keys.t, keys.y, glide),
    z: interpolate(frame, keys.t, keys.z, glide),
  };
  // A slow sideways drift so the held shots still breathe.
  const drift = Math.sin(frame / 90) * 30;
  // Rack focus: the group nearest its own viewing distance is in focus.
  let focusZ = 0;
  let bestErr = Infinity;
  GROUPS.forEach((g, gi) => {
    const zv = -gi * STEP_Z - cam.z;
    const err = Math.abs(zv + distFor(g.items.length));
    if (err < bestErr) {
      bestErr = err;
      focusZ = zv;
    }
  });

  return (
    <AbsoluteFill style={{ background: "var(--surface-raised)", perspective: P, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "46%",
          transformStyle: "preserve-3d",
          transform: `translate3d(${-cam.x + drift}px, ${-cam.y}px, ${-cam.z}px)`,
        }}
      >
        {placed.map((c, k) => {
          const w = wallSlot(k);
          // Cards the camera has passed rise out of the far fog into their slots, one after
          // another; the last group recedes into its place, ahead of the camera.
          const passed = c.group < GROUPS.length - 1;
          const t = fade(frame, WALL.start + (passed ? k * 1.5 : 0), 50);
          const from = passed ? { x: w.x, y: w.y, z: wallZ - 6000 } : c;
          const z = interpolate(t, [0, 1], [from.z, w.z]);
          // Depth from the viewer: fade out before passing the camera, fog in the far distance.
          const zv = z - cam.z;
          const near = interpolate(zv, [P * 0.45, P * 0.75], [1, 0], clamp);
          const far = interpolate(zv, [-16000, -9000], [0, 1], clamp);
          const blur = Math.min(10, Math.abs(zv - focusZ) / 500) * (1 - t);
          return (
            <Card
              key={c.label}
              {...c}
              x={interpolate(t, [0, 1], [from.x, w.x])}
              y={interpolate(t, [0, 1], [from.y, w.y])}
              z={z}
              rotY={c.rotY * (1 - t)}
              opacity={passed && frame >= WALL.start - 60 ? Math.min(t, far) : Math.min(near, far)}
              blur={blur}
              labelOpacity={1 - t}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
