// Casdoor v4.22.0 ShortcutsPage constructs these URLs from its route list.
// Extract from the pinned source instead of maintaining a second route list.
export function shortcutImagePaths(source) {
  const routes = [...source.matchAll(/link:\s*["'](\/[a-z-]+)["']/g)].map(
    (match) => match[1],
  );
  if (!routes.length || !source.includes("/img${item.link}.png"))
    throw new Error("快捷操作图片规则已变化，请核对锁定的Casdoor源码");
  return [...new Set(routes.map((route) => `img${route}.png`))];
}
