// P10 · 数字页（脚本第七段）。一页一个大数字：从纵深里浮上来，数字滚动到位，下面一行小字；
// 上一页退回远处。数字来自 src/numbers.json（`npm run numbers` 重新数）。
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import { easeIn, easeOut, fade, font, loadFonts } from "./brand";
import numbers from "./numbers.json";

const fmt = (n: number) => n.toLocaleString("en-US");

export const PAGES = [
  { value: numbers.days, unit: "天", note: `${numbers.from} — ${numbers.to}` },
  { value: numbers.commits, unit: "次提交", note: "" },
  { value: numbers.components, unit: "个界面组件", note: "" },
  { value: numbers.icons, unit: "个图标", note: "" },
  { value: numbers.dbTests, unit: "项数据库测试", note: "每次修改都要全部跑过" },
  { value: null, unit: "12月1日", note: "正式上线" },
];
export const PAGE_FRAMES = 120;
loadFonts(PAGES.map((p) => `${p.unit}${p.note}`).join("") + "0123456789,—");

const Page: React.FC<(typeof PAGES)[number] & { hold?: boolean }> = ({ value, unit, note, hold }) => {
  const frame = useCurrentFrame();
  const enter = fade(frame, 0, 24);
  const leave = hold
    ? 0
    : interpolate(frame, [PAGE_FRAMES - 14, PAGE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeIn,
  });
  // Count up like the balance (data-count), over one second.
  const shown = value === null ? null : Math.round(interpolate(frame, [4, 34], [0, value], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeOut }));
  return (
    <AbsoluteFill style={{ perspective: 1600 }}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 36,
          // Rise out of depth, sharpen, then fall back into it.
          transform: `translateZ(${interpolate(enter, [0, 1], [-600, 0]) + interpolate(leave, [0, 1], [0, -900])}px)`,
          opacity: enter * (1 - leave),
          filter: `blur(${(1 - enter) * 14 + leave * 10}px)`,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 32, color: "var(--ink)" }}>
          {shown === null ? null : (
            <span style={{ font: `800 300px/1 ${font}`, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em", color: "var(--dolphin)" }}>{fmt(shown)}</span>
          )}
          <span style={{ font: `800 ${shown === null ? 240 : 96}px/1.1 ${font}`, letterSpacing: "0.06em", color: shown === null ? "var(--dolphin)" : undefined }}>{unit}</span>
        </div>
        <div style={{ font: `700 56px/1.3 ${font}`, letterSpacing: "0.1em", color: "var(--ink-muted)", opacity: fade(frame, 14, 16) }}>
          {note}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Numbers: React.FC = () => (
  <AbsoluteFill style={{ background: "var(--surface-raised)" }}>
    {PAGES.map((p, i) => (
      // The last page holds to the end of the composition.
      <Sequence key={p.unit} from={i * PAGE_FRAMES} durationInFrames={i === PAGES.length - 1 ? undefined : PAGE_FRAMES}>
        <Page {...p} hold={i === PAGES.length - 1} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
