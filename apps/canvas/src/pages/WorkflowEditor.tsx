import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactFlow, {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { ConnectorNode } from '../components/canvas/nodes/ConnectorNode';
import { ControlNode } from '../components/canvas/nodes/ControlNode';
import { CodeNode } from '../components/canvas/nodes/CodeNode';
import { api, nodeTypeColor, shortId, type Workflow, type WorkflowDefinition } from '../lib/api';
import { Icon, LoadingBlock, StatusBadge } from '../components/ui';
import { ThemeToggle } from '../components/ThemeToggle';
import { useTheme } from '../lib/theme';

const nodeTypes = { connector: ConnectorNode, control: ControlNode, code: CodeNode };

interface PaletteItem {
  type: string;
  category: string;
  label: string;
  icon: string;
}

const PALETTE: PaletteItem[] = [
  { type: 'vault.search', category: 'Vault', label: 'Search Documents', icon: '🔍' },
  { type: 'vault.create_document', category: 'Vault', label: 'Create Document', icon: '📄' },
  { type: 'vault.rag_query', category: 'Vault', label: 'RAG Query', icon: '🧠' },
  { type: 'desk.create_task', category: 'Desk', label: 'Create Task', icon: '✅' },
  { type: 'desk.create_project', category: 'Desk', label: 'Create Project', icon: '📁' },
  { type: 'desk.send_notification', category: 'Desk', label: 'Send Notification', icon: '🔔' },
  { type: 'recap.extract_action_items', category: 'Recap', label: 'Extract Actions', icon: '📋' },
  { type: 'recap.summarize', category: 'Recap', label: 'Summarize', icon: '📝' },
  { type: 'generic.rest_call', category: 'Generic', label: 'REST Call', icon: '🌐' },
  { type: 'control.branch', category: 'Control', label: 'Branch', icon: '⑂' },
  { type: 'control.loop', category: 'Control', label: 'Loop', icon: '↻' },
  { type: 'control.parallel', category: 'Control', label: 'Parallel', icon: '⇉' },
  { type: 'control.approval', category: 'Control', label: 'Approval', icon: '✓' },
  { type: 'control.delay', category: 'Control', label: 'Delay', icon: '⏱' },
  { type: 'code.typescript', category: 'Code', label: 'TypeScript', icon: 'TS' },
];

function rfKind(type: string): 'connector' | 'control' | 'code' {
  if (type.startsWith('control.')) return 'control';
  if (type.startsWith('code.')) return 'code';
  return 'connector';
}

function toRfNode(n: WorkflowDefinition['nodes'][number], index: number): Node {
  const [prefix = '', operation = ''] = n.type.split('.');
  const kind = rfKind(n.type);
  const base = {
    id: n.id,
    position: n.position ?? { x: index * 220, y: 80 },
    selected: false,
  };
  if (kind === 'control') {
    return { ...base, type: 'control', data: { controlType: operation, label: operation, config: n.config } };
  }
  if (kind === 'code') {
    return { ...base, type: 'code', data: { language: operation, label: n.id, config: n.config } };
  }
  return {
    ...base,
    type: 'connector',
    data: { connectorType: prefix, operation, label: operation.replace(/_/g, ' '), config: n.config },
  };
}

function toRfEdge(e: WorkflowDefinition['edges'][number]): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.source_port && e.source_port !== 'output' ? e.source_port : undefined,
    targetHandle: e.target_port && e.target_port !== 'input' ? e.target_port : undefined,
    animated: true,
  };
}

