// P2 · 标题（脚本 1.5，1:20–1:35）：海水到天空，三层海浪升起，主题，标志。
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { easeOut, font, loadFonts } from "./brand";
import { Waves } from "./Waves";

export const TITLE = { en: "It all adds up.", zh: "每一笔，都算数。", tag: "海豚云 · 2026 发布会" };
loadFonts(Object.values(TITLE).join(""));

// Beats in frames from 1:20 (30 fps).
const T = { waves: 0, theme: 150, zh: 158, logo: 270 };

const enter = (frame: number, from: number, rise: number) => ({
  opacity: interpolate(frame, [from, from + 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  }),
  translate: `0 ${interpolate(frame, [from, from + 36], [rise, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeOut,
  })}px`,
});

// Faint static grain so the pale gradient does not band after compression.
const Grain = () => (
  <svg width="100%" height="100%" style={{ position: "absolute", opacity: 0.05 }}>
    <filter id="grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
    </filter>
    <rect width="100%" height="100%" filter="url(#grain)" />
  </svg>
);

export const Title: React.FC = () => {
  const frame = useCurrentFrame();
  // Sky (cloud-100) spreads up over the sea (sea-soft) while the waves rise;
  // it settles on the LoginPage hero gradient.
  const sky = interpolate(frame, [0, 90], [150, 60], {
    extrapolateRight: "clamp",
    easing: easeOut,
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, var(--sea-soft) 0%, var(--cloud-100) ${sky}%)`,
        fontFamily: font,
      }}
    >
      <Grain />
      <Waves scale={5} riseFrom={T.waves} />
      <AbsoluteFill
        style={{
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: 220,
          gap: 20,
        }}
      >
        <div
          style={{
            font: `800 152px/1.2 ${font}`,
            letterSpacing: "0.02em",
            color: "var(--ink)",
            ...enter(frame, T.theme, 24),
          }}
        >
          {TITLE.en}
        </div>
        <div
          style={{
            font: `700 56px/1.4 ${font}`,
            letterSpacing: "0.08em",
            color: "var(--ink-muted)",
            ...enter(frame, T.zh, 24),
          }}
        >
          {TITLE.zh}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 36,
            marginTop: 72,
            ...enter(frame, T.logo, 16),
          }}
        >
          {/* LoginPage's mark: logo on a white disc inside three sonar rings, floating 6px every 4 s. */}
          <div
            style={{
              display: "grid",
              placeItems: "center",
              width: 120,
              height: 120,
              borderRadius: "var(--radius-pill)",
              background: "var(--surface-raised)",
              boxShadow:
                "0 0 0 16px rgba(255,255,255,.6), 0 0 0 40px rgba(255,255,255,.32), 0 0 0 72px rgba(255,255,255,.16)",
            }}
          >
            <Img
              src={staticFile("logo.png")}
              style={{
                width: 114,
                height: 114,
                translate: `0 ${-6 * Math.sin(((frame - T.logo) / 120) * Math.PI) ** 2}px`,
              }}
            />
          </div>
          <div style={{ font: `700 44px/1.3 ${font}`, letterSpacing: "0.08em", color: "var(--ink)" }}>
            {TITLE.tag}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
