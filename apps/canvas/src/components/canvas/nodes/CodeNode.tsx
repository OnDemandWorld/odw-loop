import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

const CODE_COLOR = '#ec4899';

export const CodeNode = memo(({ data, selected }: NodeProps) => {
  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: '8px',
        background: 'var(--rf-panel)',
        border: `1px solid ${selected ? CODE_COLOR : 'var(--rf-border)'}`,
        borderLeft: `3px solid ${CODE_COLOR}`,
        color: 'rgb(var(--ink-100))',
        fontSize: '13px',
        fontWeight: 500,
        fontFamily: 'JetBrains Mono, monospace',
        minWidth: '150px',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: '10px', color: CODE_COLOR, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {data.language ?? 'typescript'}
      </div>
      <div>{data.label ?? 'Code'}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

CodeNode.displayName = 'CodeNode';
