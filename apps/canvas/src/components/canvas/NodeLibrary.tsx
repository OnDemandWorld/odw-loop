import React, { useState } from 'react';

interface NodeType {
  type: string;
  category: string;
  label: string;
  icon: string;
}

const NODE_CATALOG: NodeType[] = [
  // Connector nodes
  { type: 'vault.search', category: 'Vault', label: 'Search Documents', icon: '🔍' },
  { type: 'vault.create_document', category: 'Vault', label: 'Create Document', icon: '📄' },
  { type: 'vault.rag_query', category: 'Vault', label: 'RAG Query', icon: '🧠' },
  { type: 'desk.create_task', category: 'Desk', label: 'Create Task', icon: '✓' },
  { type: 'desk.create_project', category: 'Desk', label: 'Create Project', icon: '📁' },
  { type: 'desk.send_notification', category: 'Desk', label: 'Send Notification', icon: '🔔' },
  { type: 'recap.extract_action_items', category: 'Recap', label: 'Extract Action Items', icon: '📋' },
  { type: 'recap.summarize', category: 'Recap', label: 'Summarize', icon: '📝' },
  // Control nodes
  { type: 'control.branch', category: 'Control', label: 'Branch', icon: '⑂' },
  { type: 'control.loop', category: 'Control', label: 'Loop', icon: '↻' },
  { type: 'control.parallel', category: 'Control', label: 'Parallel', icon: '⇉' },
  { type: 'control.approval', category: 'Control', label: 'Approval', icon: '✓' },
  { type: 'control.delay', category: 'Control', label: 'Delay', icon: '⏱' },
  // Code nodes
  { type: 'code.typescript', category: 'Code', label: 'TypeScript', icon: 'TS' },
  { type: 'code.python', category: 'Code', label: 'Python', icon: 'PY' },
];

interface NodeLibraryProps {
  onNodeSelect?: (nodeType: NodeType) => void;
}

export function NodeLibrary({ onNodeSelect }: NodeLibraryProps) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = [...new Set(NODE_CATALOG.map((n) => n.category))];

  const filtered = NODE_CATALOG.filter((n) => {
    if (search && !n.label.toLowerCase().includes(search.toLowerCase()) && !n.type.toLowerCase().includes(search.toLowerCase())) return false;
    if (selectedCategory && n.category !== selectedCategory) return false;
    return true;
  });

  return (
    <div style={{ width: '250px', borderRight: '1px solid #e5e7eb', padding: '16px', overflowY: 'auto' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600 }}>Node Library</h3>
      <input
        type="text"
        placeholder="Search nodes..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #d1d5db', marginBottom: '12px' }}
      />
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
        <button
          onClick={() => setSelectedCategory(null)}
          style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', background: selectedCategory === null ? '#6366f1' : 'white', color: selectedCategory === null ? 'white' : 'inherit', cursor: 'pointer', fontSize: '12px' }}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #d1d5db', background: selectedCategory === cat ? '#6366f1' : 'white', color: selectedCategory === cat ? 'white' : 'inherit', cursor: 'pointer', fontSize: '12px' }}
          >
            {cat}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {filtered.map((node) => (
          <div
            key={node.type}
            onClick={() => onNodeSelect?.(node)}
            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', cursor: 'grab', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span style={{ fontSize: '16px' }}>{node.icon}</span>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500 }}>{node.label}</div>
              <div style={{ fontSize: '11px', color: '#6b7280' }}>{node.type}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
