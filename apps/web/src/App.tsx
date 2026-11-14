import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { homePath, Layout } from './components/layout';
import { Loading } from './components/ui';
import { ApiError } from './lib/api';
import { SessionProvider, useMeQuery, useSession } from './lib/session';
import { Login } from './pages/Login';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Pos = lazy(() => import('./pages/Pos'));
const Products = lazy(() => import('./pages/Products'));
const Stock = lazy(() => import('./pages/Stock'));
const Transfers = lazy(() => import('./pages/Transfers'));
const WriteOffs = lazy(() => import('./pages/WriteOffs'));
const Counts = lazy(() => import('./pages/Counts'));
const CountDetail = lazy(() => import('./pages/CountDetail'));
const Purchasing = lazy(() => import('./pages/Purchasing'));
const Suppliers = lazy(() => import('./pages/Suppliers'));
const Customers = lazy(() => import('./pages/Customers'));
const Sales = lazy(() => import('./pages/Sales'));
const Reports = lazy(() => import('./pages/Reports'));
const Alerts = lazy(() => import('./pages/Alerts'));
const Audit = lazy(() => import('./pages/Audit'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const ReceiptPrint = lazy(() => import('./pages/ReceiptPrint'));

export function App() {
  const me = useMeQuery();
  if (me.isLoading) return <Loading rows={8} />;
  if (me.error instanceof ApiError && me.error.status === 401) return <Login />;
  if (me.error || !me.data) return <Login error={me.error} />;
  return (
    <SessionProvider me={me.data}>
      <Suspense fallback={<Loading rows={8} />}>
        <AppRoutes />
      </Suspense>
    </SessionProvider>
  );
}

function AppRoutes() {
  const { can } = useSession();
  return (
    <Routes>
      <Route path="/receipt/:id" element={<ReceiptPrint />} />
      <Route element={<Layout />}>
        <Route index element={can('reports.view') ? <Dashboard /> : <Navigate to={homePath(can)} replace />} />
        <Route path="pos" element={<Pos />} />
        <Route path="sales" element={<Sales />} />
        <Route path="sales/:id" element={<Sales />} />
        <Route path="products" element={<Products />} />
        <Route path="stock" element={<Stock />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="write-offs" element={<WriteOffs />} />
        <Route path="counts" element={<Counts />} />
        <Route path="counts/:id" element={<CountDetail />} />
        <Route path="purchasing" element={<Purchasing />} />
        <Route path="purchasing/:id" element={<Purchasing />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="suppliers/:id" element={<Suppliers />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<Customers />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/:tab" element={<Reports />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
