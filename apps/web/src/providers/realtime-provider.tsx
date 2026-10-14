'use client';
import type { NetworkStatusResponse, RealtimeExplorerEvent } from '@blockchain-explorer/contracts/browser';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useResource } from '@/hooks/use-resource';
import { advancedExplorerApi } from '@/lib/api/advanced-explorer.api';
import { RealtimeClient, type ConnectionState } from '@/lib/realtime/realtime-client';
interface LiveContext { state: ConnectionState; network: NetworkStatusResponse | null; networkUnavailable: boolean; reorg: string | null; subscribe: (callback: (event: RealtimeExplorerEvent) => void) => () => void; }
const Context = createContext<LiveContext | null>(null);
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [reorg, setReorg] = useState<string | null>(null);
  const listeners = useRef(new Set<(event: RealtimeExplorerEvent) => void>());
  const load = useCallback((signal: AbortSignal) => advancedExplorerApi.networkStatus(signal), []);
  const network = useResource(load, { pollInterval: 30000 });
  const reloadNetwork = network.reload;
  const subscribe = useCallback((callback: (event: RealtimeExplorerEvent) => void) => { listeners.current.add(callback); return () => { listeners.current.delete(callback); }; }, []);
  useEffect(() => {
    let statusTimer: ReturnType<typeof setTimeout> | undefined;
    let noticeTimer: ReturnType<typeof setTimeout> | undefined;
    const client = new RealtimeClient(process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3000/realtime', setState, event => {
      if (event.type === 'chain.reorganized') { setReorg(event.payload.commonAncestorBlock); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => setReorg(null), 60000); }
      if (event.type !== 'token.transfer.indexed' && !statusTimer) statusTimer = setTimeout(() => { statusTimer = undefined; reloadNetwork(); }, 1000);
      for (const listener of listeners.current) listener(event);
    });
    const online = () => client.setOnline(true), offline = () => client.setOnline(false);
    window.addEventListener('online', online); window.addEventListener('offline', offline);
    client.start(navigator.onLine);
    return () => { client.stop(); clearTimeout(statusTimer); clearTimeout(noticeTimer); window.removeEventListener('online', online); window.removeEventListener('offline', offline); };
  }, [reloadNetwork]);
  const value = useMemo(() => ({ state, network: network.data, networkUnavailable: Boolean(network.error), reorg, subscribe }), [state, network.data, network.error, reorg, subscribe]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useRealtime(): LiveContext { const context = useContext(Context); if (!context) throw new Error('RealtimeProvider is required'); return context; }
export function useRealtimeRefresh(predicate: (event: RealtimeExplorerEvent) => boolean, reload: () => void): void {
  const { subscribe, state } = useRealtime();
  const previous = useRef(state);
  useEffect(() => { if (state === 'live' && previous.current !== 'live') reload(); previous.current = state; }, [state, reload]);
  useEffect(() => { let timer: ReturnType<typeof setTimeout> | undefined; const unsubscribe = subscribe(event => { if (predicate(event) && !timer) timer = setTimeout(() => { timer = undefined; reload(); }, 350); }); return () => { unsubscribe(); clearTimeout(timer); }; }, [subscribe, predicate, reload]);
}
