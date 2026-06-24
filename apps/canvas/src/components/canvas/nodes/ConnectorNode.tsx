import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

const COLORS: Record<string, string> = {
  vault: '#3b82f6',
  desk: '#10b981',
  recap: '#8b5cf6',
  generic: '#6b7280',
};

export const ConnectorNode = memo(({ data, type }: NodeProps) => {
  const color = COLORS[data.connectorType as string] ?? '#6b7280';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: color,
        color: 'white',
        fontSize: '14px',
        fontWeight: 500,
        minWidth: '150px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ marginBottom: '4px', fontSize: '10px', opacity: 0.8 }}>
        {data.connectorType}
      </div>
      <div>{data.label}</div>
      <div style={{ marginTop: '4px', fontSize: '10px', opacity: 0.7 }}>
        {data.operation}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

ConnectorNode.displayName = 'ConnectorNode';
