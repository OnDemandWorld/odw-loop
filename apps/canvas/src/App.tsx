import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { Workflows } from './pages/Workflows';
import { Templates } from './pages/Templates';
import { WorkflowEditor } from './pages/WorkflowEditor';
import { Executions } from './pages/Executions';
import { ExecutionDetail } from './pages/ExecutionDetail';
import { Login } from './pages/Login';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth (audit #1) — full-bleed, no shell chrome */}
        <Route path="/login" element={<Login />} />
        {/* Pages rendered inside the app shell (sidebar + outlet) */}
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/executions" element={<Executions />} />
          <Route path="/executions/:id" element={<ExecutionDetail />} />
        </Route>

        {/* Full-bleed editor (no shell chrome) */}
        <Route path="/workflows/:id" element={<WorkflowEditor />} />
      </Routes>
    </BrowserRouter>
  );
}
