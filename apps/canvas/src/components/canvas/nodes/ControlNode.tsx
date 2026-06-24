import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

const ICONS: Record<string, string> = {
  branch: '⑂',
  loop: '↻',
  parallel: '⇉',
  approval: '✓',
  delay: '⏱',
};

export const ControlNode = memo(({ data }: NodeProps) => {
  const icon = ICONS[data.controlType as string] ?? '⚙';

  return (
    <div
      style={{
        padding: '12px 16px',
        borderRadius: '8px',
        background: '#f59e0b',
        color: 'white',
        fontSize: '14px',
        fontWeight: 500,
        minWidth: '120px',
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: '20px', marginBottom: '4px' }}>{icon}</div>
      <div>{data.label}</div>
      {data.controlType === 'branch' && (
        <>
          <Handle type="source" position={Position.Right} id="true" style={{ top: '30%' }} />
          <Handle type="source" position={Position.Right} id="false" style={{ top: '70%' }} />
        </>
      )}
      {data.controlType !== 'branch' && <Handle type="source" position={Position.Right} />}
    </div>
  );
});

ControlNode.displayName = 'ControlNode';
