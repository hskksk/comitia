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

function ProjectNavLinks({
  projectId,
  onNavigate,
}: {
  projectId: string;
  onNavigate: () => void;
}) {
  const projectBase = projectPath(projectId);
  return (
    <>
      <NavLink to={projectBase} end onClick={onNavigate}>
        ダッシュボード
      </NavLink>
      <NavLink to={projectPath(projectId, "queue")} onClick={onNavigate}>
        判断キュー
      </NavLink>
      <NavLink to={projectPath(projectId, "threads")} onClick={onNavigate}>
        スレッド
      </NavLink>
      <NavLink to={projectPath(projectId, "agreements")} onClick={onNavigate}>
        提案集
      </NavLink>
      <NavLink to={projectPath(projectId, "participants")} onClick={onNavigate}>
        参加者
      </NavLink>
      <NavLink to={projectPath(projectId, "inbox")} onClick={onNavigate}>
        非ブロッキング
      </NavLink>
    </>
  );
}

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

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className={`app-shell${sidebarOpen ? " sidebar-open" : ""}`}>
      <header className="top-bar">
        <button
          type="button"
          className="sidebar-toggle"
          aria-expanded={sidebarOpen}
          aria-controls="app-sidebar"
          onClick={() => setSidebarOpen((open) => !open)}
        >
          メニュー
        </button>
        <nav className="nav" aria-label="ページ">
          {activeProjectId ? (
            <ProjectNavLinks
              projectId={activeProjectId}
              onNavigate={closeSidebar}
            />
          ) : null}
        </nav>
      </header>
      <div className="app-body">
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
              onClick={() => {
                closeSidebar();
                navigate("/projects");
              }}
            >
              新しいプロジェクト
            </button>
          </div>

          <nav className="sidebar-nav" aria-label="メイン">
            {activeProjectId ? (
              <ProjectNavLinks
                projectId={activeProjectId}
                onNavigate={closeSidebar}
              />
            ) : null}
          </nav>

          <div className="sidebar-bottom">
            {activeProjectId ? (
              <NavLink
                to={projectPath(activeProjectId, "settings")}
                onClick={closeSidebar}
              >
                プロジェクト設定
              </NavLink>
            ) : null}
            <NavLink to="/settings" onClick={closeSidebar}>
              ユーザー設定
            </NavLink>
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
    </div>
  );
}
