// P2 · 标题（脚本 1.5，1:20–1:35）。苹果发布会式的快节奏：
// 一笔笔进账随鼓点闪过并越来越快 → 合计 → “It all adds up.” 逐词落下 → 中文主题 → 标志与海浪。
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { easeOut, fade, font, loadFonts } from "./brand";
import { Waves } from "./Waves";

export type Theme = "light" | "dark";

const THEMES = {
  light: { bg: "var(--surface-raised)", text: "var(--ink)", muted: "var(--ink-muted)", tile: "var(--surface-raised)" },
  dark: { bg: "#000", text: "var(--on-dolphin)", muted: "var(--cloud-200)", tile: "var(--surface-raised)" },
};

// Small deposits in real denominations (1 / 2 / 5 / 10), each held for `hold` frames;
// the holds shrink so the cuts speed up into the total.
const ENTRIES: [string, number, number][] = [
  ["存款", 10, 16], ["奖励", 5, 14], ["存款", 2, 12], ["利息", 1, 10], ["存款", 10, 9], ["存款", 5, 8],
  ["奖励", 2, 7], ["存款", 10, 6], ["利息", 1, 5], ["存款", 5, 5], ["存款", 10, 4], ["奖励", 5, 4],
  ["存款", 2, 4], ["存款", 10, 3], ["利息", 1, 3], ["存款", 5, 3], ["存款", 10, 3], ["奖励", 2, 3],
];
const TOTAL = ENTRIES.reduce((sum, [, amount]) => sum + amount, 0);
const WORDS = ["It", "all", "adds", "up."];
const ZH = "每一笔，都算数。";

// Beats in frames from 1:20 (30 fps); 1:25 = 150, 1:29 = 270.
const T = { total: 119, theme: 150, wordGap: 5, zh: 192, logo: 270, end: 450 };

loadFonts(ENTRIES.map(([k]) => k).join("") + `累计${TOTAL}HTB${WORDS.join(" ")}${ZH}海豚云2026发布会+0123456789`);

const Center: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 24 }) => (
  <AbsoluteFill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap }}>
    {children}
  </AbsoluteFill>
);

const Amount: React.FC<{ label: string; value: string; c: (typeof THEMES)[Theme] }> = ({ label, value, c }) => (
  <Center gap={8}>
    <div style={{ font: `700 56px/1.2 ${font}`, letterSpacing: "0.08em", color: c.muted }}>{label}</div>
    <div style={{ font: `800 240px/1.1 ${font}`, fontVariantNumeric: "tabular-nums", color: c.text }}>
      {value}
      <span style={{ fontSize: 88, marginLeft: 24, color: c.muted }}>HTB</span>
    </div>
  </Center>
);

const Total: React.FC<{ c: (typeof THEMES)[Theme] }> = ({ c }) => {
  const frame = useCurrentFrame();
  // Count up like the balance does (data-count, 600 ms, --ease-out).
  const n = Math.round(interpolate(frame, [0, 18], [0, TOTAL], { extrapolateRight: "clamp", easing: easeOut }));
  return <Amount label="累计" value={String(n)} c={c} />;
};

const Theme: React.FC<{ c: (typeof THEMES)[Theme] }> = ({ c }) => {
  const frame = useCurrentFrame();
  return (
    <Center gap={40}>
      <div style={{ display: "flex", gap: "0.28em", font: `800 200px/1.15 ${font}`, letterSpacing: "0.01em", color: c.text }}>
        {WORDS.map((w, i) => (
          <span
            key={w}
            style={{
              opacity: fade(frame, i * T.wordGap, 4),
              translate: `0 ${interpolate(fade(frame, i * T.wordGap, 10), [0, 1], [36, 0])}px`,
            }}
          >
            {w}
          </span>
        ))}
      </div>
      <div
        style={{
          font: `700 72px/1.3 ${font}`,
          letterSpacing: "0.12em",
          color: c.muted,
          opacity: fade(frame, T.zh - T.theme, 18),
          translate: `0 ${interpolate(fade(frame, T.zh - T.theme, 24), [0, 1], [20, 0])}px`,
        }}
      >
        {ZH}
      </div>
    </Center>
  );
};

const Brand: React.FC<{ c: (typeof THEMES)[Theme]; theme: Theme }> = ({ c, theme }) => {
  const frame = useCurrentFrame();
  const pop = fade(frame, 0, 14);
  return (
    <AbsoluteFill>
      {/* The waves rise with depth: the far layer surfaces first, the near one travels furthest. */}
      <Waves scale={3} camY={interpolate(fade(frame, 4, 60), [0, 1], [420, 0])} focusBlur={4} />
      <Center gap={36}>
        {/* The logo as its app icon: on surface-raised, as the logo guidelines require. */}
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 260,
            height: 260,
            marginBottom: 24,
            borderRadius: 64,
            background: c.tile,
            boxShadow: theme === "light" ? "0 12px 0 var(--line), inset 0 0 0 4px var(--line)" : undefined,
            opacity: pop,
            scale: interpolate(pop, [0, 1], [0.88, 1]),
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: 220, height: 220 }} />
        </div>
        <div style={{ font: `800 120px/1.1 ${font}`, letterSpacing: "0.08em", color: c.text, opacity: fade(frame, 6, 14) }}>
          海豚云
        </div>
        <div style={{ font: `700 52px/1.3 ${font}`, letterSpacing: "0.12em", color: c.muted, opacity: fade(frame, 14, 16) }}>
          2026 发布会
        </div>
      </Center>
    </AbsoluteFill>
  );
};

export const Title: React.FC<{ theme: Theme }> = ({ theme }) => {
  const c = THEMES[theme];
  let at = 0;
  return (
    <AbsoluteFill style={{ background: c.bg, fontFamily: font }}>
      {/* Hard cuts on the beat: each entry replaces the last. */}
      {ENTRIES.map(([label, amount, hold], i) => {
        const from = at;
        at += hold;
        return (
          <Sequence key={i} from={from} durationInFrames={hold}>
            <Amount label={label} value={`+${amount}`} c={c} />
          </Sequence>
        );
      })}
      <Sequence from={T.total} durationInFrames={T.theme - T.total}>
        <Total c={c} />
      </Sequence>
      <Sequence from={T.theme} durationInFrames={T.logo - T.theme}>
        <Theme c={c} />
      </Sequence>
      <Sequence from={T.logo}>
        <Brand c={c} theme={theme} />
      </Sequence>
    </AbsoluteFill>
  );
};
