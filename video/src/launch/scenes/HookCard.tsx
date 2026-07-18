import type React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { fontSans, ink, stage } from "../theme";
import { clamp, WordReveal } from "../ui";

export const HOOK_DURATION = 180;

const LINE2_AT = 84;

export const HookCard: React.FC = () => {
  const frame = useCurrentFrame();
  const line1Dim = interpolate(
    frame,
    [LINE2_AT - 2, LINE2_AT + 14],
    [1, 0.3],
    clamp,
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: stage,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 200px",
      }}
    >
      <div
        style={{
          fontFamily: fontSans,
          fontWeight: 600,
          fontSize: 82,
          lineHeight: 1.22,
          letterSpacing: "-0.02em",
          color: ink,
          textAlign: "center",
          textWrap: "balance",
          maxWidth: 1480,
        }}
      >
        <div style={{ opacity: line1Dim }}>
          <WordReveal
            start={10}
            text="Multi-agent workflows are the highest-leverage way to spend tokens."
          />
        </div>
        <div style={{ marginTop: 44 }}>
          <WordReveal
            start={LINE2_AT}
            text="gpt-5.6 is the best place to spend them."
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
