import React, { useEffect, useState } from 'react';

interface NodeStatus {
  node_id: string;
  node_type: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  output?: Record<string, unknown>;
  error?: string;
}

interface ExecutionMonitorProps {
  executionId: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#9ca3af',
  running: '#3b82f6',
  succeeded: '#10b981',
  failed: '#ef4444',
  skipped: '#f59e0b',
};

export function ExecutionMonitor({ executionId }: ExecutionMonitorProps) {
  const [execution, setExecution] = useState<any>(null);
  const [nodes, setNodes] = useState<NodeStatus[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Connect to WebSocket for live updates
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/executions/${executionId}`);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case 'node_started':
          setNodes((prev) => [...prev.filter((n) => n.node_id !== message.node_id), { node_id: message.node_id, node_type: message.node_type, status: 'running', started_at: message.timestamp, completed_at: null }]);
          break;
        case 'node_completed':
          setNodes((prev) => prev.map((n) => n.node_id === message.node_id ? { ...n, status: message.status, completed_at: message.timestamp, output: message.output, error: message.error } : n));
          break;
        case 'execution_completed':
          setExecution((prev: any) => prev ? { ...prev, status: message.status } : null);
          break;
      }
    };

    ws.onerror = () => setError('WebSocket connection failed');
    ws.onclose = () => {};

    // Also fetch initial state via REST
    fetch(`/api/v1/executions/${executionId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setExecution(data.data);
          setNodes(data.data.nodes ?? []);
        }
      })
      .catch(() => setError('Failed to load execution'));

    return () => ws.close();
  }, [executionId]);

  if (error) return <div style={{ padding: '16px', color: '#ef4444' }}>{error}</div>;
  if (!execution) return <div style={{ padding: '16px' }}>Loading...</div>;

  return (
    <div style={{ padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <h2 style={{ margin: 0, fontSize: '20px' }}>Execution {executionId.slice(0, 8)}</h2>
        <span style={{ padding: '4px 8px', borderRadius: '4px', background: STATUS_COLORS[execution.status], color: 'white', fontSize: '12px' }}>
          {execution.status}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px', fontSize: '13px' }}>
        <div>Workflow: {execution.workflow_id?.slice(0, 8)}</div>
        <div>Version: {execution.workflow_version}</div>
        <div>Trigger: {execution.trigger_type}</div>
        <div>Duration: {execution.duration_ms ? `${execution.duration_ms}ms` : '—'}</div>
      </div>

      <h3 style={{ fontSize: '16px', marginBottom: '8px' }}>Nodes</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {nodes.map((node) => (
          <div key={node.node_id} style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: STATUS_COLORS[node.status] }} />
            <span style={{ fontWeight: 500, fontSize: '13px' }}>{node.node_id}</span>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>{node.node_type}</span>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#6b7280' }}>
              {node.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
