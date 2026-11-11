export const isDevelopmentBuild = import.meta.env.DEV;

export function BuildBadge() {
  if (!isDevelopmentBuild) return null;

  return (
    <span className="build-badge" aria-label="Development build" title="Development build">
      DEV
    </span>
  );
}