function ConfigPanel({
  node,
  onChange,
  onDelete,
}: {
  node: Node;
  onChange: (id: string, config: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const config = (node.data.config ?? {}) as Record<string, unknown>;
  const [draft, setDraft] = useState<string>(() => JSON.stringify(config, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(JSON.stringify(config, null, 2));
    setParseError(null);
  }, [node.id]);

  const apply = () => {
    try {
      const parsed = JSON.parse(draft) as Record<string, unknown>;
      setParseError(null);
      onChange(node.id, parsed);
    } catch (e) {
      setParseError('Invalid JSON');
    }
  };

  return (
    <div className="w-72 shrink-0 border-l border-ink-700/60 bg-ink-900/60 backdrop-blur-md flex flex-col">
      <div className="px-4 py-3.5 border-b border-ink-700/60">
        <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500">
          Node config
        </div>
        <div className="font-display font-semibold text-ink-100 mt-0.5 flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ background: nodeTypeColor(String(node.data.connectorType ?? node.data.controlType ?? 'code')) }}
          />
          {node.id}
        </div>
        <div className="font-mono text-[11px] text-ink-400 mt-0.5">
          {node.type === 'connector'
            ? `${node.data.connectorType}.${node.data.operation}`
            : node.type === 'control'
              ? `control.${node.data.controlType}`
              : 'code'}
        </div>
      </div>
      <div className="flex-1 p-4 overflow-y-auto">
        <label className="block text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-1.5">
          Config (JSON)
        </label>
        <textarea
          className="input font-mono text-xs resize-none"
          rows={14}
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {parseError && <div className="text-xs text-bad mt-1.5">{parseError}</div>}
        <div className="text-[11px] text-ink-500 mt-3 leading-relaxed">
          Reference outputs with{' '}
          <code className="font-mono text-volt">{'{{node_id.output.field}}'}</code> and trigger data with{' '}
          <code className="font-mono text-volt">{'{{trigger.payload.x}}'}</code>.
        </div>
      </div>
      <div className="p-4 border-t border-ink-700/60 space-y-2">
        <button className="btn-primary w-full justify-center" onClick={apply}>
          <Icon name="check" />
          Apply config
        </button>
        <button className="btn-danger w-full justify-center" onClick={() => onDelete(node.id)}>
          <Icon name="trash" />
          Delete node
        </button>
      </div>
    </div>
  );
}

export function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getWorkflow(id)
      .then((wf) => {
        setWorkflow(wf);
        const def = wf.definition;
        setNodes((def?.nodes ?? []).map(toRfNode));
        setEdges((def?.edges ?? []).map(toRfEdge));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [id, setNodes, setEdges]);

  const showToast = useCallback((kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: `edge_${Date.now()}`,
            animated: true,
          },
          eds,
        ),
      );
      setDirty(true);
    },
    [setEdges],
  );

  const addNode = useCallback(
    (item: PaletteItem) => {
      const idx = nodes.length;
      const nodeId = `node_${idx + 1}`;
      const kind = rfKind(item.type);
      const [prefix, operation] = item.type.split('.');
      const newNode: Node =
        kind === 'control'
          ? {
              id: nodeId,
              type: 'control',
              position: { x: 80 + (idx % 4) * 220, y: 80 + Math.floor(idx / 4) * 140 },
              data: { controlType: operation, label: operation, config: {} },
            }
          : kind === 'code'
            ? {
                id: nodeId,
                type: 'code',
                position: { x: 80 + (idx % 4) * 220, y: 80 + Math.floor(idx / 4) * 140 },
                data: { language: operation, label: nodeId, config: {} },
              }
            : {
                id: nodeId,
                type: 'connector',
                position: { x: 80 + (idx % 4) * 220, y: 80 + Math.floor(idx / 4) * 140 },
                data: { connectorType: prefix, operation, label: item.label, config: {} },
              };
      setNodes((nds) => [...nds, newNode]);
      setDirty(true);
      setSelectedId(nodeId);
    },
    [nodes.length, setNodes],
  );

  const updateNodeConfig = useCallback(
    (nodeId: string, config: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config } } : n)),
      );
      setDirty(true);
      showToast('ok', 'Config applied');
    },
    [setNodes, showToast],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId(null);
      setDirty(true);
    },
    [setNodes, setEdges],
  );

  const buildDefinition = useCallback((): WorkflowDefinition => {
    return {
      version: workflow?.definition?.version ?? '1.0',
      nodes: nodes.map((n) => ({
        id: n.id,
        type:
          n.type === 'control'
            ? `control.${n.data.controlType}`
            : n.type === 'code'
              ? `code.${n.data.language ?? 'typescript'}`
              : `${n.data.connectorType}.${n.data.operation}`,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        config: (n.data.config ?? {}) as Record<string, unknown>,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        source_port: e.sourceHandle ?? 'output',
        target: e.target,
        target_port: e.targetHandle ?? 'input',
      })),
      variables: workflow?.definition?.variables ?? {},
      metadata: workflow?.definition?.metadata ?? { name: workflow?.name ?? '', description: '', tags: [] },
    };
  }, [nodes, edges, workflow]);

  const save = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const definition = buildDefinition();
      await api.updateWorkflow(id, { definition });
      setDirty(false);
      showToast('ok', 'Workflow saved');
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [id, buildDefinition, showToast]);

  const validate = useCallback(async () => {
    if (!id) return;
    try {
      if (dirty) await save();
      const result = await api.validateWorkflow(id);
      setValidation(result);
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  }, [id, dirty, save, showToast]);

  const run = useCallback(async () => {
    if (!id) return;
    try {
      if (dirty) await save();
      const result = await api.executeWorkflow(id);
      showToast('ok', `Execution ${shortId(result.execution_id)} started`);
    } catch (e) {
      showToast('err', e instanceof Error ? e.message : String(e));
    }
  }, [id, dirty, save, showToast]);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);
  const categories = useMemo(() => [...new Set(PALETTE.map((p) => p.category))], []);
  const dark = useTheme() === 'dark';

  if (loadError) {
    return (
      <div className="p-8">
        <div className="text-bad text-sm">Failed to load workflow: {loadError}</div>
        <Link to="/workflows" className="btn-ghost mt-4 inline-flex">
          <Icon name="arrowLeft" /> Back to workflows
        </Link>
      </div>
    );
  }
  if (!workflow) return <LoadingBlock label="Loading editor…" />;

  return (
    <div className="h-screen flex flex-col">
      {/* ── Editor toolbar ──────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 border-b border-ink-700/60 bg-ink-900/70 backdrop-blur-md">
        <Link to="/workflows" className="btn-ghost !px-2.5" title="Back">
          <Icon name="arrowLeft" />
        </Link>
        <div className="min-w-0">
          <div className="font-display font-semibold text-ink-100 truncate">{workflow.name}</div>
          <div className="font-mono text-[10px] text-ink-500">
            v{workflow.version} · {nodes.length} nodes · {edges.length} edges
          </div>
        </div>
        <StatusBadge status={workflow.status} />
        {dirty && <span className="tag text-warn border-warn/40">unsaved</span>}

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <button className="btn-ghost" onClick={validate}>
            <Icon name="check" />
            Validate
          </button>
          <button className="btn-ghost" onClick={run}>
            <Icon name="play" />
            Run
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Validation banner ───────────────────────────────────────────── */}
      {validation && (
        <div
          className={
            'shrink-0 px-5 py-2.5 text-sm border-b flex items-center gap-3 animate-fade-in ' +
            (validation.valid
              ? 'bg-good/10 border-good/30 text-good'
              : 'bg-bad/10 border-bad/30 text-bad')
          }
        >
          <Icon name={validation.valid ? 'check' : 'x'} />
          <span>
            {validation.valid ? 'Topology valid' : `Invalid: ${validation.errors.join('; ')}`}
            {validation.warnings.length > 0 && (
              <span className="text-ink-400"> · {validation.warnings.length} warning(s)</span>
            )}
          </span>
          <button className="ml-auto text-ink-400 hover:text-ink-200" onClick={() => setValidation(null)}>
            <Icon name="x" />
          </button>
        </div>
      )}

      {/* ── Body: palette + canvas + config ─────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* Palette */}
        <div className="w-56 shrink-0 border-r border-ink-700/60 bg-ink-900/60 backdrop-blur-md overflow-y-auto">
          <div className="px-4 py-3.5 border-b border-ink-700/60">
            <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500">
              Node palette
            </div>
            <div className="text-[11px] text-ink-400 mt-1">Click a node to add it to the canvas.</div>
          </div>
          {categories.map((cat) => (
            <div key={cat} className="px-4 py-3">
              <div className="text-[10px] font-display font-semibold uppercase tracking-widest text-ink-500 mb-2">
                {cat}
              </div>
              <div className="space-y-1.5">
                {PALETTE.filter((p) => p.category === cat).map((item) => (
                  <button
                    key={item.type}
                    onClick={() => addNode(item)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md border border-ink-700/70 bg-ink-800/50 hover:border-ink-600 hover:bg-ink-750 hover:translate-x-0.5 transition-all text-left"
                  >
                    <span
                      className="w-6 h-6 rounded flex items-center justify-center text-xs shrink-0"
                      style={{ background: `${nodeTypeColor(item.type)}22`, color: nodeTypeColor(item.type) }}
                    >
                      {item.icon}
                    </span>
                    <span>
                      <span className="block text-xs font-medium text-ink-200">{item.label}</span>
                      <span className="block font-mono text-[10px] text-ink-500">{item.type}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Canvas */}
        <div className="flex-1 min-w-0 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={24}
              size={1.5}
              color={dark ? '#3a342e' : '#d6cfc0'}
            />
            <Controls />
            <MiniMap
              nodeColor={(n) =>
                n.type === 'control'
                  ? '#f59e0b'
                  : n.type === 'code'
                    ? '#ec4899'
                    : nodeTypeColor(String(n.data.connectorType))
              }
              maskColor={dark ? 'rgba(12,10,8,0.7)' : 'rgba(246,242,236,0.7)'}
            />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-ink-500">
                <div className="text-3xl mb-2">⑂</div>
                <div className="text-sm">Add nodes from the palette to start building</div>
              </div>
            </div>
          )}
        </div>

        {/* Config panel */}
        {selectedNode && (
          <ConfigPanel node={selectedNode} onChange={updateNodeConfig} onDelete={deleteNode} />
        )}
      </div>

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast && (
        <div
          className={
            'fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-md border text-sm font-medium animate-slide-up shadow-panel ' +
            (toast.kind === 'ok'
              ? 'bg-ink-800/95 border-good/40 text-good'
              : 'bg-ink-800/95 border-bad/40 text-bad')
          }
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
