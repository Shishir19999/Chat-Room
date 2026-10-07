export function MessageSkeletons({ rows = 6 }) {
  return (
    <div className="skeleton-list" aria-hidden="true" data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton skeleton-avatar" />
          <div className="skeleton-lines">
            <span className="skeleton skeleton-line short" />
            <span className="skeleton skeleton-line" style={{ width: `${55 + ((i * 17) % 40)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function RoomSkeletons({ rows = 5 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span className="skeleton skeleton-room" key={i} />)}
    </div>
  );
}
