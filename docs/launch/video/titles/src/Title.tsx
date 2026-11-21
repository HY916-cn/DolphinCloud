// P2 · 标题（脚本 1.5，1:20–1:35）。苹果发布会式的快节奏：
// 一笔笔进账随鼓点闪过并越来越快 → 合计 → “It all adds up.” 逐词落下 → 中文主题 → 标志与海浪。
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { easeOut, fade, font, loadFonts } from "./brand";
import { Waves } from "./Waves";

export type Theme = "light" | "dark";

// Text colours follow the content: ink for titles, dolphin for the words and numbers that
// matter, the category colour when a line names a kind of business. On black: white with gold.
const THEMES = {
  light: {
    bg: "var(--surface-raised)",
    text: "var(--ink)",
    muted: "var(--ink-muted)",
    accent: "var(--dolphin)",
    tile: "var(--surface-raised)",
    kind: { 存款: "var(--sea-ink)", 奖励: "var(--coin-ink)", 利息: "var(--coin-ink)", 累计: "var(--ink-muted)" } as Record<string, string>,
  },
  dark: {
    bg: "#000",
    text: "var(--on-dolphin)",
    muted: "var(--cloud-200)",
    accent: "var(--coin)",
    tile: "var(--surface-raised)",
    kind: { 存款: "var(--sea-soft)", 奖励: "var(--coin-soft)", 利息: "var(--coin-soft)", 累计: "var(--cloud-200)" } as Record<string, string>,
  },
};

// Small deposits in real denominations (1 / 2 / 5 / 10), each held for a number of beats of
// the opening music (Dreaming Big, 135 BPM): four quarter notes, four eighths, then sixteenths.
export const BEAT = (30 * 60) / 135;
const ENTRIES: [string, number, number][] = [
  ["存款", 10, 1], ["奖励", 5, 1], ["存款", 2, 1], ["利息", 1, 1], ["存款", 10, 0.5], ["存款", 5, 0.5],
  ["奖励", 2, 0.5], ["存款", 10, 0.5], ["利息", 1, 0.25], ["存款", 5, 0.25], ["存款", 10, 0.25], ["奖励", 5, 0.25],
  ["存款", 2, 0.25], ["存款", 10, 0.25], ["利息", 1, 0.25], ["存款", 5, 0.25], ["存款", 10, 0.25], ["奖励", 2, 0.25],
];
const TOTAL = ENTRIES.reduce((sum, [, amount]) => sum + amount, 0);
// Each cut lands on the nearest frame to its beat; the drum hits in the opening mix use these frames.
export const CUTS = ENTRIES.reduce<number[]>((acc, [, , beats]) => [...acc, acc[acc.length - 1] + beats], [0]).map((b) => Math.round(b * BEAT));
const WORDS = ["It", "all", "adds", "up."];
const ZH = "每一笔，都算数。";

// Beats in frames from 1:20 (30 fps); 1:25 = 150, 1:29 = 270.
const T = { total: CUTS[CUTS.length - 1], theme: 150, wordGap: 5, zh: 192, logo: 270, end: 450 };

loadFonts(ENTRIES.map(([k]) => k).join("") + `累计${TOTAL}HTB${WORDS.join(" ")}${ZH}海豚云2026发布会+0123456789`);

const Center: React.FC<{ children: React.ReactNode; gap?: number }> = ({ children, gap = 24 }) => (
  <AbsoluteFill style={{ flexDirection: "column", alignItems: "center", justifyContent: "center", gap }}>
    {children}
  </AbsoluteFill>
);

const Amount: React.FC<{ label: string; value: string; c: (typeof THEMES)[Theme] }> = ({ label, value, c }) => (
  <Center gap={8}>
    <div style={{ font: `700 56px/1.2 ${font}`, letterSpacing: "0.08em", color: c.kind[label] }}>{label}</div>
    <div style={{ font: `800 240px/1.1 ${font}`, fontVariantNumeric: "tabular-nums", color: c.accent }}>
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
              color: i >= 2 ? c.accent : undefined,
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
  return (
    <AbsoluteFill style={{ background: c.bg, fontFamily: font }}>
      {/* Hard cuts on the beat: each entry replaces the last. */}
      {ENTRIES.map(([label, amount], i) => (
        <Sequence key={i} from={CUTS[i]} durationInFrames={CUTS[i + 1] - CUTS[i]}>
          <Amount label={label} value={`+${amount}`} c={c} />
        </Sequence>
      ))}
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
