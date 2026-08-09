// The Bearing wordmark, with the compass needle standing in for the
// letter i. Geometry is not eyeballed - it's derived from real Inter
// (weight 500) canvas.measureText() metrics at a 60px reference size, so
// spacing stays mathematically consistent at any rendered size:
//   "Bear" width 132.51, "i" slot width 15.12, "ng" width 73.27
//   ascent 46, descent 13 (from "g")
// The needle's lowest point is placed exactly on the shared text
// baseline, matching every other letter except "g"'s descender.

const BEAR_W = 132.51;
const I_W = 15.12;
const NG_W = 73.27;
const ASCENT = 46;
const DESCENT = 13;
const TOTAL_W = BEAR_W + I_W + NG_W;
const TOTAL_H = ASCENT + DESCENT;

const NEEDLE_CENTER_X = BEAR_W + I_W / 2;
const NEEDLE_SCALE = 0.639;
const NEEDLE_TRANSLATE_Y = 24;

export default function Logo({ className, height = "1em" }: { className?: string; height?: string }) {
  return (
    <svg
      viewBox={`0 0 ${TOTAL_W} ${TOTAL_H}`}
      height={height}
      width={`${(TOTAL_W / TOTAL_H).toFixed(3)}em`}
      role="img"
      aria-label="Bearing"
      className={className}
    >
      <text x={0} y={ASCENT} fontFamily="var(--font-inter)" fontWeight={500} fontSize={60} fill="currentColor">
        Bear
      </text>
      <text x={BEAR_W + I_W} y={ASCENT} fontFamily="var(--font-inter)" fontWeight={500} fontSize={60} fill="currentColor">
        ng
      </text>
      <g transform={`translate(${NEEDLE_CENTER_X},${NEEDLE_TRANSLATE_Y}) rotate(25) scale(${NEEDLE_SCALE})`}>
        <polygon points="0,-38 9,0 0,38 -9,0" fill="#378ADD" />
      </g>
    </svg>
  );
}
