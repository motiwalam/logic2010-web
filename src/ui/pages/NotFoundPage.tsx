import { Link } from '../router';

export function NotFoundPage() {
  return (
    <main id="main" className="page">
      <h1>There is no page here</h1>
      <p>The address may be mistyped, or the page may have moved.</p>
      <p>
        <Link to={{ name: 'home' }}>Go to the exercises</Link>
      </p>
    </main>
  );
}
