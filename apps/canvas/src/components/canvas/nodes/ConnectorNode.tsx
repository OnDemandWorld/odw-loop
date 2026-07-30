import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

// Agent identity colors (legible on both light and dark surfaces)
const COLORS: Record<string, string> = {
  vault: '#3b82f6',
  desk: '#10b981',
  recap: '#8b5cf6',
  generic: '#78716c',
};

export const ConnectorNode = memo(({ data, selected }: NodeProps) => {
  const color = COLORS[data.connectorType as string] ?? '#78716c';

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: '8px',
        background: 'var(--rf-panel)',
        border: `1px solid ${selected ? color : 'var(--rf-border)'}`,
        borderLeft: `3px solid ${color}`,
        color: 'rgb(var(--ink-100))',
        fontSize: '13px',
        fontWeight: 500,
        minWidth: '150px',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ marginBottom: '4px', fontSize: '10px', fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {data.connectorType}
      </div>
      <div>{data.label}</div>
      <div style={{ marginTop: '4px', fontSize: '10px', color: 'rgb(var(--ink-400))', fontFamily: 'JetBrains Mono, monospace' }}>
        {data.operation}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

ConnectorNode.displayName = 'ConnectorNode';
