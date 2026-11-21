import { Composition, Folder } from "remotion";
import { Chapter, CHAPTERS, EndCredit, LowerThird, PEOPLE, Subtitle, SUBTITLES } from "./Captions";
import { Design, DESIGN } from "./Design";
import { Numbers, PAGE_FRAMES, PAGES } from "./Numbers";
import { LOOP_SECONDS, StageLaunch, StagePrinciples, StageSheet, StageThree, StageTheme, StageWaves } from "./Stage";
import { Title } from "./Title";
import { Wall, WALL } from "./Wall";

// Layout is 1920×1080; remotion.config.ts renders at 2× (3840×2160).
const video = { fps: 30, width: 1920, height: 1080 };
const STAGE = 60 * 30;

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="P1">
      <Composition id="P1-Sub-Small" component={Subtitle} durationInFrames={120} defaultProps={{ text: SUBTITLES.small }} {...video} />
      <Composition id="P1-Sub-Counts" component={Subtitle} durationInFrames={120} defaultProps={{ text: SUBTITLES.counts }} {...video} />
      <Composition id="P1-Chapter-Counter" component={Chapter} durationInFrames={90} defaultProps={CHAPTERS.counter} {...video} />
      <Composition id="P1-Chapter-Students" component={Chapter} durationInFrames={90} defaultProps={CHAPTERS.students} {...video} />
      <Composition id="P1-Chapter-Bank" component={Chapter} durationInFrames={90} defaultProps={CHAPTERS.bank} {...video} />
      <Composition id="P1-Name-Teller" component={LowerThird} durationInFrames={150} defaultProps={PEOPLE.teller} {...video} />
      <Composition id="P1-Name-President" component={LowerThird} durationInFrames={150} defaultProps={PEOPLE.president} {...video} />
      <Composition id="P1-Name-Admin" component={LowerThird} durationInFrames={150} defaultProps={PEOPLE.admin} {...video} />
      <Composition id="P1-EndCredit" component={EndCredit} durationInFrames={90} {...video} />
    </Folder>
    <Folder name="P2">
      <Composition id="P2-Title-Light" component={Title} durationInFrames={450} defaultProps={{ theme: "light" as const }} {...video} />
      <Composition id="P2-Title-Dark" component={Title} durationInFrames={450} defaultProps={{ theme: "dark" as const }} {...video} />
    </Folder>
    <Folder name="P3">
      {/* Stage pages: seamless loops, or an entrance followed by a one-minute hold. */}
      <Composition id="P3-Waves" component={StageWaves} durationInFrames={LOOP_SECONDS * 30} {...video} />
      <Composition id="P3-Theme" component={StageTheme} durationInFrames={LOOP_SECONDS * 30} {...video} />
      <Composition id="P3-Sheet" component={StageSheet} durationInFrames={STAGE} {...video} />
      <Composition id="P3-Launch" component={StageLaunch} durationInFrames={STAGE} {...video} />
      <Composition id="P3-Three" component={StageThree} durationInFrames={STAGE} {...video} />
      <Composition id="P3-Principles" component={StagePrinciples} durationInFrames={STAGE} {...video} />
      <Composition id="P3-Numbers" component={Numbers} durationInFrames={STAGE} {...video} />
    </Folder>
    <Folder name="P5">
      <Composition id="P5-Design" component={Design} durationInFrames={DESIGN.end} {...video} />
    </Folder>
    <Folder name="P10">
      <Composition id="P10-Numbers" component={Numbers} durationInFrames={PAGES.length * PAGE_FRAMES + 60} {...video} />
    </Folder>
    <Folder name="P14">
      <Composition id="P14-Wall" component={Wall} durationInFrames={WALL.frames} {...video} />
    </Folder>
  </>
);
