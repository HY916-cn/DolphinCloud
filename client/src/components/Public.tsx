import { Icon } from './ui';

// 全屏 on the big screens (RateBoard, BigClock): hidden by the stylesheet while full screen (Esc leaves), and not
// drawn where the browser has no full screen.
export function Fullscreen() {
  if (!document.fullscreenEnabled) return null;
  return (
    <button className="dc-btn dc-btn-secondary dc-btn-sm dc-fullscreen" type="button" onClick={() => document.documentElement.requestFullscreen()}>
      <Icon name="fullscreen" />全屏
    </button>
  );
}
