import { useEffect, useRef } from 'react';
import { useStore } from '@/utils/store';

const WS_URL = `${process.env.NEXT_PUBLIC_WS_BASE_URL || 'ws://localhost:8000'}/ws`;
const PING_INTERVAL_MS = 25_000;  // send ping every 25s to keep connection alive
const RECONNECT_BASE_MS = 1_000;  // first retry after 1s
const RECONNECT_MAX_MS  = 30_000; // cap at 30s

// Global event emitter for JobLens step updates
type JobLensEventType =
    | 'joblens_step_started'
    | 'joblens_step_complete'
    | 'joblens_step_failed'
    | 'joblens_pipeline_complete'
    | 'joblens_pipeline_failed';

type JobLensHandler = (data: Record<string, unknown>) => void;

const joblensListeners: Map<string, Set<JobLensHandler>> = new Map();

export function subscribeToJobLens(sessionId: string, handler: JobLensHandler): () => void {
    if (!joblensListeners.has(sessionId)) {
        joblensListeners.set(sessionId, new Set());
    }
    joblensListeners.get(sessionId)!.add(handler);
    return () => {
        joblensListeners.get(sessionId)?.delete(handler);
    };
}

function emitJobLens(sessionId: string, data: Record<string, unknown>) {
    joblensListeners.get(sessionId)?.forEach(fn => fn(data));
}

export function useGlobalWebSocket() {
    const { token } = useStore();
    const wsRef      = useRef<WebSocket | null>(null);
    const aliveRef   = useRef(true);   // false after unmount — stops reconnect loop
    const retryDelay = useRef(RECONNECT_BASE_MS);
    const pingTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!token) return;
        aliveRef.current = true;

        function clearTimers() {
            if (pingTimer.current)  { clearInterval(pingTimer.current);  pingTimer.current  = null; }
            if (retryTimer.current) { clearTimeout(retryTimer.current);  retryTimer.current = null; }
        }

        function connect() {
            if (!aliveRef.current) return;

            const ws = new WebSocket(`${WS_URL}/${token}`);
            wsRef.current = ws;

            ws.onopen = () => {
                retryDelay.current = RECONNECT_BASE_MS; // reset backoff on successful connect

                // Heartbeat — keeps proxy / server from closing idle connection
                pingTimer.current = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send('ping');
                    }
                }, PING_INTERVAL_MS);
            };

            ws.onmessage = (event) => {
                if (event.data === 'pong') return; // heartbeat reply — ignore

                try {
                    const data = JSON.parse(event.data);
                    const joblensTypes: JobLensEventType[] = [
                        'joblens_step_started',
                        'joblens_step_complete',
                        'joblens_step_failed',
                        'joblens_pipeline_complete',
                        'joblens_pipeline_failed',
                    ];
                    if (joblensTypes.includes(data.type) && data.session_id) {
                        emitJobLens(data.session_id, data);
                    }
                } catch (err) {
                    console.error('[WebSocket] Parse error:', err);
                }
            };

            ws.onerror = () => {
                // onclose will fire immediately after, which handles reconnect
            };

            ws.onclose = (evt) => {
                clearTimers();
                if (!aliveRef.current) return; // intentional close on unmount

                // Don't reconnect on auth failure
                if (evt.code === 4001) return;

                console.log(`[WebSocket] Disconnected (code ${evt.code}), reconnecting in ${retryDelay.current}ms…`);
                retryTimer.current = setTimeout(() => {
                    retryDelay.current = Math.min(retryDelay.current * 2, RECONNECT_MAX_MS);
                    connect();
                }, retryDelay.current);
            };
        }

        connect();

        return () => {
            aliveRef.current = false;
            clearTimers();
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
        };
    }, [token]);

    return wsRef;
}
