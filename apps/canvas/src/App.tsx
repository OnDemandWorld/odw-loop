import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Dashboard } from './pages/Dashboard';
import { Workflows } from './pages/Workflows';
import { WorkflowEditor } from './pages/WorkflowEditor';
import { Executions } from './pages/Executions';
import { ExecutionDetail } from './pages/ExecutionDetail';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Pages rendered inside the app shell (sidebar + outlet) */}
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workflows" element={<Workflows />} />
          <Route path="/executions" element={<Executions />} />
          <Route path="/executions/:id" element={<ExecutionDetail />} />
        </Route>

        {/* Full-bleed editor (no shell chrome) */}
        <Route path="/workflows/:id" element={<WorkflowEditor />} />
      </Routes>
    </BrowserRouter>
  );
}
