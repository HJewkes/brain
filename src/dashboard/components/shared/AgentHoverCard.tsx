import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import type { DashboardAgent } from '../../types.js';
import { C } from './colors.js';
import { TokenGauge } from './TokenGauge.js';
import { ActivitySparkline } from './ActivitySparkline.js';
import { hoverStyles as s } from './hoverStyles.js';

interface Props {
  agent: DashboardAgent;
  anchorEl: HTMLElement | null;
  visible: boolean;
}

interface Position { top: number; left: number }

const CARD_WIDTH = 260;
const CARD_HEIGHT = 280;

function calcPosition(anchor: HTMLElement): Position {
  const rect = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.right + 10;
  let top = rect.top - 10;
  if (left + CARD_WIDTH > vw - 10) left = rect.left - CARD_WIDTH - 10;
  if (top + CARD_HEIGHT > vh - 10) top = vh - CARD_HEIGHT - 10;
  if (top < 10) top = 10;
  return { top, left };
}

export function AgentHoverCard({ agent, anchorEl, visible }: Props) {
  const [pos, setPos] = useState<Position>({ top: 0, left: 0 });
  const isActive = agent.status === 'active' || agent.status === 'running';
  const errRate = agent.toolCalls > 0
    ? ((agent.errors / agent.toolCalls) * 100).toFixed(1)
    : '0.0';

  useEffect(() => {
    if (anchorEl && visible) setPos(calcPosition(anchorEl));
  }, [anchorEl, visible]);

  if (!visible) return null;

  const avatarBg = isActive ? C.brand : C.steel;
  const statusBg = isActive ? 'rgba(20,184,166,0.15)' : 'rgba(107,114,128,0.15)';
  const statusDotColor = isActive ? C.success : C.textTertiary;
  const statusLabel = isActive ? 'Active' : 'Idle';
  const events = agent.toolDomains.slice(0, 15).map(type => ({ type }));

  return (
    <View style={[s.card, { top: pos.top, left: pos.left } as object]}>
      <View style={s.header}>
        <View style={[s.avatar, { backgroundColor: avatarBg }]}>
          <Text style={s.avatarText}>{agent.name.slice(0, 2).toUpperCase()}</Text>
        </View>
        <View>
          <Text style={s.name}>{agent.name}</Text>
          <View style={[s.statusBadge, { backgroundColor: statusBg }]}>
            <View style={[s.statusDot, { backgroundColor: statusDotColor }]} />
            <Text style={[s.statusText, { color: statusDotColor }]}>{statusLabel}</Text>
          </View>
        </View>
      </View>
      <View style={s.taskRow}>
        <Text style={s.taskText} numberOfLines={1}>
          {agent.task ?? 'No active task'}{agent.branch ? ` — ${agent.branch}` : ''}
        </Text>
      </View>
      <TokenGauge tokensIn={agent.tokensIn} tokensOut={agent.tokensOut} />
      <View style={s.metricsRow}>
        {([['Tool Calls', agent.toolCalls, false], ['Errors', agent.errors, agent.errors > 0], ['Err Rate', `${errRate}%`, parseFloat(errRate) > 5]] as const).map(([label, val, isErr]) => (
          <View key={String(label)} style={s.metric}>
            <Text style={[s.metricValue, isErr && s.errorText]}>{String(val)}</Text>
            <Text style={s.metricLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.sparkLabel}>Last 15 tool calls</Text>
      <ActivitySparkline events={events} />
    </View>
  );
}
