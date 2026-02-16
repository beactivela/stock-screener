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

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    try {
      const response = await fetch(`${API_BASE}/api/scan`, { method: 'POST' });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Scan failed to start');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Read initial response to get scan ID
      const { value } = await reader.read();
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
                // Start polling for progress
                startPolling();
                break;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Close the stream - we'll poll for progress instead
      reader.cancel();
    } catch (error) {
      console.error('Failed to start scan:', error);
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
