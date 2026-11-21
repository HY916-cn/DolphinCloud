// P3 · 礼堂大屏画面。白底，一屏一件事；每页先进场，再停在最后的画面上，只有海浪继续平移。
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import tellerIcon from "../../../../../design-system/project/assets/Icons/teller.svg";
import studentIcon from "../../../../../design-system/project/assets/Icons/student.svg";
import schoolIcon from "../../../../../design-system/project/assets/Icons/school.svg";
import { fade, font, loadFonts } from "./brand";
import { Card } from "./Card";
import { SHOTS } from "./shots";
import { Waves } from "./Waves";

export const LOOP_SECONDS = 36;
export const THEME = { en: "It all adds up.", zh: "每一笔，都算数。" };
export const LAUNCH = { name: "海豚云", line: "海豚银行的线上平台" };
export const THREE = [
  { zh: "柜台", en: "Counter", icon: tellerIcon },
  { zh: "学生", en: "Students", icon: studentIcon },
  { zh: "银行", en: "Bank", icon: schoolIcon },
];
export const PRINCIPLES = ["账永远对得上", "办理与审批分离", "孩子用得会", "纸质兜底"];

const SHEET_NAMES = ["王小雨", "张小明", "李思远", "陈一诺", "刘子涵", "赵乐乐", "周可欣", "吴天宇", "孙晨曦", "郑嘉怡", "黄子轩", "林小满"];
loadFonts(
  [...Object.values(THEME), ...Object.values(LAUNCH), ...THREE.flatMap((t) => [t.zh, t.en]), ...PRINCIPLES, ...SHEET_NAMES].join("") +
    "日期学号姓名存入取出余额0123456789/",
);

const white = { background: "var(--surface-raised)" };

// Idle screen: the three waves drifting with depth, a seamless loop.
export const StageWaves: React.FC = () => (
  <AbsoluteFill style={white}>
    <Waves scale={4} focusBlur={4} loopSeconds={LOOP_SECONDS} />
  </AbsoluteFill>
);

// Closing screen: waves and the theme, a seamless loop.
export const StageTheme: React.FC = () => (
  <AbsoluteFill style={white}>
    <Waves scale={4} focusBlur={4} loopSeconds={LOOP_SECONDS} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 36, paddingBottom: 160 }}>
      <div style={{ font: `800 190px/1.15 ${font}`, color: "var(--ink)" }}>{THEME.en}</div>
      <div style={{ font: `700 72px/1.3 ${font}`, letterSpacing: "0.12em", color: "var(--ink-muted)" }}>{THEME.zh}</div>
    </AbsoluteFill>
  </AbsoluteFill>
);

// The old spreadsheet: grey, dense, editable by anyone. The camera pushes in, a balance is
// overwritten, then a row is deleted.
const ROWS = 36;
const COLS = [
  { h: "日期", w: 190 },
  { h: "学号", w: 230 },
  { h: "姓名", w: 190 },
  { h: "存入", w: 160 },
  { h: "取出", w: 160 },
  { h: "余额", w: 180 },
];
const sheetRow = (r: number) => {
  const deposit = [10, 5, 20, 0, 2, 15, 0, 50][r % 8];
  const withdraw = [0, 0, 5, 12, 0, 0, 30, 0][r % 8];
  return [
    `11/${String(3 + Math.floor(r / 3)).padStart(2, "0")}`,
    `2026${String(1000 + ((r * 37) % 900)).padStart(4, "0")}`,
    SHEET_NAMES[(r * 5) % SHEET_NAMES.length],
    deposit ? String(deposit) : "",
    withdraw ? String(withdraw) : "",
    String(80 + ((r * 53) % 900)),
  ];
};
const EDIT_ROW = 14;
const DELETE_ROW = 17;
export const SHEET = { push: 300, select: 330, type: 345, delete: 420, deleteGone: 444 };
const grey = "rgba(19, 40, 92, 0.16)";
const smooth = (t: number) => t * t * (3 - 2 * t); // a slow, even push

