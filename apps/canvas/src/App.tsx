import { BrowserRouter, Routes, Route } from 'react-router-dom';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/workflows" element={<WorkflowList />} />
        <Route path="/workflows/:id" element={<WorkflowEditor />} />
        <Route path="/executions" element={<ExecutionList />} />
        <Route path="/executions/:id" element={<ExecutionDetail />} />
        <Route path="/admin" element={<AdminPanel />} />
      </Routes>
    </BrowserRouter>
  );
}

function Dashboard() { return <div><h1>Dashboard</h1><p>Metrics coming soon</p></div>; }
function WorkflowList() { return <div><h1>Workflows</h1></div>; }
function WorkflowEditor() { return <div><h1>Workflow Editor</h1><p>React Flow canvas coming soon</p></div>; }
function ExecutionList() { return <div><h1>Executions</h1></div>; }
function ExecutionDetail() { return <div><h1>Execution Detail</h1></div>; }
function AdminPanel() { return <div><h1>Admin</h1></div>; }
