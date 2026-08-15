import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./auth.js";
import { Layout } from "./components/Layout.js";
import { LoginPage } from "./pages/LoginPage.js";
import { InboxPage } from "./pages/InboxPage.js";
import { QueuePage } from "./pages/QueuePage.js";
import { ThreadPage } from "./pages/ThreadPage.js";
import { ThreadsPage } from "./pages/ThreadsPage.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        <Route path="/threads/:id" element={<ThreadPage />} />
      </Route>
    </Routes>
  );
}
