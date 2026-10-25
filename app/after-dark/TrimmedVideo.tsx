"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, type VideoHTMLAttributes } from "react";
import type { Trim } from "@/lib/adult/trim";
import { trimStep } from "./trimPlayback";

/**
 * A <video> that plays its trim (lib/adult/trim.ts): from the start, over the parts cut out, and to the end (where a
 * looping one starts again). The Studio's and the gallery's clips; the reel player does the same with its own two.
 */
const TrimmedVideo = forwardRef<HTMLVideoElement, VideoHTMLAttributes<HTMLVideoElement> & { trim?: Trim | null }>(function TrimmedVideo({ trim, ...props }, ref) {
  const own = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => own.current!);
  useEffect(() => {
    const v = own.current;
    if (!v || !trim) return;
    const step = () => {
      const r = trimStep(trim, v.currentTime);
      if (!r) return;
      if ("seek" in r) v.currentTime = r.seek;
      else if (v.loop) v.currentTime = trim.start;
      else v.pause();
    };
    // Played again from where it stopped (its end): from the start.
    const replay = () => {
      const r = trimStep(trim, v.currentTime);
      if (r && "done" in r) v.currentTime = trim.start;
      else step();
    };
    v.addEventListener("loadedmetadata", step);
    v.addEventListener("timeupdate", step);
    v.addEventListener("play", replay);
    return () => {
      v.removeEventListener("loadedmetadata", step);
      v.removeEventListener("timeupdate", step);
      v.removeEventListener("play", replay);
    };
  }, [trim]);
  return <video ref={own} {...props} />;
});
export default TrimmedVideo;