export const StageSheet: React.FC = () => {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, SHEET.push], [0.8, 1.9], { extrapolateRight: "clamp", easing: smooth });
  const editing = frame >= SHEET.select && frame < SHEET.delete;
  // The balance is cleared and retyped one digit every 5 frames.
  const typed = "1280".slice(0, Math.max(0, Math.floor((frame - SHEET.type) / 5)));
  const gone = fade(frame, SHEET.delete, SHEET.deleteGone - SHEET.delete);
  const rowH = 44;
  return (
    <AbsoluteFill style={{ ...white, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      <div
        style={{
          scale: zoom,
          // Push in toward the edited cell.
          transformOrigin: `${COLS.slice(0, 5).reduce((a, c) => a + c.w, 0) + 90}px ${(EDIT_ROW + 1) * rowH}px`,
          font: `500 24px/1 ${font}`,
          color: "var(--ink-muted)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {Array.from({ length: ROWS + 1 }, (_, r) => {
          const header = r === 0;
          const data = header ? COLS.map((c) => c.h) : sheetRow(r - 1);
          const isDeleted = r - 1 === DELETE_ROW;
          const selectedRow = isDeleted && frame >= SHEET.delete - 24;
          return (
            <div
              key={r}
              style={{
                display: "flex",
                height: isDeleted ? rowH * (1 - gone) : rowH,
                overflow: "hidden",
                background: header ? "rgba(19, 40, 92, 0.05)" : selectedRow ? "rgba(19, 40, 92, 0.1)" : undefined,
              }}
            >
              {data.map((v, c) => {
                const isEdit = !header && r - 1 === EDIT_ROW && c === 5;
                const text = isEdit && frame >= SHEET.type ? typed : v;
                return (
                  <div
                    key={c}
                    style={{
                      width: COLS[c].w,
                      boxSizing: "border-box",
                      padding: "0 14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: c >= 3 ? "flex-end" : "flex-start",
                      borderRight: `1px solid ${grey}`,
                      borderBottom: `1px solid ${grey}`,
                      fontWeight: header ? 700 : 500,
                      outline: isEdit && editing ? "3px solid var(--ink-muted)" : undefined,
                      outlineOffset: -2,
                    }}
                  >
                    {text}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Launch: the idle waves sink, the app icon and name appear, then real screens rise in depth.
export const LAUNCH_AT = { sink: 0, icon: 24, name: 32, line: 44, lift: 150, screens: 160 };
export const StageLaunch: React.FC = () => {
  const frame = useCurrentFrame();
  const lift = fade(frame, LAUNCH_AT.lift, 40);
  const screens = [SHOTS.login, SHOTS.studentHome, SHOTS.counterDeposit];
  return (
    <AbsoluteFill style={white}>
      <Waves scale={4} focusBlur={4} camY={interpolate(fade(frame, LAUNCH_AT.sink, 36), [0, 1], [0, 600])} />
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 28,
          translate: `0 ${interpolate(lift, [0, 1], [0, -300])}px`,
          scale: interpolate(lift, [0, 1], [1, 0.72]),
        }}
      >
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: 240,
            height: 240,
            borderRadius: 60,
            background: "var(--surface-raised)",
            boxShadow: "0 12px 0 var(--line), inset 0 0 0 4px var(--line)",
            opacity: fade(frame, LAUNCH_AT.icon, 12),
            scale: interpolate(fade(frame, LAUNCH_AT.icon, 16), [0, 1], [0.88, 1]),
          }}
        >
          <Img src={staticFile("logo.png")} style={{ width: 200, height: 200 }} />
        </div>
        <div style={{ font: `800 150px/1.1 ${font}`, letterSpacing: "0.08em", color: "var(--ink)", opacity: fade(frame, LAUNCH_AT.name, 14) }}>
          {LAUNCH.name}
        </div>
        <div style={{ font: `700 60px/1.3 ${font}`, letterSpacing: "0.12em", color: "var(--ink-muted)", opacity: fade(frame, LAUNCH_AT.line, 16) }}>
          {LAUNCH.line}
        </div>
      </AbsoluteFill>
      {/* Real screens rise from below, fanned in depth. */}
      <AbsoluteFill style={{ perspective: 2000 }}>
        <div style={{ position: "absolute", left: "50%", top: "70%", transformStyle: "preserve-3d" }}>
          {screens.map((shot, i) => {
            const t = fade(frame, LAUNCH_AT.screens + i * 6, 40);
            const side = i - 1;
            return (
              <Card
                key={shot.src}
                shot={shot}
                x={side * 760}
                y={interpolate(t, [0, 1], [900, 0])}
                z={side === 0 ? 420 : 0}
                rotY={side * -14}
                opacity={t}
              />
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Three things: counter, students, bank, one after another.
export const THREE_GAP = 45;
export const StageThree: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ ...white, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 200 }}>
      {THREE.map((t, i) => {
        const at = 10 + i * THREE_GAP;
        return (
          <div
            key={t.zh}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
              opacity: fade(frame, at, 10),
              translate: `0 ${interpolate(fade(frame, at, 18), [0, 1], [40, 0])}px`,
            }}
          >
            {/* ServiceTile icon block: cloud-100 square, radius-lg, dolphin icon. */}
            <div style={{ display: "grid", placeItems: "center", width: 200, height: 200, borderRadius: "var(--radius-lg)", background: "var(--cloud-100)", marginBottom: 20 }}>
              <Img src={t.icon} style={{ width: 120, height: 120 }} />
            </div>
            <div style={{ font: `800 180px/1.1 ${font}`, letterSpacing: "0.12em", marginRight: "-0.12em", color: "var(--ink)" }}>{t.zh}</div>
            <div style={{ font: `700 52px/1.2 ${font}`, letterSpacing: "0.04em", color: "var(--ink-muted)" }}>{t.en}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// Four principles, line by line; the first, the one the speaker dwells on, in ink.
export const PRINCIPLE_GAP = 24;
export const StagePrinciples: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ ...white, alignItems: "center", justifyContent: "center", gap: 44 }}>
      {PRINCIPLES.map((p, i) => {
        const at = 10 + i * PRINCIPLE_GAP;
        return (
          <div
            key={p}
            style={{
              font: `800 112px/1.2 ${font}`,
              letterSpacing: "0.12em",
              color: i === 0 ? "var(--ink)" : "var(--ink-muted)",
              opacity: fade(frame, at, 10),
              translate: `0 ${interpolate(fade(frame, at, 18), [0, 1], [32, 0])}px`,
            }}
          >
            {p}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
