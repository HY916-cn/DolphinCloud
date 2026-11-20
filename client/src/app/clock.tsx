import { useEffect, useRef, useState } from 'react';
import { Fullscreen, Icon } from '@/components';
import { clockFace, clockOffset, type Sample } from '@/lib/public';
import { call } from '@/lib/rpc';

// One calibration: 5 calls to server_time() in a row; the offset of the shortest round trip, null when none answered.
async function calibrate() {
  const samples: Sample[] = [];
  for (let i = 0; i < 5; i++) {
    const sent = Date.now();
    try {
      const server = await call<number>('server_time', {});
      samples.push({ sent, received: Date.now(), server: Number(server) });
    } catch {
      // A failed call only leaves fewer samples.
    }
  }
  return clockOffset(samples);
}

// 大屏时间 (/clock, design system BigClock): Shanghai time to the second by the server's clock, no sign-in. The local
// clock plus the offset, redrawn on each whole second; recalibrated every 10 minutes, a failure keeping the last offset.
export default function Clock() {
  const offset = useRef(0);
  const [calibrated, setCalibrated] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    document.title = '大屏时间';
    let alive = true;
    const run = async () => {
      const o = await calibrate();
      if (!alive) return;
      if (o != null) offset.current = o;
      setCalibrated(o != null);
    };
    run();
    const every = setInterval(run, 600_000);
    let tick: ReturnType<typeof setTimeout>;
    const step = () => {
      const t = Date.now() + offset.current;
      setNow(t);
      tick = setTimeout(step, 1000 - (t % 1000));
    };
    step();
    return () => { alive = false; clearInterval(every); clearTimeout(tick); };
  }, []);

  const face = clockFace(now);
  return (
    <div className="dc-clock">
      <div className="dc-clock-body">
        <p className="dc-clock-date">{face.date}</p>
        <p className="dc-clock-time">{face.time}</p>
        <div className="dc-clock-foot">
          <Fullscreen />
          {!calibrated && <span><Icon name="warning" />未校准</span>}
        </div>
      </div>
    </div>
  );
}
