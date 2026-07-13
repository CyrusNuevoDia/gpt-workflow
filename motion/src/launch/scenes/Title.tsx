import type React from "react";
import { useCurrentFrame } from "remotion";
import { fontMono, ink, ink2 } from "../theme";
import { fadeUp, SceneFade } from "../ui";

export const TITLE_DURATION = 220;

export const Title: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFade duration={TITLE_DURATION}>
      <div style={{ position: "absolute", left: 220, top: 236 }}>
        <div
          style={{
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 30,
            letterSpacing: "0.14em",
            color: ink,
            ...fadeUp(frame, 8),
          }}
        >
          NAME
        </div>
        <div
          style={{
            marginTop: 44,
            maxWidth: 1450,
            fontFamily: fontMono,
            fontSize: 42,
            lineHeight: 1.6,
            color: ink,
            whiteSpace: "nowrap",
            ...fadeUp(frame, 26),
          }}
        >
          <span style={{ fontWeight: 600 }}>gpt-workflow</span> — claude code's
          Workflow tool, for codex
        </div>
        <div
          style={{
            marginTop: 36,
            maxWidth: 1300,
            fontFamily: fontMono,
            fontSize: 36,
            lineHeight: 1.7,
            color: ink2,
            ...fadeUp(frame, 58),
          }}
        >
          control flow is plain javascript. agent() is the only place a model
          enters.
        </div>
      </div>
    </SceneFade>
  );
};
