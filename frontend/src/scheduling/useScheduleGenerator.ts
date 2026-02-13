import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProgressUpdate, ScheduleInput, ScheduleResult, WorkerOutMessage } from './types';

interface UseScheduleGeneratorReturn {
  /** Kick off schedule generation with the given inputs. */
  generate: (input: ScheduleInput) => void;
  /** Whether the worker is currently running. */
  isGenerating: boolean;
  /** Latest progress update from the worker, or null if idle. */
  progress: ProgressUpdate | null;
  /** The completed result, or null if not yet finished. */
  result: ScheduleResult | null;
  /** Error message if the worker failed. */
  error: string | null;
  /** Clear the result / error state to allow another generation. */
  reset: () => void;
}

export function useScheduleGenerator(): UseScheduleGeneratorReturn {
  const workerRef = useRef<Worker | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Clean up the worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const generate = useCallback((input: ScheduleInput) => {
    // Terminate any existing worker
    workerRef.current?.terminate();

    setIsGenerating(true);
    setProgress({ phase: 'Starting', percent: 0, message: 'Initializing worker...' });
    setResult(null);
    setError(null);

    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.addEventListener('message', (event: MessageEvent<WorkerOutMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'progress':
          setProgress(msg.payload);
          break;
        case 'complete':
          setResult(msg.payload);
          setIsGenerating(false);
          setProgress(null);
          break;
        case 'error':
          setError(msg.message);
          setIsGenerating(false);
          setProgress(null);
          break;
      }
    });

    worker.addEventListener('error', (event) => {
      setError(event.message || 'Worker encountered an unexpected error.');
      setIsGenerating(false);
      setProgress(null);
    });

    worker.postMessage({ type: 'generate', payload: input });
  }, []);

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsGenerating(false);
    setProgress(null);
    setResult(null);
    setError(null);
  }, []);

  return { generate, isGenerating, progress, result, error, reset };
}
