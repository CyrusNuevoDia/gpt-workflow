import React from "react";
import { Series } from "remotion";
import { Chrome, Paper } from "./ui";
import { HOOK_DURATION, Hook } from "./scenes/Hook";
import { TITLE_DURATION, Title } from "./scenes/Title";
import { ECONOMICS_DURATION, Economics } from "./scenes/Economics";
import { SYNOPSIS_DURATION, Synopsis } from "./scenes/Synopsis";
import { STREAM_DURATION, Stream } from "./scenes/Stream";
import { MIGRATE_DURATION, Migrate } from "./scenes/Migrate";
import { OUTRO_DURATION, Outro } from "./scenes/Outro";

export const LAUNCH_DURATION =
  HOOK_DURATION +
  TITLE_DURATION +
  ECONOMICS_DURATION +
  SYNOPSIS_DURATION +
  STREAM_DURATION +
  MIGRATE_DURATION +
  OUTRO_DURATION;

export const Launch: React.FC = () => {
  return (
    <Paper>
      <Chrome />
      <Series>
        <Series.Sequence durationInFrames={HOOK_DURATION}>
          <Hook />
        </Series.Sequence>
        <Series.Sequence durationInFrames={TITLE_DURATION}>
          <Title />
        </Series.Sequence>
        <Series.Sequence durationInFrames={ECONOMICS_DURATION}>
          <Economics />
        </Series.Sequence>
        <Series.Sequence durationInFrames={SYNOPSIS_DURATION}>
          <Synopsis />
        </Series.Sequence>
        <Series.Sequence durationInFrames={STREAM_DURATION}>
          <Stream />
        </Series.Sequence>
        <Series.Sequence durationInFrames={MIGRATE_DURATION}>
          <Migrate />
        </Series.Sequence>
        <Series.Sequence durationInFrames={OUTRO_DURATION}>
          <Outro />
        </Series.Sequence>
      </Series>
    </Paper>
  );
};
