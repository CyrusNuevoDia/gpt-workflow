import type React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { fontMono, fontSans, green, ink, ink2, ink3, rule } from "../theme";
import { clamp, easeOut, fadeUp, SceneFade } from "../ui";

export const ECONOMICS_DURATION = 400;

const SHAPES_AT = 26;
const TURN_AT = 64;
const GRID_AT = 108;
const DOTS_AT = 120;
const LEDGER_A_AT = 196;
const LEDGER_B_AT = 222;
const PUNCH_AT = 290;

const DOT_COUNT = 50;
const DOT_COLS = 10;
const DOT_SIZE = 30;
const DOT_GAP = 14;

export const Economics: React.FC = () => {
  const frame = useCurrentFrame();

  const ledgerRow: React.CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    width: 820,
    fontFamily: fontMono,
    fontSize: 31,
    whiteSpace: "nowrap",
  };
  const leader: React.CSSProperties = {
    flex: 1,
    margin: "0 18px",
    borderBottom: `2px dotted ${rule}`,
    transform: "translateY(-8px)",
  };

  return (
    <SceneFade duration={ECONOMICS_DURATION}>
      <div style={{ position: "absolute", left: 220, top: 154 }}>
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
          DESCRIPTION
        </div>

        <div
          style={{
            marginTop: 44,
            fontFamily: fontMono,
            fontSize: 31,
            color: ink3,
            ...fadeUp(frame, SHAPES_AT),
          }}
        >
          judge panels · critic fan-outs · migration sweeps
        </div>
        <div
          style={{
            marginTop: 24,
            maxWidth: 1450,
            fontFamily: fontSans,
            fontSize: 40,
            color: ink,
            ...fadeUp(frame, TURN_AT),
          }}
        >
          nothing about the shapes changed. what changed is the unit economics.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            columnGap: 96,
            marginTop: 64,
          }}
        >
          <div style={fadeUp(frame, GRID_AT)}>
            <div
              style={{
                fontFamily: fontMono,
                fontSize: 26,
                color: ink3,
              }}
            >
              one review sweep — 50 agents
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${DOT_COLS}, ${DOT_SIZE}px)`,
                gap: DOT_GAP,
                marginTop: 20,
              }}
            >
              {Array.from({ length: DOT_COUNT }, (_, i) => {
                const pop = interpolate(
                  frame,
                  [DOTS_AT + i * 1.2, DOTS_AT + i * 1.2 + 8],
                  [0, 1],
                  { ...clamp, easing: easeOut },
                );
                return (
                  <div
                    key={`agent-${i}`}
                    style={{
                      width: DOT_SIZE,
                      height: DOT_SIZE,
                      backgroundColor: green,
                      opacity: pop,
                      transform: `scale(${0.6 + pop * 0.4})`,
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div style={{ paddingTop: 46 }}>
            <div style={{ ...ledgerRow, ...fadeUp(frame, LEDGER_A_AT) }}>
              <span style={{ color: ink2 }}>on metered claude tokens</span>
              <span style={leader} />
              <span style={{ color: ink }}>real money</span>
            </div>
            <div
              style={{
                ...ledgerRow,
                marginTop: 42,
                ...fadeUp(frame, LEDGER_B_AT),
              }}
            >
              <span style={{ color: ink2 }}>on a codex plan</span>
              <span style={leader} />
              <span style={{ color: green, fontWeight: 600 }}>
                barely a dent
              </span>
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 68,
            fontFamily: fontSans,
            fontWeight: 600,
            fontSize: 44,
            color: ink,
            ...fadeUp(frame, PUNCH_AT),
          }}
        >
          workflows you used to ration, you just run.
        </div>
      </div>
    </SceneFade>
  );
};
