import Loading from "@/app/Loading";

/** The outline of what's coming: a character's page, a date, a couple, or a list of cards. */
export type PageShape = "profile" | "date" | "couple" | "list";

const Lines = ({ widths }: { widths: number[] }) => (
  <>
    {widths.map((w, i) => (
      <span key={i} className="sk sk-line" style={{ width: `${w}%` }} />
    ))}
  </>
);

/**
 * A route's loading screen (its loading.tsx; the 2026-11-04 performance audit, David: "when I click on dates or
 * characters from another page it looks like my click didn't do anything"). It shows the moment a link is tapped: what
 * is loading, in words and the house mark (app/Loading.tsx), over a grey outline of the page, so nothing jumps when the
 * page arrives. Styles are `.page-skeleton` in app/globals.css.
 */
export default function PageLoading({ shape, label }: { shape: PageShape; label: string }) {
  return (
    <div className={`page-skeleton page-skeleton-${shape}`} aria-busy="true">
      <p className="page-skeleton-status" role="status">
        <Loading /> <span>{label}</span>
      </p>
      <div className="page-skeleton-body" aria-hidden="true">
        {shape === "profile" && (
          <>
            <div className="sk-head">
              <span className="sk sk-circle sk-face-lg" />
              <div className="sk-head-text">
                <span className="sk sk-title" />
                <Lines widths={[45, 30]} />
              </div>
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="sk-card">
                <Lines widths={[35, 90, 80, 60]} />
              </div>
            ))}
          </>
        )}
        {shape === "date" && (
          <>
            <div className="sk sk-hero">
              <span className="sk-hero-faces">
                <span className="sk sk-circle sk-face" />
                <span className="sk sk-circle sk-face" />
              </span>
            </div>
            <span className="sk sk-title" />
            <div className="sk-card">
              <Lines widths={[90, 85, 70, 88, 60]} />
            </div>
          </>
        )}
        {shape === "couple" && (
          <>
            <div className="sk-card sk-couple">
              <span className="sk sk-circle sk-face-lg" />
              <span className="sk sk-circle sk-face-lg" />
              <div className="sk-head-text">
                <span className="sk sk-title" />
                <Lines widths={[50]} />
              </div>
            </div>
            <div className="sk-card">
              <Lines widths={[30, 90, 75, 85]} />
            </div>
          </>
        )}
        {shape === "list" && (
          <>
            <span className="sk sk-title" />
            <div className="sk-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="sk-card sk-tile">
                  <span className="sk sk-circle sk-face" />
                  <div className="sk-head-text">
                    <Lines widths={[70, 45]} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
