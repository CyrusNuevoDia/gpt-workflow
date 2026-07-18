import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { flash, fontMono, ink, ink3, ink4, stage } from "../theme";
import { clamp, fadeUp, TerminalCard, useTyped } from "../ui";

export const RUN_DURATION = 470;

const CMD_1 = "gpt-workflow run --default-model gpt-5.6-luna \\";
const CMD_2 = "    .codex/workflows/summarize-files.js | tee run.jsonl";

const RECORDS: readonly string[] = [
  '{"sequence":0,"type":"run.started","runId":"workflow-4f21","schemaVersion":1, …}',
  '{"sequence":1,"type":"agent.event","runId":"workflow-4f21","threadId":"th_0a92", …}',
  '{"sequence":2,"type":"agent.event","runId":"workflow-4f21","threadId":"th_77c4", …}',
  '{"sequence":3,"type":"agent.event","runId":"workflow-4f21","threadId":"th_b3e8", …}',
  '{"sequence":4,"type":"agent.event","runId":"workflow-4f21","threadId":"th_0a92", …}',
  '{"sequence":5,"type":"agent.event","runId":"workflow-4f21","threadId":"th_d155", …}',
];

const RESUME_1 = "gpt-workflow run --default-model gpt-5.6-luna \\";
const RESUME_2 =
  "    --resume workflow-4f21 .codex/workflows/summarize-files.js";

const CMD2_AT = 50;
const STREAM_AT = 96;
const STREAM_STEP = 6;
const INTERRUPT_AT = 158;
const RESUME_AT = 214;
const RESUME2_AT = 252;
const COMPLETED_AT = 312;
const FLASH_AT = 344;
const CAPTION_AT = 368;

export const RunScene: React.FC = () => {
  const frame = useCurrentFrame();
  const typed1 = useTyped(CMD_1, 14, 44);
  const typed2 = useTyped(CMD_2, CMD2_AT, 44);
  const typedResume1 = useTyped(RESUME_1, RESUME_AT, 44);
  const typedResume2 = useTyped(RESUME_2, RESUME2_AT, 44);
  const flashP = interpolate(frame, [FLASH_AT, FLASH_AT + 14], [0, 1], clamp);
  const pushIn = interpolate(frame, [40, RUN_DURATION - 10], [1, 1.05], clamp);
  const dim =
    interpolate(frame, [162, 176], [1, 0.9], clamp) +
    interpolate(frame, [200, 212], [0, 0.1], clamp);

  const cmd: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 27,
    lineHeight: 1.7,
    whiteSpace: "pre",
    color: ink,
  };
  const record: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 22,
    lineHeight: 1.62,
    whiteSpace: "pre",
    color: ink3,
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backgroundColor: stage,
        transform: `scale(${pushIn})`,
        transformOrigin: "50% 45%",
      }}
    >
      <div style={{ position: "absolute", inset: 0, ...fadeUp(frame, 0, 18) }}>
        <TerminalCard
          style={{ top: 120, bottom: 120, opacity: dim }}
          title="~/repo — zsh"
        >
          <div style={{ padding: "34px 48px" }}>
            <div style={cmd}>
              <span style={{ color: ink4 }}>{"$ "}</span>
              {typed1}
            </div>
            <div style={cmd}>{typed2}</div>
            <div style={{ marginTop: 18 }}>
              {RECORDS.map((rec, i) => (
                <div
                  key={rec}
                  style={{
                    ...record,
                    ...fadeUp(frame, STREAM_AT + i * STREAM_STEP, 8),
                  }}
                >
                  {rec}
                </div>
              ))}
            </div>
            <div
              style={{
                ...cmd,
                marginTop: 18,
                fontWeight: 600,
                ...fadeUp(frame, INTERRUPT_AT, 8),
              }}
            >
              ^C
            </div>

            <div style={{ ...cmd, marginTop: 36 }}>
              <span style={{ color: ink4 }}>
                {frame >= RESUME_AT ? "$ " : ""}
              </span>
              {typedResume1}
            </div>
            <div style={cmd}>{typedResume2}</div>

            <div style={{ marginTop: 20 }}>
              <div style={{ ...record, ...fadeUp(frame, COMPLETED_AT, 10) }}>
                {'{"type":"run.completed","usage":{'}
                <span
                  style={{
                    color: ink,
                    fontWeight: 600,
                    backgroundColor: flashP > 0 ? flash : undefined,
                    opacity: 0.45 + flashP * 0.55,
                  }}
                >
                  {'"replayedAgentCount":38,"liveAgentCount":12'}
                </span>
                {", …},"}
              </div>
              <div
                style={{ ...record, ...fadeUp(frame, COMPLETED_AT + 10, 10) }}
              >
                {'  "runId":"workflow-4f21","sequence":112, …}'}
              </div>
            </div>

            <div
              style={{
                ...cmd,
                marginTop: 24,
                ...fadeUp(frame, CAPTION_AT, 12),
              }}
            >
              <span style={{ fontWeight: 600 }}>{"✓ "}</span>
              38 replayed from the journal — tokens spent on 12, not 50
            </div>
          </div>
        </TerminalCard>
      </div>
    </div>
  );
};
