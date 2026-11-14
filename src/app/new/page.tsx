export default function NewNotYet() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>New &ldquo;not yet&rdquo;</h1>
          <p>Write down what you told the founder. Since turns it into conditions you confirm before watching starts.</p>
        </div>
      </div>

      <form className="glass card" style={{ display: "grid", gap: 14, maxWidth: 760 }}>
        <div className="grid-2" style={{ gap: 14 }}>
          <label className="field">
            Startup domain
            <input className="input mono" name="domain" placeholder="nordwind.io" />
          </label>
          <label className="field">
            Meeting date
            <input className="input" type="date" name="met_on" />
          </label>
        </div>
        <label className="field">
          Where
          <input className="input" name="met_where" placeholder="Slush, Helsinki" />
        </label>
        <label className="field">
          Come back when&hellip;
          <textarea
            className="input"
            name="text"
            rows={4}
            placeholder="Come back when you have your first enterprise customer and you're selling in Germany."
          />
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn btn-primary" type="button" disabled>
            Parse conditions
          </button>
          <span className="muted">Condition mapping lands in M1.</span>
        </div>
      </form>
    </>
  );
}
