'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { BRUTAL } from './brutal';

const TOUR_DURATION = 12000;
const GLOW_IN_MS = 500;
const GLOW_HOLD_MS = 900;
const GLOW_OUT_MS = 600;
const BLACK_FADE_MS = 450;

type Phase = 'tour' | 'glow' | 'complete';

const KNIGHT_NODES: [number, number][] = [
  [72, 952], [323.43, 826.29], [574.86, 952], [826.29, 826.29],
  [952, 574.86], [826.29, 323.43], [952, 72], [700.57, 197.71],
  [449.14, 72], [197.71, 197.71], [72, 449.14], [197.71, 700.57],
  [323.43, 952], [72, 826.29], [197.71, 574.86], [72, 323.43],
  [197.71, 72], [323.43, 323.43], [72, 197.71], [323.43, 72],
  [574.86, 197.71], [826.29, 72], [952, 323.43], [700.57, 449.14],
  [826.29, 197.71], [952, 449.14], [826.29, 700.57], [952, 952],
  [700.57, 826.29], [449.14, 952], [197.71, 826.29], [449.14, 700.57],
  [574.86, 449.14], [826.29, 574.86], [952, 826.29], [700.57, 952],
  [574.86, 700.57], [323.43, 574.86], [72, 700.57], [197.71, 952],
  [449.14, 826.29], [700.57, 700.57], [826.29, 952], [952, 700.57],
  [700.57, 574.86], [574.86, 826.29], [449.14, 574.86], [197.71, 449.14],
  [449.14, 323.43], [574.86, 72], [323.43, 197.71], [72, 72],
  [197.71, 323.43], [449.14, 449.14], [323.43, 700.57], [72, 574.86],
  [323.43, 449.14], [574.86, 574.86], [700.57, 323.43], [449.14, 197.71],
  [700.57, 72], [574.86, 323.43], [826.29, 449.14], [952, 197.71],
];

const KNIGHT_PATH_D =
  'M72 952 L323.43 826.29 L574.86 952 L826.29 826.29 L952 574.86 L826.29 323.43 L952 72 L700.57 197.71 L449.14 72 L197.71 197.71 L72 449.14 L197.71 700.57 L323.43 952 L72 826.29 L197.71 574.86 L72 323.43 L197.71 72 L323.43 323.43 L72 197.71 L323.43 72 L574.86 197.71 L826.29 72 L952 323.43 L700.57 449.14 L826.29 197.71 L952 449.14 L826.29 700.57 L952 952 L700.57 826.29 L449.14 952 L197.71 826.29 L449.14 700.57 L574.86 449.14 L826.29 574.86 L952 826.29 L700.57 952 L574.86 700.57 L323.43 574.86 L72 700.57 L197.71 952 L449.14 826.29 L700.57 700.57 L826.29 952 L952 700.57 L700.57 574.86 L574.86 826.29 L449.14 574.86 L197.71 449.14 L449.14 323.43 L574.86 72 L323.43 197.71 L72 72 L197.71 323.43 L449.14 449.14 L323.43 700.57 L72 574.86 L323.43 449.14 L574.86 574.86 L700.57 323.43 L449.14 197.71 L700.57 72 L574.86 323.43 L826.29 449.14 L952 197.71';

const NODE_COUNT = KNIGHT_NODES.length;

