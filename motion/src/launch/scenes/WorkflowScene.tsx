import type React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { fontMono, ink, stage } from "../theme";
import { fadeUp, TerminalCard } from "../ui";

export const WORKFLOW_DURATION = 280;

/** GitHub-light token colors — the code card is the video's one colorful moment. */
const kw: React.CSSProperties = { color: "#cf222e" };
const fn: React.CSSProperties = { color: "#8250df" };
const str: React.CSSProperties = { color: "#0a3069" };

const CODE: readonly React.ReactNode[] = [
  <>
    <span style={kw}>export const</span> meta = {"{"}
  </>,
  <>
    {"  name: "}
    <span style={str}>"summarize-files"</span>,
  </>,
  <>
    {"  description: "}
    <span style={str}>"Summarize files, then merge the findings"</span>
  </>,
  <>{"}"}</>,
  <> </>,
  <>
    <span style={kw}>const</span> summaries = <span style={kw}>await</span>{" "}
    <span style={fn}>parallel</span>(
  </>,
  <>
    {"  args.files."}
    <span style={fn}>map</span>
    {"((file) => () =>"}
  </>,
  <>
    {"    "}
    <span style={fn}>agent</span>(<span style={str}>{"`Read ${"}</span>file
    <span style={str}>{"} and return three factual bullets.`"}</span>
    {", {"}
  </>,
  <>
    {"      label: "}
    <span style={str}>{"`summarize:${"}</span>file
    <span style={str}>{"}`"}</span>
  </>,
  <>{"    })"}</>,
  <>{"  )"}</>,
  <>{")"}</>,
  <> </>,
  <>
    <span style={kw}>const</span> usable = summaries.
    <span style={fn}>filter</span>(Boolean)
  </>,
  <> </>,
  <>
    <span style={kw}>return await</span> <span style={fn}>agent</span>(
    <span style={str}>{"`Synthesize:\\n${"}</span>JSON.
    <span style={fn}>stringify</span>(usable)
    <span style={str}>{"}`"}</span>)
  </>,
];

const LINES_AT = 16;
const LINE_STEP = 6;

export const WorkflowScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: stage }}>
      <div style={{ position: "absolute", inset: 0, ...fadeUp(frame, 0, 18) }}>
        <TerminalCard
          style={{ left: 340, right: 340, top: 110, bottom: 110 }}
          title=".codex/workflows/summarize-files.js"
        >
          <div style={{ padding: "36px 56px" }}>
            {CODE.map((codeLine, i) => (
              <div
                key={`line-${i}`}
                style={{
                  fontFamily: fontMono,
                  fontSize: 25,
                  lineHeight: 1.65,
                  whiteSpace: "pre",
                  color: ink,
                  minHeight: 41,
                  ...fadeUp(frame, LINES_AT + i * LINE_STEP, 10),
                }}
              >
                {codeLine}
              </div>
            ))}
          </div>
        </TerminalCard>
      </div>
    </AbsoluteFill>
  );
};
