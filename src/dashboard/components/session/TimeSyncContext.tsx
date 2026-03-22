import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const TimeSyncContext = createContext<string>('');

interface Props {
  initialTimestamp: string;
  timelineRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export function TimeSyncProvider({ initialTimestamp, timelineRef, children }: Props) {
  const [currentTs, setCurrentTs] = useState(initialTimestamp);
  const rafRef = useRef(false);
  const lastTsRef = useRef<string | null>(null);

  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = true;
    requestAnimationFrame(() => {
      rafRef.current = false;
      const ts = getVisibleTimestamp(timelineRef.current);
      if (ts && ts !== lastTsRef.current) {
        lastTsRef.current = ts;
        setCurrentTs(ts);
      }
    });
  }, [timelineRef]);

  useEffect(() => {
    const el = timelineRef.current;
    el?.addEventListener('scroll', onScroll);
    return () => el?.removeEventListener('scroll', onScroll);
  }, [onScroll, timelineRef]);

  return (
    <TimeSyncContext.Provider value={currentTs}>
      {children}
    </TimeSyncContext.Provider>
  );
}

export function useCurrentTimestamp(): string {
  return useContext(TimeSyncContext);
}

function getVisibleTimestamp(container: HTMLElement | null): string | null {
  if (!container) return null;
  const rect = container.getBoundingClientRect();
  const threshold = rect.top + 60;
  const turns = container.querySelectorAll('[data-timestamp]');
  for (let i = 0; i < turns.length; i++) {
    const el = turns[i] as HTMLElement;
    if (el.getBoundingClientRect().bottom > threshold) {
      return el.dataset.timestamp ?? null;
    }
  }
  return null;
}
