// P5 · 设计短片（脚本 4.1）。真实组件（bundle.css 的 dc- 类）和真实截图，白底、悬浮在纵深里。
// 五段对应五句画外音：云朵海浪海豚 → 颜色 → 按钮按下 → 一句说清的提示 → 焦点环与减少动态效果。
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { icons } from "../../../../../client/src/theme/icons";
import { easeOut, fade, font, loadFonts } from "./brand";
import { Card } from "./Card";
import { SHOTS } from "./shots";
import { Waves } from "./Waves";

export const DESIGN = { origin: 0, colors: 210, press: 510, words: 690, access: 900, end: 1080 };
const ORIGIN = ["云朵", "海浪", "海豚"];
const KINDS = [
  { kind: "dc-kind-save", icon: "deposit", name: "存款", at: 150 },
  { kind: "dc-kind-withdraw", icon: "withdraw", name: "取款", at: 185 },
  { kind: "dc-kind-exchange", icon: "exchange", name: "兑换", at: 220 },
  { kind: "dc-kind-reward", icon: "star", name: "奖励", at: 255 },
] as const;
const BUTTONS = [
  { cls: "dc-btn dc-btn-primary", text: "确认存款" },
  { cls: "dc-btn dc-btn-secondary", text: "查询余额" },
  { cls: "dc-btn dc-btn-secondary", text: "打开存折版" },
  { cls: "dc-btn dc-btn-ghost", text: "返回" },
];
loadFonts([...ORIGIN, ...KINDS.map((k) => k.name), ...BUTTONS.map((b) => b.text), "确认存款 27 HTB", "减少动态效果", "直接显示结果，不播放动画"].join(""));

const Icon: React.FC<{ name: keyof typeof icons }> = ({ name }) => (
  <svg
    className="dc-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: icons[name] }}
  />
);

const white = { background: "var(--surface-raised)", fontFamily: font };
const rise = (frame: number, at: number, by = 40) => ({
  opacity: fade(frame, at, 12),
  translate: `0 ${interpolate(fade(frame, at, 20), [0, 1], [by, 0])}px`,
});

