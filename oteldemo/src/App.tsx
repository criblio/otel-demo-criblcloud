import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/AppShell';
import SearchPage from './routes/SearchPage';
import TraceView from './routes/TraceView';
import ComparePage from './routes/ComparePage';
import SystemArchPage from './routes/SystemArchPage';

export default function App() {
  return (
    <BrowserRouter basename={window.CRIBL_BASE_PATH ?? '/'}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/search" replace />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/trace/:traceId" element={<TraceView />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/compare/:idA/:idB" element={<ComparePage />} />
          <Route path="/architecture" element={<SystemArchPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
