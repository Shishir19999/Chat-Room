import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <main className="center-screen">
      <div className="state">
        <div className="state-art" aria-hidden="true">🧭</div>
        <h1>Page not found</h1>
        <p>That page does not exist or has moved.</p>
        <Link to="/" className="btn btn-primary">Back to the start</Link>
      </div>
    </main>
  );
}
