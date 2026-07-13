import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import {
  card,
  fontMono,
  green,
  greenDim,
  ink,
  ink2,
  ink3,
  ink4,
  line2,
  rule,
} from "../theme";
import { clamp, fadeUp, SceneFade } from "../ui";

export const STREAM_DURATION = 560;

const RUN_CMD = [
  "gpt-workflow run --default-model gpt-5.6-sol \\",
  "    .codex/workflows/review-sweep.js | tee run.jsonl",
];

const RECORDS: readonly string[] = [
  '{"sequence":0,"type":"run.started","runId":"workflow-4f21","schemaVersion":1, …}',
  '{"sequence":1,"type":"agent.event","runId":"workflow-4f21","threadId":"th_0a92", …}',
  '{"sequence":2,"type":"agent.event","runId":"workflow-4f21","threadId":"th_77c4", …}',
  '{"sequence":3,"type":"agent.event","runId":"workflow-4f21","threadId":"th_b3e8", …}',
  '{"sequence":4,"type":"agent.event","runId":"workflow-4f21","threadId":"th_0a92", …}',
  '{"sequence":5,"type":"agent.event","runId":"workflow-4f21","threadId":"th_d155", …}',
  '{"sequence":6,"type":"agent.event","runId":"workflow-4f21","threadId":"th_29af", …}',
  '{"sequence":7,"type":"agent.event","runId":"workflow-4f21","threadId":"th_77c4", …}',
  '{"sequence":8,"type":"agent.event","runId":"workflow-4f21","threadId":"th_b3e8", …}',
];

const RESUME_CMD = [
  "gpt-workflow run --default-model gpt-5.6-sol \\",
  "    --resume workflow-4f21 .codex/workflows/review-sweep.js",
];

const STREAM_AT = 64;
const STREAM_STEP = 6;
const CAPTION_AT = 156;
const INTERRUPT_AT = 220;
const PHASE_OUT = [264, 284] as const;
const RESUME_AT = 296;
const COMPLETED_AT = 352;
const FLASH_AT = 404;
const PUNCH_AT = 438;

export const Stream: React.FC = () => {
  const frame = useCurrentFrame();
  const phaseA = interpolate(frame, [...PHASE_OUT], [1, 0], clamp);
  const flash = interpolate(frame, [FLASH_AT, FLASH_AT + 14], [0, 1], clamp);

  const cmd: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 28,
    lineHeight: 1.7,
    whiteSpace: "pre",
    color: ink2,
  };
  const record: React.CSSProperties = {
    fontFamily: fontMono,
    fontSize: 23,
    lineHeight: 1.62,
    whiteSpace: "pre",
    color: ink3,
  };

  return (
    <SceneFade duration={STREAM_DURATION}>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 128,
          fontFamily: fontMono,
          fontWeight: 600,
          fontSize: 28,
          letterSpacing: "0.14em",
          color: ink3,
          ...fadeUp(frame, 4),
        }}
      >
        EXAMPLES
      </div>

      <div
        style={{
          position: "absolute",
          left: 140,
          right: 140,
          top: 186,
          bottom: 148,
          backgroundColor: card,
          border: `1px solid ${line2}`,
          borderRadius: 12,
          overflow: "hidden",
          ...fadeUp(frame, 8, 14),
        }}
      >
        <div
          style={{
            padding: "18px 40px",
            borderBottom: `1px solid ${rule}`,
            fontFamily: fontMono,
            fontSize: 24,
            color: ink3,
          }}
        >
          ~/repo — zsh
        </div>

        <div style={{ padding: "32px 48px", position: "relative" }}>
          <div style={{ opacity: phaseA }}>
            {RUN_CMD.map((l, i) => (
              <div
                key={l}
                style={{ ...cmd, ...fadeUp(frame, 20 + i * 12, 10) }}
              >
                {i === 0 ? <span style={{ color: ink4 }}>{"$ "}</span> : "  "}
                {l}
              </div>
            ))}
            <div style={{ marginTop: 18 }}>
              {RECORDS.map((l, i) => (
                <div
                  key={l}
                  style={{
                    ...record,
                    ...fadeUp(frame, STREAM_AT + i * STREAM_STEP, 8),
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
            <div
              style={{
                ...cmd,
                marginTop: 22,
                color: ink,
                ...fadeUp(frame, CAPTION_AT, 12),
              }}
            >
              <span style={{ color: green, fontWeight: 600 }}>{"✓ "}</span>
              ordered ndjson — every record carries sequence + runId
            </div>
            <div
              style={{
                ...cmd,
                marginTop: 20,
                color: ink,
                fontWeight: 600,
                ...fadeUp(frame, INTERRUPT_AT, 8),
              }}
            >
              ^C
            </div>
          </div>

          <div style={{ position: "absolute", top: 32, left: 48, right: 48 }}>
            {RESUME_CMD.map((l, i) => (
              <div
                key={l}
                style={{ ...cmd, ...fadeUp(frame, RESUME_AT + i * 12, 10) }}
              >
                {i === 0 ? <span style={{ color: ink4 }}>{"$ "}</span> : "  "}
                {l}
              </div>
            ))}
            <div style={{ marginTop: 20 }}>
              <div style={{ ...record, ...fadeUp(frame, COMPLETED_AT, 10) }}>
                {'{"type":"run.completed","usage":{'}
                <span
                  style={{
                    color: green,
                    fontWeight: 600,
                    backgroundColor: flash > 0 ? greenDim : undefined,
                    opacity: 0.4 + flash * 0.6,
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
                marginTop: 26,
                color: ink,
                ...fadeUp(frame, PUNCH_AT, 12),
              }}
            >
              <span style={{ color: green, fontWeight: 600 }}>{"✓ "}</span>
              38 calls replayed from the journal — tokens spent on 12, not 50
            </div>
          </div>
        </div>
      </div>
    </SceneFade>
  );
};
