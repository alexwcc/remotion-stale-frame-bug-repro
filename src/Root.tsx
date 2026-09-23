import React from "react";
import { Composition } from "remotion";
import { Repro } from "./Repro";

export const Root: React.FC = () => {
  return (
    <Composition
      id="Repro"
      component={Repro}
      durationInFrames={75}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
