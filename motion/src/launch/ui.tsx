import React from "react";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fontMono, ink, ink3, line, white } from "./theme";

export const easeOut = Easing.out(Easing.cubic);

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** Opacity + rise-in for a line entering at `start`. */
export const fadeUp = (
  frame: number,
  start: number,
  duration = 14,
): React.CSSProperties => {
  const progress = interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: easeOut,
  });
  return {
    opacity: progress,
    transform: `translateY(${(1 - progress) * 14}px)`,
  };
};

/** OpenAI-style progressive word reveal: words fade-slide in sequence. */
export const WordReveal: React.FC<{
  readonly text: string;
  readonly start: number;
  readonly stagger?: number;
}> = ({ text, start, stagger = 2.5 }) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");
  return (
    <span>
      {words.map((word, i) => (
        <span
          key={`w-${i}`}
          style={{
            display: "inline-block",
            whiteSpace: "pre",
            ...fadeUp(frame, start + i * stagger, 12),
          }}
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
};

/** White product window with a hairline border and soft shadow. */
export const TerminalCard: React.FC<{
  readonly title: string;
  readonly style?: React.CSSProperties;
  readonly children: React.ReactNode;
}> = ({ title, style, children }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: 240,
        right: 240,
        top: 150,
        bottom: 150,
        backgroundColor: white,
        border: `1px solid ${line}`,
        borderRadius: 18,
        boxShadow:
          "0 30px 80px rgba(23, 21, 15, 0.1), 0 4px 16px rgba(23, 21, 15, 0.06)",
        overflow: "hidden",
        ...style,
      }}
    >
      <div
        style={{
          padding: "20px 40px",
          borderBottom: `1px solid ${line}`,
          fontFamily: fontMono,
          fontSize: 22,
          color: ink3,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
};

/** Character count typed so far — slice strings, never per-character opacity. */
export const useTyped = (text: string, start: number, cps = 30): string => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const count = Math.max(0, Math.floor(((frame - start) * cps) / fps));
  return text.slice(0, Math.min(text.length, count));
};

export const typedDuration = (text: string, fps: number, cps = 30): number =>
  Math.ceil((text.length * fps) / cps);

/** Terminal block cursor. Blinks unless `solid`. */
export const Cursor: React.FC<{
  readonly solid?: boolean;
  readonly color?: string;
}> = ({ solid = false, color = ink }) => {
  const frame = useCurrentFrame();
  const on = solid || Math.floor(frame / 16) % 2 === 0;
  return (
    <span
      style={{
        display: "inline-block",
        width: "0.6em",
        height: "1.1em",
        verticalAlign: "text-bottom",
        backgroundColor: color,
        opacity: on ? 1 : 0,
      }}
    />
  );
};
