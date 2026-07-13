import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import {
  card,
  fontMono,
  fontSans,
  green,
  ink,
  ink2,
  ink3,
  line2,
  rule,
} from "../theme";
import { clamp, fadeUp, SceneFade } from "../ui";

export const SYNOPSIS_DURATION = 480;

const CODE: readonly string[] = [
  "const verdicts = await parallel(",
  "  findings.map((f) => () =>",
  "    agent(`Refute or confirm: ${f.title}`, {",
  "      schema: VERDICT",
  "    })",
  "  )",
  ")",
  "",
  "return verdicts.filter(Boolean)",
];

const CODE_START = 20;
const CODE_STEP = 12;

/** Margin notes: which code line each one sits beside, and when it lands. */
const NOTES: readonly {
  readonly line: number;
  readonly at: number;
  readonly text: string;
}[] = [
  { line: 0, at: 160, text: "plain javascript decides the fan-out" },
  { line: 2, at: 230, text: "the only place a model enters" },
  { line: 3, at: 300, text: "schema-validated; bad replies retried" },
  { line: 8, at: 370, text: "a dead critic is null, not a crash" },
];

const CARD_TOP = 186;
const HEADER_HEIGHT = 66;
const PAD = 34;
const LINE_HEIGHT = 31 * 1.7;

export const Synopsis: React.FC = () => {
  const frame = useCurrentFrame();
  const highlighted = new Set(
    NOTES.filter((n) => frame >= n.at).map((n) => n.line),
  );

  return (
    <SceneFade duration={SYNOPSIS_DURATION}>
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
        SYNOPSIS
      </div>

      <div
        style={{
          position: "absolute",
          left: 140,
          top: CARD_TOP,
          width: 1080,
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
          .codex/workflows/review-sweep.js
        </div>
        <div style={{ padding: `${PAD}px 48px` }}>
          {CODE.map((text, i) => {
            const hl = highlighted.has(i);
            const note = NOTES.find((n) => n.line === i);
            const hlOpacity = note
              ? interpolate(frame, [note.at, note.at + 10], [0, 1], clamp)
              : 0;
            return (
              <div
                key={`line-${i}`}
                style={{
                  fontFamily: fontMono,
                  fontSize: 31,
                  lineHeight: 1.7,
                  whiteSpace: "pre",
                  color: hl ? ink : ink2,
                  backgroundColor: hl
                    ? `rgba(20, 121, 93, ${0.1 * hlOpacity})`
                    : undefined,
                  ...fadeUp(frame, CODE_START + i * CODE_STEP, 10),
                }}
              >
                {text || " "}
              </div>
            );
          })}
        </div>
      </div>

      {NOTES.map((note) => (
        <div
          key={note.text}
          style={{
            position: "absolute",
            left: 1290,
            top: CARD_TOP + HEADER_HEIGHT + PAD + note.line * LINE_HEIGHT + 6,
            display: "flex",
            alignItems: "center",
            gap: 22,
            ...fadeUp(frame, note.at, 12),
          }}
        >
          <div style={{ width: 3, height: 34, backgroundColor: green }} />
          <div
            style={{
              fontFamily: fontSans,
              fontSize: 29,
              color: ink2,
              whiteSpace: "nowrap",
            }}
          >
            {note.text}
          </div>
        </div>
      ))}
    </SceneFade>
  );
};
