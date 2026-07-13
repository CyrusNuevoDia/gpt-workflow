import type React from "react";
import { useCurrentFrame } from "remotion";
import { fontMono, fontSans, green, ink, ink2, ink3, ink4 } from "../theme";
import { fadeUp, SceneFade } from "../ui";

export const MIGRATE_DURATION = 230;

export const Migrate: React.FC = () => {
  const frame = useCurrentFrame();

  const diffLine: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 36,
    lineHeight: 1.75,
    whiteSpace: "pre",
  };

  return (
    <SceneFade duration={MIGRATE_DURATION}>
      <div style={{ position: "absolute", left: 220, top: 190 }}>
        <div
          style={{
            fontFamily: fontMono,
            fontWeight: 600,
            fontSize: 28,
            letterSpacing: "0.14em",
            color: ink3,
            ...fadeUp(frame, 8),
          }}
        >
          COMPATIBILITY
        </div>

        <div
          style={{
            marginTop: 44,
            fontFamily: fontSans,
            fontSize: 42,
            color: ink,
            ...fadeUp(frame, 26),
          }}
        >
          already writing claude workflows?
        </div>

        <div style={{ marginTop: 52 }}>
          <div style={{ ...diffLine, color: ink4, ...fadeUp(frame, 72, 10) }}>
            {'-   agent(prompt, { model: "opus" })'}
          </div>
          <div
            style={{
              ...diffLine,
              color: green,
              fontWeight: 600,
              ...fadeUp(frame, 92, 10),
            }}
          >
            {'+   agent(prompt, { model: "gpt-5.6-sol" })'}
          </div>
        </div>

        <div
          style={{
            marginTop: 56,
            maxWidth: 1350,
            fontFamily: fontSans,
            fontSize: 34,
            lineHeight: 1.5,
            color: ink2,
            ...fadeUp(frame, 140),
          }}
        >
          meta, parallel, pipeline, workflow, args, budget — the surface carries
          over.
        </div>
        <div
          style={{
            marginTop: 24,
            fontFamily: fontMono,
            fontSize: 28,
            color: ink3,
            ...fadeUp(frame, 168),
          }}
        >
          parity ledger + migration checklist in the docs
        </div>
      </div>
    </SceneFade>
  );
};
