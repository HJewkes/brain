import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import type { ScrollView } from 'react-native';
import { C, component } from '../shared/colors.js';
import type { SessionDetailData } from '../../types.js';

export interface ActivityMinimapProps {
  data: SessionDetailData;
  timelineRef: React.RefObject<ScrollView>;
  height: number;
}

const STRIP_WIDTH = 8;
const AMBER = [244, 167, 54];
const BLUE_TICK = component.minimap.blueTick;
const VIEWPORT_BG = component.minimap.viewportBg;
const VIEWPORT_BORDER = component.minimap.viewportBorder;

interface DensityData {
  buckets: number[];
  maxCount: number;
  userFracs: number[];
  t0: number;
  dur: number;
}

function buildDensityData(data: SessionDetailData): DensityData | null {
  const t0 = new Date(data.session.startedAt).getTime();
  const endMs = data.session.completedAt
    ? new Date(data.session.completedAt).getTime()
    : t0 + (data.session.durationMinutes ?? 60) * 60_000;
  const dur = endMs - t0 || 1;

  const numBuckets = Math.max(1, Math.ceil(dur / 60_000) + 1);
  const buckets = new Array<number>(numBuckets).fill(0);

  const allToolCalls = data.turns.flatMap((t) => t.toolCalls);
  for (const tc of allToolCalls) {
    const relMin = (new Date(tc.timestamp).getTime() - t0) / 60_000;
    const b = Math.floor(Math.max(0, Math.min(numBuckets - 1, relMin)));
    buckets[b]++;
  }

  const userFracs = collectUserFracs(data, t0, dur);
  const maxCount = Math.max(...buckets, 1);

  return { buckets, maxCount, userFracs, t0, dur };
}

function collectUserFracs(
  data: SessionDetailData,
  t0: number,
  dur: number,
): number[] {
  return data.turns
    .filter((t) => t.userMessage.length > 0)
    .map((t) => (new Date(t.timestamp).getTime() - t0) / dur)
    .filter((f) => f >= 0 && f <= 1);
}

function drawDensity(
  ctx: CanvasRenderingContext2D,
  density: DensityData,
  W: number,
  H: number,
): void {
  ctx.clearRect(0, 0, W, H);
  const { buckets, maxCount } = density;
  const numBuckets = buckets.length;

  for (let i = 0; i < numBuckets; i++) {
    if (buckets[i] === 0) continue;
    const yTop = (i / numBuckets) * H;
    const yBot = ((i + 1) / numBuckets) * H;
    const alpha = 0.08 + (buckets[i] / maxCount) * 0.45;
    const [r, g, b] = AMBER;
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    ctx.fillRect(0, Math.max(0, yTop), W, Math.max(1, yBot - yTop));
  }
}

function drawUserTicks(
  ctx: CanvasRenderingContext2D,
  userFracs: number[],
  W: number,
  H: number,
): void {
  ctx.fillStyle = BLUE_TICK;
  for (const frac of userFracs) {
    const y = frac * H;
    ctx.fillRect(0, y, W, 1);
  }
}

function drawViewportBox(
  ctx: CanvasRenderingContext2D,
  scrollFrac: number,
  visFrac: number,
  W: number,
  H: number,
): void {
  const boxH = Math.max(4, visFrac * H);
  const boxY = scrollFrac * (H - boxH);

  ctx.fillStyle = VIEWPORT_BG;
  ctx.fillRect(0, boxY, W, boxH);
  ctx.strokeStyle = VIEWPORT_BORDER;
  ctx.lineWidth = 0.5;
  ctx.strokeRect(0, boxY, W, boxH);
}

export function ActivityMinimap({ data, timelineRef, height }: ActivityMinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollFracRef = useRef(0);
  const visFracRef = useRef(1);
  const rafRef = useRef(0);

  const density = useMemo(() => buildDensityData(data), [data]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !density) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = STRIP_WIDTH;
    canvas.height = height;

    drawDensity(ctx, density, STRIP_WIDTH, height);
    drawUserTicks(ctx, density.userFracs, STRIP_WIDTH, height);
    drawViewportBox(ctx, scrollFracRef.current, visFracRef.current, STRIP_WIDTH, height);
  }, [density, height]);

  useEffect(() => { paint(); }, [paint]);

  useEffect(() => {
    const scrollNode = resolveScrollNode(timelineRef);
    if (!scrollNode) return;

    const onScroll = () => {
      const maxScroll = scrollNode.scrollHeight - scrollNode.clientHeight;
      scrollFracRef.current = maxScroll > 0 ? scrollNode.scrollTop / maxScroll : 0;
      visFracRef.current = scrollNode.clientHeight / Math.max(scrollNode.scrollHeight, 1);

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(paint);
    };

    onScroll();
    scrollNode.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scrollNode.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [timelineRef, paint]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const scrollNode = resolveScrollNode(timelineRef);
      if (!scrollNode) return;
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const frac = (e.clientY - rect.top) / rect.height;
      const maxScroll = scrollNode.scrollHeight - scrollNode.clientHeight;
      scrollNode.scrollTop = frac * maxScroll;
    },
    [timelineRef],
  );

  if (!density) return null;

  return (
    <View style={[styles.strip, { height }]}>
      <canvas
        ref={canvasRef as React.LegacyRef<HTMLCanvasElement>}
        width={STRIP_WIDTH}
        height={height}
        onClick={handleClick as unknown as React.MouseEventHandler}
        style={{ cursor: 'pointer', width: STRIP_WIDTH, height }}
      />
    </View>
  );
}

function resolveScrollNode(
  ref: React.RefObject<ScrollView>,
): HTMLElement | null {
  const raw = ref.current as unknown as HTMLElement | null;
  if (!raw) return null;
  // react-native-web ScrollView renders a nested scrollable div
  if (raw.scrollHeight > raw.clientHeight) return raw;
  const child = raw.querySelector('[data-testid]') ?? raw.firstElementChild;
  return (child as HTMLElement) ?? raw;
}

const styles = StyleSheet.create({
  strip: {
    width: STRIP_WIDTH,
    position: 'absolute' as never,
    left: 0,
    top: 0,
  },
});