const pathProps = {
  fill: 'none' as const,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const nodeThreshold = (i: number) => i / Math.max(NODE_COUNT - 1, 1);

export default function KnightTourFormation({
  size = 360,
  onInk = false,
  dimmed = false,
}: {
  size?: number;
  onInk?: boolean;
  dimmed?: boolean;
}) {
  const filterId = useId().replace(/:/g, '');
  const measureRef = useRef<SVGPathElement>(null);
  const rafRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('tour');
  const [tourProgress, setTourProgress] = useState(0);
  const [glowStrength, setGlowStrength] = useState(0);
  const [blackReveal, setBlackReveal] = useState(0);
  const [pathLength, setPathLength] = useState(0);

  const lineColor = onInk ? 'oklch(0.45 0.02 240)' : BRUTAL.border;
  const traceColor = BRUTAL.accent;
  const nodeStroke = onInk ? 'oklch(0.55 0.02 240)' : BRUTAL.border;
  const ink = onInk ? 'oklch(0.12 0.01 240)' : BRUTAL.ink;
  const opacity = dimmed ? 0.45 : 1;

  const tourDashOffset = pathLength * (1 - tourProgress);
  const showTeal = phase === 'tour' || phase === 'glow';
  const tealOpacity = phase === 'complete' ? Math.max(0, 1 - blackReveal) : 1;
  const blackOpacity = phase === 'complete' ? blackReveal : 0;

  useEffect(() => {
    const len = measureRef.current?.getTotalLength() ?? 0;
    if (len > 0) setPathLength(len);
  }, []);

  useEffect(() => {
    if (phase !== 'tour' || pathLength <= 0) return;

    let startTime: number | null = null;
    const frame = (now: number) => {
      if (!startTime) startTime = now;
      const progress = Math.min((now - startTime) / TOUR_DURATION, 1);
      setTourProgress(progress);

      if (progress >= 1) {
        setPhase('glow');
        return;
      }
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, pathLength]);

  useEffect(() => {
    if (phase !== 'glow') return;

    let startTime: number | null = null;
    const glowTotal = GLOW_IN_MS + GLOW_HOLD_MS + GLOW_OUT_MS;

    const frame = (now: number) => {
      if (!startTime) startTime = now;
      const elapsed = now - startTime;

      if (elapsed >= glowTotal) {
        setGlowStrength(0);
        setPhase('complete');
        return;
      }

      let strength = 0;
      if (elapsed < GLOW_IN_MS) {
        strength = elapsed / GLOW_IN_MS;
      } else if (elapsed < GLOW_IN_MS + GLOW_HOLD_MS) {
        strength = 1;
      } else {
        const outElapsed = elapsed - GLOW_IN_MS - GLOW_HOLD_MS;
        strength = 1 - outElapsed / GLOW_OUT_MS;
      }
      setGlowStrength(strength);
      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'complete') return;

    let startTime: number | null = null;
    const frame = (now: number) => {
      if (!startTime) startTime = now;
      const t = Math.min((now - startTime) / BLACK_FADE_MS, 1);
      setBlackReveal(t);
      if (t < 1) rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase]);

  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      style={{ display: 'block', overflow: 'visible', opacity }}
      aria-hidden
    >
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="10" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="0 0 0 0 0.23  0 0 0 0 0.57  0 0 0 0 0.61  0 0 0 0.85 0"
            result="tealGlow"
          />
          <feMerge>
            <feMergeNode in="tealGlow" />
            <feMergeNode in="tealGlow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path ref={measureRef} d={KNIGHT_PATH_D} fill="none" stroke="none" opacity={0} />

      <path
        d={KNIGHT_PATH_D}
        {...pathProps}
        stroke={lineColor}
        strokeWidth={6}
        opacity={0.35}
      />

      {pathLength > 0 && showTeal && tealOpacity > 0 && (
        <path
          d={KNIGHT_PATH_D}
          {...pathProps}
          stroke={traceColor}
          strokeWidth={8}
          strokeDasharray={pathLength}
          strokeDashoffset={phase === 'tour' ? tourDashOffset : 0}
          opacity={tealOpacity}
        />
      )}

      {phase === 'glow' && pathLength > 0 && glowStrength > 0 && (
        <path
          d={KNIGHT_PATH_D}
          {...pathProps}
          stroke={traceColor}
          strokeWidth={12}
          strokeDasharray={pathLength}
          strokeDashoffset={0}
          filter={`url(#${filterId})`}
          opacity={glowStrength * 0.95}
        />
      )}

      {pathLength > 0 && blackOpacity > 0 && (
        <path
          d={KNIGHT_PATH_D}
          {...pathProps}
          stroke={ink}
          strokeWidth={5}
          strokeDasharray={pathLength}
          strokeDashoffset={0}
          opacity={blackOpacity}
        />
      )}

      {KNIGHT_NODES.map(([cx, cy], i) => {
        const threshold = nodeThreshold(i);
        const litOnTour = phase === 'tour' && tourProgress >= threshold;
        const litOnGlow = phase === 'glow';
        const onBlack = phase === 'complete';

        let fill = 'transparent';
        let stroke = nodeStroke;
        let nodeOpacity = 0.35;
        let r = 10;

        if (onBlack) {
          fill = ink;
          stroke = ink;
          nodeOpacity = blackReveal;
          r = 7;
        } else if (litOnGlow || litOnTour) {
          fill = traceColor;
          nodeOpacity = 1;
        }

        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={r}
            fill={fill}
            stroke={stroke}
            strokeWidth={onBlack ? 2.5 : 2}
            opacity={nodeOpacity}
          />
        );
      })}
    </svg>
  );
}
