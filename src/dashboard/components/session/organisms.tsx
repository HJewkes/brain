import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { C, palette, semantic, component } from '../shared/colors.js';
import { Card, UserAvatar, ClaudeAvatar } from '../shared/index.js';
import { TurnSummaryCard } from './molecules.js';
import type { TurnSummaryCardProps } from './molecules.js';

/* ── Helpers ── */

/** Match task refs like VNM-21.04 or SNS-042 in plain text segments */
const TASK_REF_RE = /\b([A-Z]{2,5}-\d+(?:\.\d+)?)\b/g;

function renderTextWithRefs(text: string, keyPrefix: string, baseStyle: object): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TASK_REF_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) {
      parts.push(<Text key={`${keyPrefix}-${last}`} style={baseStyle}>{text.slice(last, idx)}</Text>);
    }
    const ref = m[1];
    const isSession = ref.startsWith('SNS-');
    const hash = isSession
      ? `#session?id=${encodeURIComponent(ref)}`
      : `#task?id=${encodeURIComponent(ref)}`;
    parts.push(
      <Text
        key={`${keyPrefix}-ref-${idx}`}
        style={s.taskRefLink}
        onPress={() => { window.location.hash = hash; }}
      >
        {ref}
      </Text>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) {
    parts.push(<Text key={`${keyPrefix}-${last}`} style={baseStyle}>{text.slice(last)}</Text>);
  }
  return parts.length > 0 ? parts : [<Text key={keyPrefix} style={baseStyle}>{text}</Text>];
}

