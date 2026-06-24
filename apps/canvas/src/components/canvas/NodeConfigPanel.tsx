import React from 'react';
import type { Node } from 'reactflow';

interface NodeConfigPanelProps {
  node: Node | null;
  onConfigChange: (nodeId: string, config: Record<string, unknown>) => void;
}

export function NodeConfigPanel({ node, onConfigChange }: NodeConfigPanelProps) {
  if (!node) {
    return (
      <div style={{ width: '300px', borderLeft: '1px solid #e5e7eb', padding: '16px', color: '#6b7280' }}>
        Select a node to configure
      </div>
    );
  }

  const config = (node.data.config ?? {}) as Record<string, unknown>;

  const handleChange = (key: string, value: string) => {
    onConfigChange(node.id, { ...config, [key]: value });
  };

  return (
    <div style={{ width: '300px', borderLeft: '1px solid #e5e7eb', padding: '16px', overflowY: 'auto' }}>
      <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', fontWeight: 600 }}>{node.data.label}</h3>
      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '16px' }}>{node.type}</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>Label</label>
          <input
            type="text"
            value={(node.data.label as string) ?? ''}
            onChange={(e) => handleChange('label', e.target.value)}
            style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #d1d5db' }}
          />
        </div>

        {Object.entries(config).map(([key, value]) => (
          <div key={key}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>
              {key}
            </label>
            <input
              type="text"
              value={typeof value === 'string' ? value : JSON.stringify(value)}
              onChange={(e) => handleChange(key, e.target.value)}
              style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid #d1d5db', fontFamily: 'monospace', fontSize: '12px' }}
            />
          </div>
        ))}

        {node.data.retry && (
          <div style={{ marginTop: '8px', padding: '8px', background: '#f9fafb', borderRadius: '6px' }}>
            <div style={{ fontSize: '12px', fontWeight: 500, marginBottom: '4px' }}>Retry Configuration</div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              Max attempts: {(node.data.retry as any).max_attempts ?? 3}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280' }}>
              Backoff: {(node.data.retry as any).backoff ?? 'exponential'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
