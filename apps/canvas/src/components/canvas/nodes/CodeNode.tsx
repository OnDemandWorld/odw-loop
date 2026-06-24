import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

export const CodeNode = memo(({ data }: NodeProps) => {
  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: '#1f2937',
        color: '#10b981',
        fontSize: '14px',
        fontWeight: 500,
        fontFamily: 'monospace',
        minWidth: '150px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: '10px', opacity: 0.7, marginBottom: '4px' }}>
        {data.language ?? 'typescript'}
      </div>
      <div>{data.label ?? 'Code'}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

CodeNode.displayName = 'CodeNode';
