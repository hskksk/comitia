import { useEffect, useState } from "react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  boardClient,
  getCurrentProjectId,
  setCurrentProjectId,
  type MeResponse,
} from "../api.js";
import { clearToken } from "../auth.js";
import {
  pickProjectId,
  projectPath,
  saveLastProjectId,
} from "../projectContext.js";

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    boardClient
      .me()
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const projects =
    me?.participant.kind === "human" ? (me.projects ?? []) : [];
  const activeProjectId =
    routeProjectId ?? (me ? pickProjectId(me) : null) ?? null;

  if (activeProjectId && getCurrentProjectId() !== activeProjectId) {
    setCurrentProjectId(activeProjectId);
  }

  useEffect(() => {
    if (activeProjectId) {
      saveLastProjectId(activeProjectId);
    }
  }, [activeProjectId]);

  function onProjectChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextId = event.target.value;
    if (!nextId) {
      return;
    }
    saveLastProjectId(nextId);
    const projectMatch = location.pathname.match(/^\/p\/[^/]+(\/.*)?$/);
    const suffix = projectMatch?.[1] ?? "";
    navigate(projectPath(nextId, suffix || ""));
    setSidebarOpen(false);
  }

  const projectBase = activeProjectId ? projectPath(activeProjectId) : null;

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <button
        type="button"
        className="sidebar-toggle"
        aria-expanded={sidebarOpen}
        aria-controls="app-sidebar"
        onClick={() => setSidebarOpen((open) => !open)}
      >
        メニュー
      </button>
      <aside id="app-sidebar" className="sidebar">
        <div className="sidebar-top">
          <label className="project-switcher">
            プロジェクト
            <select
              value={activeProjectId ?? ""}
              onChange={onProjectChange}
              disabled={projects.length === 0}
            >
              {projects.length === 0 ? (
                <option value="">なし</option>
              ) : (
                projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))
              )}
            </select>
          </label>
          <button
            type="button"
            className="sidebar-link sidebar-link-action"
            onClick={() => navigate("/projects")}
          >
            新しいプロジェクト
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="メイン">
          {projectBase && activeProjectId ? (
            <>
              <NavLink to={projectBase} end>
                ダッシュボード
              </NavLink>
              <NavLink to={projectPath(activeProjectId, "queue")}>判断キュー</NavLink>
              <NavLink to={projectPath(activeProjectId, "threads")}>スレッド</NavLink>
              <NavLink to={projectPath(activeProjectId, "agreements")}>
                提案集
              </NavLink>
              <NavLink to={projectPath(activeProjectId, "participants")}>
                参加者
              </NavLink>
              <NavLink to={projectPath(activeProjectId, "inbox")}>
                非ブロッキング
              </NavLink>
            </>
          ) : null}
        </nav>

        <div className="sidebar-bottom">
          {activeProjectId ? (
            <NavLink to={projectPath(activeProjectId, "settings")}>
              プロジェクト設定
            </NavLink>
          ) : null}
          <NavLink to="/settings">ユーザー設定</NavLink>
          <button
            type="button"
            className="sidebar-logout"
            onClick={() => {
              clearToken();
              setCurrentProjectId(null);
              navigate("/login");
            }}
          >
            出る
          </button>
        </div>
      </aside>

      <main className="main-column">
        <Outlet key={location.pathname} />
      </main>
    </div>
  );
}
