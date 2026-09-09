/** Navigate within the Vue hash router from legacy React pages. */
export function navigateApp(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  // Chat lived at `/` in the React app; Vue shell uses `/chat`.
  const target = normalized === "/" ? "/home" : normalized;
  window.location.hash = `#${target}`;
}
