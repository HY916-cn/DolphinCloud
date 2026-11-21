// P1 · 字幕与字卡：开场片字幕、章节大字、人物字条、片尾字幕。
// 字幕和字条是透明底（ProRes 4444），叠在实拍上；章节字卡白底，片尾字幕黑场。
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fade, font, loadFonts } from "./brand";

export const SUBTITLES = { small: "一张，很小。", counts: "每一笔，都算数。" };
export const CHAPTERS = {
  counter: { zh: "柜台", en: "Counter" },
  students: { zh: "学生", en: "Students" },
  bank: { zh: "银行", en: "Bank" },
};
export const PEOPLE = {
  teller: { name: "柜员姓名", role: "海豚银行柜员" },
  president: { name: "行长姓名", role: "海豚银行行长" },
  admin: { name: "老师姓名", role: "海豚银行管理员" },
};
export const END_CREDIT = "海豚云 · 明德实验学校海豚银行";

loadFonts(
  [
    ...Object.values(SUBTITLES),
    ...Object.values(CHAPTERS).flatMap((c) => [c.zh, c.en]),
    ...Object.values(PEOPLE).flatMap((p) => [p.name, p.role]),
    END_CREDIT,
    "王李张刘陈杨赵黄周吴",
  ].join(""),
);

// Fade in over 15 frames, out over the last 12.
const inOut = (frame: number, total: number) => Math.min(fade(frame, 0, 15), 1 - fade(frame, total - 12, 12));

// Centre subtitle over footage: white, with a soft shade so it reads on bright water.
export const Subtitle: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          font: `700 76px/1.3 ${font}`,
          letterSpacing: "0.12em",
          color: "#fff",
          textShadow: "0 2px 28px rgba(19, 40, 92, 0.45)",
          opacity: inOut(frame, durationInFrames),
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

// Chapter card: one big Chinese word, a small English line under it, on white.
export const Chapter: React.FC<{ zh: string; en: string }> = ({ zh, en }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "var(--surface-raised)", alignItems: "center", justifyContent: "center", gap: 28 }}>
      <div
        style={{
          font: `800 260px/1.1 ${font}`,
          letterSpacing: "0.16em",
          marginRight: "-0.16em",
          color: "var(--ink)",
          opacity: fade(frame, 0, 6),
          translate: `0 ${interpolate(fade(frame, 0, 14), [0, 1], [36, 0])}px`,
        }}
      >
        {zh}
      </div>
      <div
        style={{
          font: `700 64px/1.2 ${font}`,
          letterSpacing: "0.04em",
          color: "var(--ink-muted)",
          opacity: fade(frame, 8, 12),
          translate: `0 ${interpolate(fade(frame, 8, 16), [0, 1], [20, 0])}px`,
        }}
      >
        {en}
      </div>
    </AbsoluteFill>
  );
};

// Lower third: a design-system card (surface-raised, radius-lg, thick bottom) bottom left.
export const LowerThird: React.FC<{ name: string; role: string }> = ({ name, role }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const show = inOut(frame, durationInFrames);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 140,
          bottom: 130,
          display: "flex",
          alignItems: "baseline",
          gap: 28,
          padding: "26px 44px",
          borderRadius: "var(--radius-lg)",
          background: "var(--surface-raised)",
          boxShadow: "0 8px 0 var(--line), 0 18px 40px rgba(19, 40, 92, 0.18)",
          opacity: show,
          translate: `0 ${interpolate(fade(frame, 0, 18), [0, 1], [24, 0])}px`,
        }}
      >
        <span style={{ font: `800 52px/1.2 ${font}`, letterSpacing: "0.06em", color: "var(--ink)" }}>{name}</span>
        <span style={{ font: `600 34px/1.2 ${font}`, letterSpacing: "0.06em", color: "var(--ink-muted)" }}>{role}</span>
      </div>
    </AbsoluteFill>
  );
};

// End credit on black (script 11:52).
export const EndCredit: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#000", alignItems: "center", justifyContent: "center" }}>
      <div style={{ font: `700 64px/1.3 ${font}`, letterSpacing: "0.12em", color: "#fff", opacity: inOut(frame, durationInFrames) }}>
        {END_CREDIT}
      </div>
    </AbsoluteFill>
  );
};
