import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { fontMono, fontSans, green, ink, ink2, ink3 } from "../theme";
import { Cursor, fadeUp, SceneFade } from "../ui";

export const OUTRO_DURATION = 240;

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <SceneFade duration={OUTRO_DURATION} out={false}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 36,
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 124,
            lineHeight: 1,
            color: ink,
            ...fadeUp(frame, 8, 18),
          }}
        >
          <span style={{ color: green }}>❯</span>
          <span>
            gpt-workflow <Cursor />
          </span>
        </div>
        <div
          style={{
            marginTop: 52,
            fontFamily: fontSans,
            fontSize: 42,
            color: ink2,
            ...fadeUp(frame, 46),
          }}
        >
          claude code's Workflow tool, for codex.
        </div>
        <div
          style={{
            marginTop: 64,
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 36,
            lineHeight: 1.9,
            color: green,
            textAlign: "left",
            ...fadeUp(frame, 84),
          }}
        >
          <div>❯ codex plugin marketplace add CyrusNuevoDia/gpt-workflow</div>
          <div>❯ codex plugin add gpt-workflow@gpt-workflow</div>
        </div>
        <div
          style={{
            marginTop: 40,
            fontFamily: fontMono,
            fontSize: 27,
            color: ink3,
            ...fadeUp(frame, 132),
          }}
        >
          or: bun add -g gpt-workflow
        </div>
      </AbsoluteFill>
    </SceneFade>
  );
};