// 1 · 云朵、海浪、海豚: the login mark floating in its sonar rings over the three waves.
const Origin: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={white}>
      <Waves scale={4} focusBlur={4} camY={interpolate(fade(frame, 0, 70), [0, 1], [520, 0])} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 110, paddingBottom: 120 }}>
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 260,
            height: 260,
            borderRadius: "var(--radius-pill)",
            background: "var(--surface-raised)",
            // LoginPage's three sonar rings, scaled from the desktop .dc-login-mark.
            boxShadow: "0 0 0 36px rgba(201,214,248,.55), 0 0 0 90px rgba(201,214,248,.3), 0 0 0 160px rgba(201,214,248,.14)",
            ...rise(frame, 6),
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: 240, height: 240, translate: `0 ${-10 * Math.sin((frame / 120) * Math.PI) ** 2}px` }} />
        </div>
        <div style={{ display: "flex", gap: 120 }}>
          {ORIGIN.map((w, i) => (
            <div key={w} style={{ font: `800 80px/1.2 ${font}`, letterSpacing: "0.12em", color: "var(--ink)", ...rise(frame, 60 + i * 30, 24) }}>
              {w}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 2 · 每种颜色只表示一件事: the counter's seven tabs, then four real service tiles, each lifting on its line.
const Colors: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ ...white, perspective: 1800 }}>
      <div style={{ position: "absolute", left: "50%", top: "28%", transformStyle: "preserve-3d" }}>
        <Card shot={SHOTS.tabs} width={1700} x={0} y={0} z={interpolate(fade(frame, 0, 60), [0, 1], [-400, 0])} opacity={fade(frame, 0, 16)} />
      </div>
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 70, paddingTop: 300, transformStyle: "preserve-3d" }}>
        {KINDS.map((k, i) => {
          const lift = fade(frame, k.at, 14) * (1 - fade(frame, k.at + 34, 14));
          return (
            <div key={k.name} style={{ zoom: 2.6, ...rise(frame, 40 + i * 8, 30), scale: 1 + lift * 0.1, translate: `0 ${interpolate(fade(frame, 40 + i * 8, 20), [0, 1], [30, 0]) - lift * 14}px` }}>
              <a className={`dc-tile ${k.kind}`} style={{ width: 132 }}>
                <span className="dc-tile-icon">
                  <Icon name={k.icon} />
                </span>
                {k.name}
              </a>
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// 3 · 能按下去: a real primary button, tilted to show its thick base, pressed twice.
const PRESSES = [50, 110];
const Press: React.FC = () => {
  const frame = useCurrentFrame();
  // Down in 3 frames (--motion-press 100 ms), held 4, back up in 3.
  const down = Math.max(...PRESSES.map((p) => interpolate(frame, [p, p + 3, p + 7, p + 10], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  return (
    <AbsoluteFill style={{ ...white, alignItems: "center", justifyContent: "center", perspective: 1400 }}>
      <div style={{ zoom: 4, transform: `rotateX(${interpolate(frame, [0, 180], [32, 12], { easing: easeOut })}deg)`, ...rise(frame, 0, 10) }}>
        <button
          className="dc-btn dc-btn-primary"
          style={{
            // bundle.css .dc-btn-primary:active, driven by the frame.
            transform: `translateY(${3 * down}px)`,
            boxShadow: down > 0.5 ? "0 2px 0 var(--dolphin-deep)" : "var(--shadow-button)",
          }}
        >
          <Icon name="deposit" />
          确认存款 27 HTB
        </button>
      </div>
    </AbsoluteFill>
  );
};

// 4 · 说清数字，说清下一步: the real withdraw limit: the field and its reason, then the disabled button.
const Words: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ ...white, perspective: 1800 }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", transformStyle: "preserve-3d" }}>
        <Card shot={SHOTS.limitField} width={1500} x={0} y={-90} z={interpolate(fade(frame, 0, 90), [0, 1], [-500, 0])} rotY={interpolate(fade(frame, 0, 120), [0, 1], [-10, 0])} opacity={fade(frame, 0, 16)} />
        <Card shot={SHOTS.limitButton} width={560} x={330} y={260} z={120} opacity={fade(frame, 60, 14)} />
      </div>
    </AbsoluteFill>
  );
};

// 5 · 键盘也能用，也能不看动画: the focus ring steps across real buttons, then "减少动态效果" switches on.
const STEP = 18;
const Access: React.FC = () => {
  const frame = useCurrentFrame();
  const at = Math.floor((frame - 10) / STEP);
  const switchOn = frame >= 100;
  return (
    <AbsoluteFill style={{ ...white, alignItems: "center", justifyContent: "center", gap: 90 }}>
      <div style={{ zoom: 2.4, display: "flex", gap: 24, alignItems: "flex-start" }}>
        {BUTTONS.map((b, i) => (
          <button
            key={b.text}
            className={b.cls}
            style={{
              // .dc-btn:focus-visible — the white then dolphin-deep ring.
              boxShadow:
                frame >= 10 && at === i && frame < 10 + BUTTONS.length * STEP
                  ? `${i === 0 ? "var(--shadow-button), " : ""}var(--focus-ring)`
                  : undefined,
            }}
          >
            {b.text}
          </button>
        ))}
      </div>
      <label className="dc-switch" style={{ zoom: 2.4, width: 420, ...rise(frame, 80, 16) }}>
        <span className="dc-switch-text">
          <b>减少动态效果</b>
          <small>直接显示结果，不播放动画</small>
        </span>
        <input type="checkbox" role="switch" checked={switchOn} readOnly />
        <span className="dc-switch-track" />
      </label>
    </AbsoluteFill>
  );
};

export const Design: React.FC = () => (
  <AbsoluteFill style={white}>
    <Sequence durationInFrames={DESIGN.colors}>
      <Origin />
    </Sequence>
    <Sequence from={DESIGN.colors} durationInFrames={DESIGN.press - DESIGN.colors}>
      <Colors />
    </Sequence>
    <Sequence from={DESIGN.press} durationInFrames={DESIGN.words - DESIGN.press}>
      <Press />
    </Sequence>
    <Sequence from={DESIGN.words} durationInFrames={DESIGN.access - DESIGN.words}>
      <Words />
    </Sequence>
    <Sequence from={DESIGN.access}>
      <Access />
    </Sequence>
  </AbsoluteFill>
);
