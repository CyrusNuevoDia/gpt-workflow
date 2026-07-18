import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { fontMono, fontSans, ink, ink2, ink4, stage } from "../theme";
import { clamp, easeOut, fadeUp } from "../ui";

export const OUTRO_DURATION = 260;

const SHIFT_AT = 96;

export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const shift = interpolate(frame, [SHIFT_AT, SHIFT_AT + 18], [0, 1], {
    ...clamp,
    easing: easeOut,
  });

  const diffLine: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 32,
    lineHeight: 1.7,
    whiteSpace: "pre",
  };

  return (
    <AbsoluteFill style={{ backgroundColor: stage }}>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          transform: `translateY(${-300 * shift}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fontSans,
            fontSize: 40,
            color: ink2,
            ...fadeUp(frame, 10),
            opacity: Math.min(1 - shift, fadeUp(frame, 10).opacity as number),
          }}
        >
          Already writing Claude workflows?
        </div>
        <div style={{ marginTop: 44, opacity: 1 - shift * 0.65 }}>
          <div style={{ ...diffLine, color: ink4, ...fadeUp(frame, 34, 10) }}>
            {'-   agent(prompt, { model: "opus" })'}
          </div>
          <div
            style={{
              ...diffLine,
              color: ink,
              fontWeight: 600,
              ...fadeUp(frame, 52, 6),
            }}
          >
            {'+   agent(prompt, { model: "gpt-5.6-sol" })'}
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          paddingTop: 80,
        }}
      >
        <div
          style={{
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 104,
            lineHeight: 1,
            color: ink,
            ...fadeUp(frame, SHIFT_AT + 14, 16),
          }}
        >
          gpt-workflow
        </div>
        <div
          style={{
            marginTop: 64,
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 30,
            lineHeight: 2.05,
            color: ink,
            textAlign: "left",
            ...fadeUp(frame, 150),
          }}
        >
          <div>❯ codex plugin marketplace add CyrusNuevoDia/gpt-workflow</div>
          <div>❯ codex plugin add gpt-workflow@gpt-workflow</div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
