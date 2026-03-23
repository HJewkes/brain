import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, component } from '../shared/colors.js';
import { useCurrentTimestamp } from './TimeSyncContext.js';
import type { TokenSnapshot, CompactionEvent } from '../../types.js';
import { widgetLabel } from './shared-styles.js';

interface Props {
  tokenTimeline: TokenSnapshot[];
  compactions: CompactionEvent[];
  startedAt: string;
  endedAt: string | null;
}

interface ChartData {
  inputPts: Array<{ x: number; y: number }>;
  outputPts: Array<{ x: number; y: number }>;
  compXs: number[];
  maxY: number;
  t0: number;
  dur: number;
}

const CHART_H = 60;
const INPUT_COLOR = component.contextChart.input;
const OUTPUT_COLOR = component.contextChart.output;
const COMP_COLOR = component.contextChart.compaction;

export function ContextWindowChart({ tokenTimeline, compactions, startedAt, endedAt }: Props) {
  const currentTs = useCurrentTimestamp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFracRef = useRef(-1);

  const chartData = useMemo(
    () => buildChartData(tokenTimeline, compactions, startedAt, endedAt),
    [tokenTimeline, compactions, startedAt, endedAt],
  );

  const draw = useCallback((frac: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !chartData) return;
    drawSparkline(canvas, chartData, frac);
  }, [chartData]);

  useEffect(() => {
    if (!chartData) return;
    const frac = computeFraction(currentTs || startedAt, chartData.t0, chartData.dur);
    if (Math.abs(frac - lastFracRef.current) < 0.002) return;
    lastFracRef.current = frac;
    draw(frac);
  }, [currentTs, chartData, draw, startedAt]);

  useEffect(() => {
    const parent = canvasRef.current?.parentElement;
    if (!parent || !chartData) return;
    const observer = new ResizeObserver(() => draw(lastFracRef.current));
    observer.observe(parent);
    return () => observer.disconnect();
  }, [chartData, draw]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>CONTEXT WINDOW</Text>
      <View style={styles.wrap}>
        <canvas ref={canvasRef as React.LegacyRef<HTMLCanvasElement>} height={CHART_H} style={{ width: '100%', display: 'block' }} />
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendItem}>Start</Text>
        <Text style={[styles.legendItem, { color: INPUT_COLOR }]}>-- In</Text>
        <Text style={[styles.legendItem, { color: OUTPUT_COLOR }]}>-- Out</Text>
        <Text style={styles.legendItem}>End</Text>
      </View>
    </View>
  );
}

function computeFraction(ts: string, t0: number, dur: number): number {
  return Math.max(0, Math.min(1, (new Date(ts).getTime() - t0) / dur));
}

function buildChartData(
  snaps: TokenSnapshot[],
  comps: CompactionEvent[],
  startedAt: string,
  endedAt: string | null,
): ChartData | null {
  if (!snaps.length) return null;
  const t0 = new Date(startedAt).getTime();
  const tEnd = endedAt ? new Date(endedAt).getTime() : t0 + 60 * 60_000;
  const dur = tEnd - t0 || 1;
  const maxY = Math.max(...snaps.map(s => Math.max(s.cumulativeInput, s.cumulativeOutput)), 1);

  const inputPts = snaps.map(s => ({
    x: (new Date(s.timestamp).getTime() - t0) / dur,
    y: s.cumulativeInput / maxY,
  }));
  const outputPts = snaps.map(s => ({
    x: (new Date(s.timestamp).getTime() - t0) / dur,
    y: s.cumulativeOutput / maxY,
  }));
  const compXs = comps.map(c => (new Date(c.timestamp).getTime() - t0) / dur);

  return { inputPts, outputPts, compXs, maxY, t0, dur };
}

function drawSparkline(canvas: HTMLCanvasElement, data: ChartData, playheadFrac: number): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const W = parent.clientWidth - 12;
  const H = CHART_H;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, W, H);

  drawLine(ctx, data.inputPts, W, H, INPUT_COLOR);
  drawLine(ctx, data.outputPts, W, H, OUTPUT_COLOR);
  drawCompactions(ctx, data.compXs, W, H);
  drawPlayhead(ctx, playheadFrac, W, H);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  W: number, H: number,
  color: string,
): void {
  if (pts.length < 2) return;
  const pad = 4;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i].x * W;
    const y = H - pad - pts[i].y * (H - 2 * pad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '40');
  grad.addColorStop(1, color + '05');
  ctx.lineTo(pts[pts.length - 1].x * W, H);
  ctx.lineTo(pts[0].x * W, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

function drawCompactions(
  ctx: CanvasRenderingContext2D,
  xs: number[],
  W: number, H: number,
): void {
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = COMP_COLOR + 'CC';
  ctx.lineWidth = 1;
  for (const xFrac of xs) {
    const x = xFrac * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  frac: number,
  W: number, H: number,
): void {
  const x = frac * W;
  ctx.strokeStyle = component.contextChart.marker;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, H);
  ctx.stroke();
  ctx.fillStyle = component.contextChart.marker;
  ctx.beginPath();
  ctx.moveTo(x - 3, 0);
  ctx.lineTo(x + 3, 0);
  ctx.lineTo(x, 5);
  ctx.closePath();
  ctx.fill();
}

const styles = StyleSheet.create({
  container: {},
  label: widgetLabel,
  wrap: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 5,
    padding: 6,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  legendItem: {
    fontFamily: "'Space Grotesk', sans-serif",
    fontSize: 9,
    color: C.textTertiary,
  },
});
