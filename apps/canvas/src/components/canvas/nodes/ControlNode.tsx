import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';

const ICONS: Record<string, string> = {
  branch: '⑂',
  loop: '↻',
  parallel: '⇉',
  approval: '✓',
  delay: '⏱',
};

const CONTROL_COLOR = '#f59e0b';

export const ControlNode = memo(({ data, selected }: NodeProps) => {
  const icon = ICONS[data.controlType as string] ?? '⚙';

  return (
    <div
      style={{
        padding: '10px 14px',
        borderRadius: '8px',
        background: 'var(--rf-panel)',
        border: `1px solid ${selected ? CONTROL_COLOR : 'var(--rf-border)'}`,
        borderLeft: `3px solid ${CONTROL_COLOR}`,
        color: 'rgb(var(--ink-100))',
        fontSize: '13px',
        fontWeight: 500,
        minWidth: '120px',
        textAlign: 'center',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: '18px', marginBottom: '4px', color: CONTROL_COLOR }}>{icon}</div>
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
