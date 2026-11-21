import { Composition } from "remotion";
import { Demo01Find, Demo02Deposit, depositFrames, findFrames } from "./Counter";
import { FPS, HEIGHT, WIDTH } from "./theme";

const size = { fps: FPS, width: WIDTH, height: HEIGHT };

export const RemotionRoot = () => (
  <>
    <Composition id="Demo01" component={Demo01Find} durationInFrames={findFrames} {...size} />
    <Composition id="Demo02" component={Demo02Deposit} durationInFrames={depositFrames} {...size} />
  </>
);
