// 开场片 0:00–1:45 的卡点预览：实拍镜头先用占位卡，制作部分用成品（字幕、标题），
// 配上 scripts/opening-mix.sh 混出的音乐与音效，用来确认节点。不是成片。
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { font, loadFonts } from "./brand";
import { Subtitle, SUBTITLES } from "./Captions";
import { Title } from "./Title";

// [start second, end second, label]; empty label = black.
const SHOTS: [number, number, string][] = [
  [0, 4, ""],
  [4, 8, "S1 储蓄盒锁扣极近特写，一道光划过"],
  [8, 11, "S2 海豚币纸币一角，焦点移到面额"],
  [11, 15, "S3 蓝色校服袖口划过画面"],
  [15, 20, "S4 一滴水落进水洼，涟漪散开"],
  [20, 28, "S5 一张海豚币落在摊开的手掌上"],
  [28, 35, "S6 涟漪扩大成水面，阳光闪烁"],
  [35, 39, "S7 高处俯拍校园"],
  [39, 43, "S8 早读，老师把海豚币放进学生手里"],
  [43, 47, "S9 行长推门，拉起百叶窗"],
  [47, 51, "S10 俯拍：柜员把纸币按面额放进格子"],
  [51, 55, "S11 屏幕蓝光映在主讲人脸上，按下回车"],
  [55, 59, "S12 走廊慢镜头，学生攥着海豚币奔跑"],
  [59, 60, "S13 纸币落进格子"],
  [60, 61, "S13 粉笔落在黑板上"],
  [61, 62, "S13 回车键按下"],
  [62, 63, "S13 门锁扣上"],
  [63, 64, "S14 转动的地球仪"],
  [64, 65, "S14 教室的挂钟"],
  [65, 66, "S14 弹起的篮球"],
  [66, 67, "S14 投影仪的光圈"],
  [67, 71, "S15 午休排队，学生把海豚币递过柜台"],
  [71, 75, "S16 反打：平板蓝光照在两人脸上"],
  [75, 80, ""],
  [95, 98, "S17 礼堂空镜，大屏上是海浪"],
  [98, 102, "S18 主讲人从侧幕走到台中"],
  [102, 105, "S18 中近景：“Good morning!”"],
];
loadFonts(SHOTS.map((s) => s[2]).join("") + "实拍0123456789:");

const fps = 30;

const Placeholder: React.FC<{ label: string }> = ({ label }) => (
  // The shot note sits high so the subtitles in the centre stay readable.
  <AbsoluteFill style={{ background: label ? "#1b1f2a" : "#000", alignItems: "center", paddingTop: 140, gap: 20 }}>
    {label ? (
      <>
        <div style={{ font: `700 32px/1 ${font}`, letterSpacing: "0.2em", color: "var(--cloud-300)" }}>实拍</div>
        <div style={{ font: `700 56px/1.3 ${font}`, letterSpacing: "0.06em", color: "#fff" }}>{label}</div>
      </>
    ) : null}
  </AbsoluteFill>
);

const Timecode: React.FC = () => {
  const frame = useCurrentFrame();
  const s = frame / fps;
  return (
    <div style={{ position: "absolute", right: 40, top: 30, font: `700 36px/1 ${font}`, fontVariantNumeric: "tabular-nums", color: "#fff", mixBlendMode: "difference" }}>
      {`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`}
    </div>
  );
};

export const OPENING_FRAMES = 105 * fps;

export const Opening: React.FC = () => (
  <AbsoluteFill style={{ background: "#000" }}>
    {SHOTS.map(([a, b, label]) => (
      <Sequence key={a} from={a * fps} durationInFrames={(b - a) * fps}>
        <Placeholder label={label} />
      </Sequence>
    ))}
    <Sequence from={24 * fps} durationInFrames={4 * fps}>
      <Subtitle text={SUBTITLES.small} />
    </Sequence>
    <Sequence from={31 * fps} durationInFrames={4 * fps}>
      <Subtitle text={SUBTITLES.counts} />
    </Sequence>
    <Sequence from={80 * fps} durationInFrames={15 * fps}>
      <Title theme="light" />
    </Sequence>
    <Timecode />
  </AbsoluteFill>
);
