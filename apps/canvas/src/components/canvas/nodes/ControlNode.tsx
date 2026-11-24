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
      {/* Audit #24: render a handle per configured outgoing port for every
          control type (e.g. control.condition's auto_approve/needs_review),
          not just branch — otherwise port edges reference nonexistent handles
          and React Flow drops them. */}
      {data.controlType !== 'branch' && Array.isArray(data.ports) && data.ports.length > 0 &&
        (data.ports as string[]).map((port, i) => (
          <Handle
            key={port}
            type="source"
            position={Position.Right}
            id={port}
            style={{ top: `${((i + 1) * 100) / ((data.ports as string[]).length + 1)}%` }}
          />
        ))}
      {data.controlType !== 'branch' && (!Array.isArray(data.ports) || data.ports.length === 0) && (
        <Handle type="source" position={Position.Right} />
      )}
    </div>
  );
});

ControlNode.displayName = 'ControlNode';
