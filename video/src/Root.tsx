import React from "react";
import { Composition } from "remotion";
import { AGENT_TERMINAL_FRAMES, Agent } from "./Agent";
import { AD_PROPS, AGENT_SHOW } from "./ad-props";
import { BUMPER_FRAMES, Bumper } from "./Bumper";
import { Show, type ShowProps } from "./Show";

const FPS = 30;
const V = { width: 1080, height: 1920 };
const W = { width: 1920, height: 1080 };
/** A clip's length comes from its props (scripts/clips/branded-clip.mjs lays the scenes out). */
const fromProps = ({ props }: { props: ShowProps }) => ({ durationInFrames: props.t.total });
const agentFrames = AGENT_TERMINAL_FRAMES + (AGENT_SHOW.t.end - AGENT_SHOW.t.cast) + 90;

export const Root: React.FC = () => (
  <>
    <Composition id="Ad" component={Show} defaultProps={AD_PROPS} durationInFrames={AD_PROPS.t.total} fps={FPS} {...V} />
    <Composition id="AdWide" component={Show} defaultProps={AD_PROPS} durationInFrames={AD_PROPS.t.total} fps={FPS} {...W} />
    <Composition id="Clip" component={Show} defaultProps={AD_PROPS} calculateMetadata={fromProps} durationInFrames={AD_PROPS.t.total} fps={FPS} {...V} />
    <Composition id="ClipWide" component={Show} defaultProps={AD_PROPS} calculateMetadata={fromProps} durationInFrames={AD_PROPS.t.total} fps={FPS} {...W} />
    <Composition id="Bumper" component={Bumper} durationInFrames={BUMPER_FRAMES} fps={FPS} {...V} />
    <Composition id="BumperWide" component={Bumper} durationInFrames={BUMPER_FRAMES} fps={FPS} {...W} />
    <Composition id="Agent" component={Agent} defaultProps={{ show: AGENT_SHOW }} durationInFrames={agentFrames} fps={FPS} {...V} />
    <Composition id="AgentWide" component={Agent} defaultProps={{ show: AGENT_SHOW }} durationInFrames={agentFrames} fps={FPS} {...W} />
  </>
);
