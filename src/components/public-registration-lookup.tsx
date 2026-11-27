'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, read } from './client';
import { useWorkspace } from './shell';
import { Button } from './ui';

type JobStatus = {
  status: 'queued' | 'running' | 'completed' | 'failed';
  updated: number;
  unchanged: number;
  unavailable: number;
  error: string | null;
};

export function PublicRegistrationLookup() {
  const workspace = useWorkspace();
  const query = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const { data, refetch } = useQuery({
    queryKey: ['public-registration', workspace.id],
    queryFn: () => read<JobStatus | null>('view=publicRegistration'),
    refetchInterval: ({ state }) =>
      state.data?.status === 'queued' || state.data?.status === 'running' ? 4000 : false,
  });
  const status = data?.status;
  const updated = data?.updated;
  useEffect(() => {
    if (updated || status === 'completed') {
      void query.invalidateQueries({ queryKey: ['domains'] });
      void query.invalidateQueries({ queryKey: ['summary'] });
    }
  }, [query, status, updated]);

  async function start() {
    setSubmitting(true);
    try {
      const result = await api<{ queued: boolean }>('registration.publicLookup', {});
      await refetch();
      toast.info(
        result.queued ? 'Registration lookup queued' : 'A registration lookup is already queued',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not queue the lookup.');
    } finally {
      setSubmitting(false);
    }
  }

  const active = status === 'queued' || status === 'running';
  return (
    <div>
      {workspace.role !== 'VIEWER' && (
        <Button onClick={() => void start()} disabled={submitting || active}>
          Fetch missing registration details
        </Button>
      )}
      {data && (
        <small className="muted" role="status" style={{ display: 'block' }}>
          {status === 'failed'
            ? data.error
            : status === 'queued' && !data.updated && !data.unchanged && !data.unavailable
              ? 'Waiting to check registration details'
              : `${status === 'completed' ? 'Finished' : 'In progress'} · ${data.updated} updated · ${data.unchanged} unchanged · ${data.unavailable} unavailable`}
        </small>
      )}
    </div>
  );
}
