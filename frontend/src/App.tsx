import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import LiftSelection from './pages/LiftSelection';
import SnapshotEntry from './pages/SnapshotEntry';
import DiagnosticChat from './pages/DiagnosticChat';
import PlanOutput from './pages/PlanOutput';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/select" element={<LiftSelection />} />
        <Route path="/snapshot/:sessionId" element={<SnapshotEntry />} />
        <Route path="/diagnostic/:sessionId" element={<DiagnosticChat />} />
        <Route path="/plan/:sessionId" element={<PlanOutput />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
