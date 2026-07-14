import React from "react";
import { AbsoluteFill, Series } from "remotion";
import { HOOK_DURATION, HookCard } from "./scenes/HookCard";
import { NAME_DURATION, NameCard } from "./scenes/NameCard";
import { OUTRO_DURATION, OutroScene } from "./scenes/OutroScene";
import { PUNCH_DURATION, PunchCard } from "./scenes/PunchCard";
import { RUN_DURATION, RunScene } from "./scenes/RunScene";
import { TEASER_DURATION, Teaser } from "./scenes/Teaser";
import { WORKFLOW_DURATION, WorkflowScene } from "./scenes/WorkflowScene";
import { stage } from "./theme";

export const LAUNCH_DURATION =
  TEASER_DURATION +
  HOOK_DURATION +
  NAME_DURATION +
  WORKFLOW_DURATION +
  RUN_DURATION +
  PUNCH_DURATION +
  OUTRO_DURATION;

export const Launch: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: stage }}>
      <Series>
        <Series.Sequence durationInFrames={TEASER_DURATION}>
          <Teaser />
        </Series.Sequence>
        <Series.Sequence durationInFrames={HOOK_DURATION}>
          <HookCard />
        </Series.Sequence>
        <Series.Sequence durationInFrames={NAME_DURATION}>
          <NameCard />
        </Series.Sequence>
        <Series.Sequence durationInFrames={WORKFLOW_DURATION}>
          <WorkflowScene />
        </Series.Sequence>
        <Series.Sequence durationInFrames={RUN_DURATION}>
          <RunScene />
        </Series.Sequence>
        <Series.Sequence durationInFrames={PUNCH_DURATION}>
          <PunchCard />
        </Series.Sequence>
        <Series.Sequence durationInFrames={OUTRO_DURATION}>
          <OutroScene />
        </Series.Sequence>
      </Series>
    </AbsoluteFill>
  );
};
