import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { fontMono, fontSans, ink, ink2, stage } from "../theme";
import { fadeUp } from "../ui";

export const NAME_DURATION = 150;

export const NameCard: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: stage,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          fontFamily: fontMono,
          fontWeight: 600,
          fontSize: 118,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          color: ink,
          ...fadeUp(frame, 10, 16),
        }}
      >
        gpt-workflow
      </div>
      <div
        style={{
          marginTop: 56,
          fontFamily: fontSans,
          fontSize: 42,
          color: ink2,
          ...fadeUp(frame, 46),
        }}
      >
        Orchestrate subagents at scale with dynamic workflows
      </div>
    </AbsoluteFill>
  );
};
