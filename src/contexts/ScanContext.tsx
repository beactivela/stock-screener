import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { API_BASE } from '../utils/api';

interface ScanProgress {
  index: number;
  total: number;
  vcpBullishCount: number;
  startedAt: string | null;
  completedAt: string | null;
}

interface ScanState {
  scanId: string | null;
  running: boolean;
  progress: ScanProgress;
}

interface ScanContextValue {
  scanState: ScanState;
  startScan: () => Promise<void>;
  checkProgress: () => Promise<void>;
}

const ScanContext = createContext<ScanContextValue | undefined>(undefined);

export function ScanProvider({ children }: { children: ReactNode }) {
  const [scanState, setScanState] = useState<ScanState>({
    scanId: null,
    running: false,
    progress: {
      index: 0,
      total: 0,
      vcpBullishCount: 0,
      startedAt: null,
      completedAt: null,
    },
  });

  // Check for active scan on mount
  useEffect(() => {
    const savedScan = localStorage.getItem('activeScan');
    if (savedScan) {
      try {
        const parsed = JSON.parse(savedScan);
        // Check if scan is still running on server
        fetch(`${API_BASE}/api/scan/progress`)
          .then((r) => r.json())
          .then((data) => {
            if (data.running && data.scanId === parsed.scanId) {
              setScanState({
                scanId: data.scanId,
                running: data.running,
                progress: data.progress,
              });
              // Start polling
              startPolling();
            } else {
              // Scan completed or doesn't match
              localStorage.removeItem('activeScan');
            }
          })
          .catch(() => {
            localStorage.removeItem('activeScan');
          });
      } catch {
        localStorage.removeItem('activeScan');
      }
    }
  }, []);

  // Persist scan state to localStorage
  useEffect(() => {
    if (scanState.running && scanState.scanId) {
      localStorage.setItem(
        'activeScan',
        JSON.stringify({
          scanId: scanState.scanId,
          startedAt: scanState.progress.startedAt,
        })
      );
    } else {
      localStorage.removeItem('activeScan');
    }
  }, [scanState.running, scanState.scanId, scanState.progress.startedAt]);

  const pollIntervalRef = useRef<number | null>(null);

  const startPolling = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/scan/progress`);
        const data = await response.json();
        
        setScanState({
          scanId: data.scanId,
          running: data.running,
          progress: data.progress,
        });

        // Stop polling if scan complete
        if (!data.running) {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch (error) {
        console.error('Failed to check scan progress:', error);
      }
    }, 1000); // Poll every second
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const checkProgress = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/scan/progress`);
      const data = await response.json();
      
      setScanState({
        scanId: data.scanId,
        running: data.running,
        progress: data.progress,
      });
    } catch (error) {
      console.error('Failed to check scan progress:', error);
    }
  };

  const startScan = async () => {
    // Optimistically mark as running so the progress bar appears immediately,
    // even before the server confirms the scanId via SSE.
    setScanState((prev) => ({
      ...prev,
      running: true,
      progress: {
        index: 0,
        total: 0,
        vcpBullishCount: 0,
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    }));

    try {
      const response = await fetch(`${API_BASE}/api/scan`, { method: 'POST' });

      // 429 + "already in progress": join the scan already running on the server (same tab double-submit or reconnect).
      if (response.status === 429) {
        let body: { error?: string; scanId?: string; progress?: ScanProgress } = {};
        try {
          body = await response.json();
        } catch {
          /* non-JSON 429 */
        }
        const errMsg = body.error || 'Too many requests';
        if (errMsg.includes('already in progress') && body.scanId) {
          setScanState({
            scanId: body.scanId,
            running: true,
            progress: {
              index: body.progress?.index ?? 0,
              total: body.progress?.total ?? 0,
              vcpBullishCount: body.progress?.vcpBullishCount ?? 0,
              startedAt: body.progress?.startedAt ?? null,
              completedAt: body.progress?.completedAt ?? null,
            },
          });
          startPolling();
          return;
        }
        setScanState((prev) => ({ ...prev, running: false }));
        throw new Error(errMsg);
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        // Reset optimistic state on failure
        setScanState((prev) => ({ ...prev, running: false }));
        throw new Error((error as { error?: string }).error || 'Scan failed to start');
      }

      if (!response.body) {
        setScanState((prev) => ({ ...prev, running: false }));
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let scanStarted = false;

      // Read chunks until we get the started event with the real scanId
      while (!scanStarted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          for (const line of lines) {
            const idx = line.indexOf('data: ');
            if (idx !== -1) {
              try {
                const msg = JSON.parse(line.slice(idx + 6).trim());
                if (msg.scanId && msg.started) {
                  setScanState({
                    scanId: msg.scanId,
                    running: true,
                    progress: {
                      index: 0,
                      total: 0,
                      vcpBullishCount: 0,
                      startedAt: msg.startedAt,
                      completedAt: null,
                    },
                  });
                  startPolling();
                  scanStarted = true;
                  break;
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }
      }

      // If we never got the started event, fall back to polling anyway
      if (!scanStarted) {
        startPolling();
      }

      // Close the stream - polling handles the rest
      reader.cancel();
    } catch (error) {
      console.error('Failed to start scan:', error);
      setScanState((prev) => ({ ...prev, running: false }));
      throw error;
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  return (
    <ScanContext.Provider value={{ scanState, startScan, checkProgress }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScan() {
  const context = useContext(ScanContext);
  if (context === undefined) {
    throw new Error('useScan must be used within a ScanProvider');
  }
  return context;
}
