import type React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { stage } from "../theme";
import { clamp } from "../ui";

export const TEASER_DURATION = 250;

/** Cold open: luna drifts over Earth, sol crests the limb. The sunrise
 * flare rides into a full whiteout — the cut to the first card is invisible. */
export const Teaser: React.FC = () => {
  const frame = useCurrentFrame();
  const flare = interpolate(frame, [234, 248], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <OffthreadVideo
        src={staticFile("intro-teaser.mp4")}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <AbsoluteFill style={{ backgroundColor: stage, opacity: flare }} />
    </AbsoluteFill>
  );
};
