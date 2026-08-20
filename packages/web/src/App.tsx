import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
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
import { NotesPage } from "./pages/NotesPage.js";
import { AgentSessionsPage } from "./pages/AgentSessionsPage.js";
import { SessionLogPage } from "./pages/SessionLogPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { ProjectSettingsPage } from "./pages/ProjectSettingsPage.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { boardClient } from "./api.js";
import { pickProjectId, projectPath } from "./projectContext.js";

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

function LegacyProjectRedirect({ suffix }: { suffix: string }) {
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    boardClient
      .me()
      .then((me) => {
        const projectId = pickProjectId(me);
        if (!projectId) {
          setTarget("/projects");
          return;
        }
        setTarget(projectPath(projectId, suffix));
      })
      .catch(() => setTarget("/login"));
  }, [suffix]);

  if (!target) {
    return <p className="status status-loading">読み込み中…</p>;
  }
  return <Navigate to={target} replace />;
}

function LegacyThreadRedirect() {
  const { id } = useParams<{ id: string }>();
  return <LegacyProjectRedirect suffix={`threads/${id ?? ""}`} />;
}

function LegacyParticipantRedirect() {
  const { id } = useParams<{ id: string }>();
  return <LegacyProjectRedirect suffix={`participants/${id ?? ""}`} />;
}

function LegacySessionRedirect() {
  const { id } = useParams<{ id: string }>();
  return <LegacyProjectRedirect suffix={`sessions/${id ?? ""}`} />;
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
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/p/:projectId" element={<DashboardPage />} />
          <Route path="/p/:projectId/queue" element={<QueuePage />} />
          <Route path="/p/:projectId/inbox" element={<InboxPage />} />
          <Route path="/p/:projectId/threads" element={<ThreadsPage />} />
          <Route path="/p/:projectId/threads/new" element={<NewThreadPage />} />
          <Route path="/p/:projectId/threads/:id" element={<ThreadPage />} />
          <Route path="/p/:projectId/agreements" element={<AgreementsPage />} />
          <Route path="/p/:projectId/participants" element={<ParticipantsPage />} />
          <Route
            path="/p/:projectId/participants/:id"
            element={<AgentSessionsPage />}
          />
          <Route path="/p/:projectId/notes" element={<NotesPage />} />
          <Route path="/p/:projectId/sessions/:id" element={<SessionLogPage />} />
          <Route path="/p/:projectId/settings" element={<ProjectSettingsPage />} />

          <Route path="/" element={<LegacyProjectRedirect suffix="" />} />
          <Route path="/queue" element={<LegacyProjectRedirect suffix="queue" />} />
          <Route path="/inbox" element={<LegacyProjectRedirect suffix="inbox" />} />
          <Route path="/threads" element={<LegacyProjectRedirect suffix="threads" />} />
          <Route
            path="/threads/new"
            element={<LegacyProjectRedirect suffix="threads/new" />}
          />
          <Route
            path="/threads/:id"
            element={<LegacyThreadRedirect />}
          />
          <Route
            path="/agreements"
            element={<LegacyProjectRedirect suffix="agreements" />}
          />
          <Route
            path="/participants"
            element={<LegacyProjectRedirect suffix="participants" />}
          />
          <Route
            path="/participants/:id"
            element={<LegacyParticipantRedirect />}
          />
          <Route path="/notes" element={<LegacyProjectRedirect suffix="notes" />} />
          <Route
            path="/sessions/:id"
            element={<LegacySessionRedirect />}
          />
        </Route>
      </Routes>
    </>
  );
}
