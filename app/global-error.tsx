"use client";

/**
 * Replaces the root layout when the layout itself throws, so it cannot rely on globals.css or the
 * app shell. The colours are the "Record" palette's --canvas, --ink, --muted and --accent, inlined.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f6f4ef",
          color: "#1b1a17",
          fontFamily: '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        <title>Politica</title>
        <div style={{ maxWidth: 440, padding: "0 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Politica could not load</h1>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#5f5b52", marginTop: 8 }}>
            Something went wrong while loading the site. Trying again usually works.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: 20,
              border: 0,
              borderRadius: 8,
              background: "#1f4e79",
              color: "#fff",
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ fontSize: 11, color: "#6e695e", marginTop: 24 }}>Reference {error.digest}</p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
