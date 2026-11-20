import { Composition, Folder } from "remotion";
import { Title } from "./Title";

// Layout is 1920×1080; remotion.config.ts renders at 2× (3840×2160).
const video = { fps: 30, width: 1920, height: 1080 };

export const RemotionRoot: React.FC = () => (
  <Folder name="P2">
    <Composition id="P2-Title" component={Title} durationInFrames={450} {...video} />
  </Folder>
);
