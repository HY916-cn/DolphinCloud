// 演示 1 · 找人 and 演示 2 · 存款 (SCRIPT.md §三), from one take on the counter (captures/counter.*).
// 1: the iPad turns to face us, the camera pushes in to the search ("wxy" finds 王小雨), her card lifts out.
// 2: her card, the four face cards and the 办理单 float as three layers while the teller taps the notes; the
//    subtotals, the total and the rolling balance are called out; the stopwatch runs from the first key to the booking.
import capture from "../captures/counter.json";
import { Callout, Ipad, Layer, marker, Scene, Touches, useLift, useT, type Capture, type Rect, type Screen } from "./stage";
import { useFonts } from "./theme";
import { Timer } from "./Timer";

const c = capture as Capture;
const screen: Screen = { width: c.width, height: c.height, scale: 2.1 };
const t = (label: string, nth = 0) => marker(c, label, nth).t;
const rects = (label: string) => marker(c, label).rects!;
const TEXT = "拼音首字母即可查找班级、学号、余额、信用分小计随张数变化合计自动算出余额由滚动到新值秒";

const P = rects("rects:person");
const search = rects("rects:search").search;
// The 2 × 2 face cards, from the grid's box (1 元, 2 元 / 5 元, 10 元).
const face = (i: number): Rect => ({ x: P.faces.x + (i % 2) * (P.face10.x - P.face5.x), y: P.faces.y + Math.floor(i / 2) * (P.face5.y - P.faces.y), width: P.face5.width, height: P.face5.height });
// The 办理单 grows with each step: one line while empty, the deposit being entered, then the booked deposit.
const receiptAt = (now: number): Rect => (now < t("face10") + 50 ? P.receipt : now < t("done") ? rects("rects:total").receipt : rects("rects:done").receipt);

export const FIND_FROM = 0;
export const findFrames = Math.round(((t("deposit") - 100 - FIND_FROM) / 1000) * 30);
export const DEPOSIT_FROM = t("deposit") - 1700; // the layers are up before the first note
export const depositFrames = Math.round(((c.durationMs - DEPOSIT_FROM) / 1000) * 30);

const take = (from: number) => ({ src: "counter.mp4", capture: c, screen, from });

// Her card lifting out (inside the Scene, which knows the time).
const FindLayers = () => {
  const lift = useLift(t("rects:person") + 100);
  return (
    <>
      <Ipad dim={lift}>
        <Touches />
      </Ipad>
      <Callout rect={search} at={t("rects:hit") + 150} until={t("student") - 100} text="拼音首字母即可查找" side="top" />
      <Layer rect={P.person} lift={lift} z={240} />
      <Callout rect={P.person} at={t("rects:person") + 1200} text="班级、学号、余额、信用分" side="bottom" z={240} pad={10} />
    </>
  );
};

export const Demo01Find = () => {
  useFonts(TEXT);
  return (
    <Scene
      take={take(FIND_FROM)}
      start={{ x: 590, y: 410, zoom: 0.92, rx: 10, ry: -14 }}
      shots={[
        { at: 200, ms: 3600, x: 590, y: 410, zoom: 1, rx: 0, ry: 0 },
        { at: t("search") - 600, ms: 2100, x: 590, y: 210, zoom: 1.4, rx: 0, ry: 0 },
        { at: t("person") + 200, ms: 2700, x: 590, y: 330, zoom: 1.2, rx: 6, ry: -9 },
        { at: t("person") + 2900, ms: 3600, x: 590, y: 320, zoom: 1.24, rx: 4, ry: -6 },
      ]}
      overlay={<Timer start={t("start")} stop={t("done")} />}
    >
      <FindLayers />
    </Scene>
  );
};

const Layers = () => {
  const now = useT();
  const lift = (i: number) => useLift(DEPOSIT_FROM + 150 + i * 40);
  const faces = [0, 1, 2, 3].map((i) => ({ rect: face(i), lift: lift(i + 1), z: 190 + (i % 2) * 20 }));
  const receipt = { rect: receiptAt(now), lift: lift(5), z: 300 };
  return (
    <>
      <Layer rect={P.person} lift={1} z={240} />
      {faces.map((f, i) => (
        <Layer key={i} {...f} />
      ))}
      <Layer {...receipt} />
      {faces.map((f, i) => (
        <Touches key={i} rect={f.rect} z={f.z} lift={f.lift} />
      ))}
    </>
  );
};

export const Demo02Deposit = () => {
  useFonts(TEXT);
  const total = rects("rects:total");
  const done = rects("rects:done");
  return (
    <Scene
      take={take(DEPOSIT_FROM)}
      start={{ x: 590, y: 320, zoom: 1.24, rx: 4, ry: -6 }}
      shots={[
        { at: DEPOSIT_FROM + 100, ms: 3300, x: 590, y: 470, zoom: 1.22, rx: 5, ry: -7 },
        { at: t("confirm") - 1300, ms: 2200, x: 590, y: 330, zoom: 1.24, rx: 4, ry: -5 },
        { at: t("done") + 1400, ms: 4000, x: 590, y: 380, zoom: 1.12, rx: 5, ry: -8 },
      ]}
      overlay={<Timer start={t("start")} stop={t("done")} show={DEPOSIT_FROM - 1000} />}
    >
      <Ipad dim={1}>
        <Touches />
      </Ipad>
      <Layers />
      <Callout rect={total.face10} at={t("face10") + 200} until={t("rects:total")} text="小计随张数变化" side="bottom" z={210} />
      <Callout rect={total.receipt} at={t("rects:total") + 100} until={t("confirm") - 100} text="合计自动算出" side="top" z={300} />
      <Callout rect={{ ...done.balance, x: done.balance.x - 12, width: done.balance.width + 24 }} at={t("done") + 650} text="余额滚动到新值" side="bottom" z={240} />
    </Scene>
  );
};
