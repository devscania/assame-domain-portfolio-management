'use client';
import { useState } from 'react';
import { api } from './client';
import { Button } from './ui';
export function OpenWorkspace({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            await api('workspace.switch', { id });
            window.location.assign('/overview');
          } catch (problem) {
            setError(problem instanceof Error ? problem.message : 'Unable to open workspace.');
            setBusy(false);
          }
        }}
      >
        Open workspace
      </Button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
