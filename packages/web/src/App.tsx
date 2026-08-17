import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { UNAUTHORIZED_EVENT } from "./api.js";
import { getToken } from "./auth.js";
import { Layout } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { LoginCallbackPage } from "./pages/LoginCallbackPage.js";
import { InboxPage } from "./pages/InboxPage.js";
import { QueuePage } from "./pages/QueuePage.js";
import { ThreadPage } from "./pages/ThreadPage.js";
import { ThreadsPage } from "./pages/ThreadsPage.js";
import { NewThreadPage } from "./pages/NewThreadPage.js";
import { AgreementsPage } from "./pages/AgreementsPage.js";
import { ParticipantsPage } from "./pages/ParticipantsPage.js";
import { AgentSessionsPage } from "./pages/AgentSessionsPage.js";
import { SessionLogPage } from "./pages/SessionLogPage.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function UnauthorizedRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const redirectToLogin = () => navigate("/login", { replace: true });
    window.addEventListener(UNAUTHORIZED_EVENT, redirectToLogin);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, redirectToLogin);
  }, [navigate]);

  return null;
}

export function App() {
  return (
    <>
      <UnauthorizedRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/callback" element={<LoginCallbackPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<QueuePage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/threads" element={<ThreadsPage />} />
          <Route path="/threads/new" element={<NewThreadPage />} />
          <Route path="/threads/:id" element={<ThreadPage />} />
          <Route path="/agreements" element={<AgreementsPage />} />
          <Route path="/participants" element={<ParticipantsPage />} />
          <Route path="/participants/:id" element={<AgentSessionsPage />} />
          <Route path="/sessions/:id" element={<SessionLogPage />} />
        </Route>
      </Routes>
    </>
  );
}
