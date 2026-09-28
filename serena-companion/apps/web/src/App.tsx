import type { ReactNode } from 'react';
import { BrowserRouter, MemoryRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { DEMO } from './demo/flags.ts';
import { DemoFrame } from './demo/DemoFrame.tsx';
import { useApp, storage } from './lib/store.tsx';
import { appLock } from './lib/applock.ts';
import { AppShell } from './components/AppShell.tsx';
import { LockScreen, SessionEndedOverlay } from './components/Overlays.tsx';
import { ConsentScreen, Splash } from './screens/Onboarding.tsx';
import { Login } from './screens/Login.tsx';
import { Home } from './screens/Home.tsx';
import { CheckinFlow } from './screens/checkin/CheckinFlow.tsx';
import { Result } from './screens/Result.tsx';
import { Breathe } from './screens/Breathe.tsx';
import { Companion } from './screens/Companion.tsx';
import { Wellbeing } from './screens/Wellbeing.tsx';
import { ResourceDetail, Resources } from './screens/Resources.tsx';
import { PolicyPage, Privacy } from './screens/Privacy.tsx';
import { Devices } from './screens/Devices.tsx';
import { KioskClose, KioskId, KioskWait } from './screens/kiosk/Kiosk.tsx';
import { AdminBilling, AdminStats, AdminTeam, SandboxCheckout } from './screens/admin/Admin.tsx';
import { BajaScreen } from './screens/Baja.tsx';

/** Rutas del trabajador: requieren sesión personal (no de kiosco). */
function WorkerGate() {
  const { session, ready, locked } = useApp();
  const loc = useLocation();
  if (!ready) return null;
  if (!session || session.efimera) return <Navigate to={storage.get('serena.welcomed') ? '/ingresar' : '/bienvenida'} replace state={{ from: loc.pathname }} />;
  if (session.perfil.role === 'admin') return <Navigate to="/admin" replace />;
  if (session.deviceKind === 'mobile' && !appLock.configured()) return <Navigate to="/ingresar" replace />;
  if (session.perfil.baja)
    return (
      <AppShell hideNav>
        <BajaScreen />
        {locked && <LockScreen />}
      </AppShell>
    );
  const flow = /^\/(checkin|respirar)/.test(loc.pathname);
  return (
    <AppShell hideNav={flow}>
      <Outlet />
      {locked && <LockScreen />}
    </AppShell>
  );
}

function AdminGate() {
  const { session, ready } = useApp();
  if (!ready) return null;
  if (!session || session.perfil.role !== 'admin') return <Navigate to="/ingresar" replace />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function KioskLayout() {
  return (
    <AppShell kiosk>
      <Outlet />
    </AppShell>
  );
}

function KioskSessionGate({ children }: { children: ReactNode }) {
  const { session } = useApp();
  if (!session?.efimera) return <Navigate to="/kiosco" replace />;
  return <>{children}</>;
}

function PublicLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function LoginRoute() {
  const { session, ready } = useApp();
  if (!ready) return null;
  if (session && !session.efimera && !(session.deviceKind === 'mobile' && !appLock.configured()))
    return <Navigate to={session.perfil.role === 'admin' ? '/admin' : '/'} replace />;
  return <Login />;
}

export function App() {
  // La vista previa corre dentro de un marco sin URL propia: el enrutador vive en memoria.
  const Router = DEMO ? MemoryRouter : BrowserRouter;
  const routes = (
      <Routes>
        <Route path="/bienvenida" element={<Splash />} />
        <Route element={<PublicLayout />}>
          <Route path="/consentimiento" element={<ConsentScreen />} />
          <Route path="/ingresar" element={<LoginRoute />} />
          <Route path="/privacidad/politica" element={<PolicyPage />} />
        </Route>
        <Route element={<WorkerGate />}>
          <Route index element={<Home />} />
          <Route path="/checkin" element={<CheckinFlow />} />
          <Route path="/resultado/:id" element={<Result />} />
          <Route path="/respirar" element={<Breathe />} />
          <Route path="/acompanante" element={<Companion />} />
          <Route path="/bienestar" element={<Wellbeing />} />
          <Route path="/recursos" element={<Resources />} />
          <Route path="/recursos/:slug" element={<ResourceDetail />} />
          <Route path="/privacidad" element={<Privacy />} />
          <Route path="/dispositivos" element={<Devices />} />
        </Route>
        <Route element={<AdminGate />}>
          <Route path="/admin" element={<AdminStats />} />
          <Route path="/admin/equipo" element={<AdminTeam />} />
          <Route path="/admin/facturacion" element={<AdminBilling />} />
          <Route path="/admin/facturacion/sandbox" element={<SandboxCheckout />} />
        </Route>
        <Route path="/kiosco" element={<KioskLayout />}>
          <Route index element={<KioskWait />} />
          <Route path="id" element={<KioskId />} />
          <Route path="checkin" element={<KioskSessionGate><CheckinFlow kiosk /></KioskSessionGate>} />
          <Route path="resultado/:id" element={<KioskSessionGate><Result kiosk /></KioskSessionGate>} />
          <Route path="respirar" element={<KioskSessionGate><Breathe kiosk /></KioskSessionGate>} />
          <Route path="cierre" element={<KioskClose />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
  return (
    <Router>
      {DEMO ? (
        <DemoFrame>
          {routes}
          <SessionEndedOverlay />
        </DemoFrame>
      ) : (
        <>
          {routes}
          <SessionEndedOverlay />
        </>
      )}
    </Router>
  );
}
