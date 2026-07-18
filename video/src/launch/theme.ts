import { loadFont as loadIBMPlexMono } from "@remotion/google-fonts/IBMPlexMono";
import { loadFont as loadIBMPlexSans } from "@remotion/google-fonts/IBMPlexSans";

/**
 * v2 grammar: a cinematic space cold open (luna drifts, sol rises), then
 * everything lives in daylight — black type and white windows on a white
 * stage, strictly monochrome. Space returns exactly once, when the fan-out
 * ignites 50 agents against the milky way. No accent color anywhere.
 */

export const stage = "#fcfcfa";
export const white = "#ffffff";
export const ink = "#17150f";
export const ink2 = "#55534d";
export const ink3 = "#8a8577";
export const ink4 = "#b3b0a6";
export const line = "rgba(23, 21, 15, 0.1)";
export const flash = "rgba(23, 21, 15, 0.08)";

export const fontMono = loadIBMPlexMono("normal", {
  weights: ["400", "500", "600"],
  subsets: ["latin"],
}).fontFamily;

export const fontSans = loadIBMPlexSans("normal", {
  weights: ["400", "600"],
  subsets: ["latin"],
}).fontFamily;
