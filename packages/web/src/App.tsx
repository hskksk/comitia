import { Navigate, Route, Routes } from "react-router-dom";
import { getToken } from "./auth.js";
import { LoginPage } from "./pages/LoginPage.js";

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
        path="/"
        element={
          <RequireAuth>
            <p>判断キュー</p>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
