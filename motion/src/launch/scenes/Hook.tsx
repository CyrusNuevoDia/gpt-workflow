import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { fontSans, ink, ink2 } from "../theme";
import { fadeUp, SceneFade } from "../ui";

export const HOOK_DURATION = 190;

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFade duration={HOOK_DURATION}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ maxWidth: 1400, textAlign: "center" }}>
          <div
            style={{
              fontFamily: fontSans,
              fontWeight: 600,
              fontSize: 56,
              lineHeight: 1.25,
              color: ink,
              ...fadeUp(frame, 12, 18),
            }}
          >
            multi-agent workflows are the highest-leverage way to spend tokens.
          </div>
          <div
            style={{
              marginTop: 40,
              fontFamily: fontSans,
              fontSize: 48,
              color: ink2,
              ...fadeUp(frame, 70, 18),
            }}
          >
            gpt-5.6 is the best place to spend them.
          </div>
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
