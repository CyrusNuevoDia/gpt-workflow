import type React from "react";
import { AbsoluteFill } from "remotion";
import { fontSans, ink, stage } from "../theme";
import { WordReveal } from "../ui";

export const PUNCH_DURATION = 120;

export const PunchCard: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: stage,
        justifyContent: "center",
        alignItems: "center",
        padding: "0 240px",
      }}
    >
      <div
        style={{
          fontFamily: fontSans,
          fontWeight: 600,
          fontSize: 80,
          lineHeight: 1.22,
          letterSpacing: "-0.02em",
          color: ink,
          textAlign: "center",
          textWrap: "balance",
          maxWidth: 1400,
        }}
      >
        <WordReveal
          stagger={2.2}
          start={6}
          text="Workflows you used to ration, you just run."
        />
      </div>
    </AbsoluteFill>
  );
};