function renderSimpleMarkdown(text: string): React.ReactNode[] {
  return text.split('\n\n').map((para, i) => {
    const parts: React.ReactNode[] = [];
    const boldRegex = /\*\*(.+?)\*\*/g;
    const codeRegex = /`([^`]+)`/g;
    let last = 0;
    const combined = [...para.matchAll(boldRegex), ...para.matchAll(codeRegex)]
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    if (combined.length === 0) {
      parts.push(...renderTextWithRefs(para, `p${i}`, s.claudeParaText));
    } else {
      for (const match of combined) {
        const idx = match.index ?? 0;
        if (idx > last) {
          parts.push(...renderTextWithRefs(para.slice(last, idx), `t${i}-${last}`, s.claudeParaText));
        }
        if (match[0].startsWith('**')) {
          parts.push(<Text key={`b${i}-${idx}`} style={s.claudeBoldText}>{match[1]}</Text>);
        } else {
          parts.push(<Text key={`c${i}-${idx}`} style={s.claudeCodeText}>{match[1]}</Text>);
        }
        last = idx + match[0].length;
      }
      if (last < para.length) {
        parts.push(...renderTextWithRefs(para.slice(last), `e${i}`, s.claudeParaText));
      }
    }
    return (
      <View key={i} style={i > 0 ? s.claudeParagraph : undefined}>
        <Text>{parts}</Text>
      </View>
    );
  });
}

const TEXT_TRUNCATE_LIMIT = 500;

function ExpandableText({ text, style, showMoreStyle, limit, renderContent, fade }: {
  text: string;
  style?: object;
  showMoreStyle?: object;
  limit?: number;
  renderContent?: (displayed: string) => React.ReactNode;
  fade?: boolean;
}) {
  const max = limit ?? TEXT_TRUNCATE_LIMIT;
  const needsTruncate = text.length > max;
  const [expanded, setExpanded] = useState(false);

  const displayed = !needsTruncate || expanded ? text : text.slice(0, max) + (renderContent ? '' : '...');
  const content = renderContent
    ? renderContent(displayed)
    : <Text style={style}>{displayed}</Text>;

  return (
    <View>
      <View style={!expanded && needsTruncate && fade ? s.claudeTextTruncated : undefined}>
        {content}
      </View>
      {needsTruncate && (
        <Pressable onPress={() => setExpanded(e => !e)}>
          <Text style={showMoreStyle ?? s.userShowMore}>{expanded ? 'Show less' : 'Show more'}</Text>
        </Pressable>
      )}
    </View>
  );
}

/* ── O1. UserMessageCard ── */

export interface UserMessageCardProps {
  text: string;
  timestamp: string;
}

export function UserMessageCard({ text, timestamp }: UserMessageCardProps) {
  return (
    <View style={s.userCardWrap}>
      <Card variant="accent" accentColor={palette.userBlue.base} borderColor={palette.userBlue.border50} bg={palette.userBlue.bgDark}>
        <View style={s.userHeader}>
          <UserAvatar size={16} />
          <Text style={s.userLabel}>USER</Text>
          <Text style={s.userTime}>{timestamp}</Text>
        </View>
        <ExpandableText text={text} style={s.userText} />
      </Card>
    </View>
  );
}

/* ── O2. ClaudeResponseCard ── */

export interface ClaudeResponseCardProps {
  text: string;
  timestamp: string;
  hasErrors?: boolean;
  /** TurnSummaryCard props — omit to skip the tool summary footer. */
  summary?: TurnSummaryCardProps;
  /** Expanded tool call rows rendered below the summary card. */
  children?: React.ReactNode;
}

export function ClaudeResponseCard({
  text,
  timestamp,
  hasErrors,
  summary,
  children,
}: ClaudeResponseCardProps) {
  return (
    <Card variant="accent" accentColor={hasErrors === true ? palette.red.base : C.brand} borderColor={hasErrors === true ? palette.red.dim25 : palette.brand.dim25} bg={palette.brand.dim06}>
      <View style={s.claudeHeader}>
        <ClaudeAvatar size={16} />
        <Text style={s.claudeLabel}>CLAUDE</Text>
        <Text style={s.claudeTime}>{timestamp}</Text>
      </View>
      {text.length > 0 && (
        <ExpandableText
          text={text}
          showMoreStyle={s.claudeShowMore}
          fade
          renderContent={(displayed) => <>{renderSimpleMarkdown(displayed)}</>}
        />
      )}
      {summary ? (
        <View style={s.toolSection}>
          <TurnSummaryCard {...summary} />
          {children}
        </View>
      ) : null}
    </Card>
  );
}

/* ── O3. ConversationTurn ── */

export interface ConversationTurnProps {
  userMessage?: string;
  userTimestamp: string;
  assistantResponse?: string;
  assistantTimestamp: string;
  hasErrors?: boolean;
  summary?: TurnSummaryCardProps;
  dimmed?: boolean;
  /** Expanded tool call rows passed through to ClaudeResponseCard. */
  children?: React.ReactNode;
}

export function ConversationTurn({
  userMessage,
  userTimestamp,
  assistantResponse,
  assistantTimestamp,
  hasErrors,
  summary,
  dimmed,
  children,
}: ConversationTurnProps) {
  return (
    <View style={[s.turn, dimmed === true && s.turnDimmed]}>
      {userMessage != null && userMessage.length > 0 && (
        <UserMessageCard text={userMessage} timestamp={userTimestamp} />
      )}
      {((assistantResponse != null && assistantResponse.length > 0) || summary != null) && (
        <ClaudeResponseCard
          text={assistantResponse ?? ''}
          timestamp={assistantTimestamp}
          hasErrors={hasErrors}
          summary={summary}
        >
          {children}
        </ClaudeResponseCard>
      )}
    </View>
  );
}

/* ── Styles ── */

const s = StyleSheet.create({
  /* User message card */
  userCardWrap: { marginBottom: 6 },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 7,
  },
  userLabel: {
    fontFamily: 'Space Grotesk',
    fontSize: 10,
    fontWeight: '600',
    color: component.userCard.labelColor,
    letterSpacing: 0.04 * 10,
    textTransform: 'uppercase',
  },
  userTime: {
    fontSize: 10,
    color: component.userCard.labelColor,
    fontFamily: 'Space Grotesk',
    marginLeft: 'auto' as unknown as number,
  },
  userText: { fontSize: 13, lineHeight: 20, color: semantic.text.primary },
  userShowMore: { fontSize: 11, color: semantic.role.user.text, marginTop: 5, opacity: 0.8 },

  /* Claude response card */
  claudeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  claudeLabel: {
    fontFamily: 'Space Grotesk',
    fontSize: 10,
    fontWeight: '600',
    color: component.claudeCard.labelColor,
    letterSpacing: 0.04 * 10,
    textTransform: 'uppercase',
    flex: 1,
  },
  claudeTime: {
    fontFamily: 'Space Grotesk',
    fontSize: 10,
    color: C.textTertiary,
  },
  claudeParaText: { fontSize: 13, lineHeight: 21, color: semantic.text.primary },
  claudeBoldText: { fontSize: 13, lineHeight: 21, color: semantic.text.primary, fontWeight: '700' },
  claudeCodeText: {
    fontSize: 11,
    color: C.textSecondary,
    fontFamily: 'monospace',
    backgroundColor: component.claudeCard.codeInlineBg,
    borderRadius: 3,
  },
  claudeParagraph: { marginTop: 8 },
  claudeTextTruncated: { maxHeight: 130, overflow: 'hidden' },
  claudeShowMore: { fontSize: 11, color: C.brand, marginTop: 6, opacity: 0.8 },

  /* Tool summary section inside claude card */
  toolSection: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: component.claudeCard.toolSectionBorder,
  },

  /* Conversation turn */
  turn: { marginBottom: 12 },
  turnDimmed: { opacity: 0.15 },

  /* Cross-view navigation links */
  taskRefLink: { color: C.brand, fontSize: 13, lineHeight: 21, cursor: 'pointer' as never },
});
