import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./views";
import { BeadgridApp, FocusTakeApp } from "./product-apps";
function Surface() {
  const [kind, setKind] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch("/api/config")
      .then((r) => {
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((c) => setKind(c.id))
      .catch(() => setError(true));
  }, []);
  return error ? (
    <p role="alert">无法连接服务，请刷新重试。</p>
  ) : !kind ? (
    <p role="status">正在加载…</p>
  ) : kind === "beadgrid" ? (
    <BeadgridApp />
  ) : kind === "focustake" ? (
    <FocusTakeApp />
  ) : (
    <App />
  );
}
createRoot(document.getElementById("root")!).render(<Surface />);
