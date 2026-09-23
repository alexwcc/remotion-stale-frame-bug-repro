import React from "react";
import {
  AbsoluteFill,
  Easing,
  Interactive,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Repro: which dynamic style patterns survive `remotion render`?
// Band A: Interactive.Div > child span, scale: interpolate()
// Band B: plain div > child span, scale: plain-math smoothstep
// Band C: plain div > child circle divs, scale: plain math + translate string
// Band D: Interactive.Div with scale: spring() ON ITSELF (child plain text)

const smoothstep = (frame: number, start: number, dur: number) => {
  const t = Math.max(0, Math.min(1, (frame - start) / dur));
  return t * t * (3 - 2 * t);
};

export const Repro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <Interactive.Div
        name="Band A"
        style={{
          position: "absolute",
          top: 0,
          left: 200,
          height: 270,
          display: "flex",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "sans-serif",
            fontSize: 150,
            color: "#FFFFFF",
            display: "inline-block",
            transform: `scale(${interpolate(frame, [2, 18], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.34, 1.56, 0.64, 1),
              output: "perceptual-scale",
            })})`,
          }}
        >
          AAAAA
        </span>
      </Interactive.Div>

      <div
        style={{
          position: "absolute",
          top: 270,
          left: 200,
          height: 270,
          display: "flex",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: "sans-serif",
            fontSize: 150,
            color: "#FFFFFF",
            display: "inline-block",
            transform: `scale(${smoothstep(frame, 2, 16)})`,
          }}
        >
          BBBBB
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          top: 540,
          left: 200,
          height: 270,
          display: "flex",
          alignItems: "center",
          gap: 30,
        }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            style={{
              width: 150,
              height: 150,
              borderRadius: 75,
              backgroundColor: "#FFFFFF",
              transform: `scale(${smoothstep(frame, 2 + i * 4, 14)})`,
              translate: `0px ${Math.sin((frame + i * 17) / 11) * 7}px`,
            }}
          />
        ))}
      </div>

      <Interactive.Div
        name="Band D"
        style={{
          position: "absolute",
          top: 810,
          left: 200,
          height: 270,
          display: "flex",
          alignItems: "center",
          transform: `scale(${spring({
            frame: frame - 2,
            fps,
            config: { damping: 10 },
            from: 0,
            to: 1,
            durationInFrames: 16,
          })})`,
        }}
      >
        <span
          style={{
            fontFamily: "sans-serif",
            fontSize: 150,
            color: "#FFFFFF",
          }}
        >
          DDDDD
        </span>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
