import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { clearToken } from "../auth.js";

export function Layout() {
  const navigate = useNavigate();
  return (
    <div className="layout">
      <nav className="nav">
        <NavLink to="/" end>
          判断キュー
        </NavLink>
        <NavLink to="/inbox">非ブロッキング</NavLink>
        <NavLink to="/threads">スレッド</NavLink>
        <button
          type="button"
          onClick={() => {
            clearToken();
            navigate("/login");
          }}
        >
          出る
        </button>
      </nav>
      <Outlet />
    </div>
  );
}
