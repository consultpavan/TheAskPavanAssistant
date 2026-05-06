type QoQPoint = { quarter: string; score: number };

interface BUOverviewProps {
  summary: Array<{ project: string; milestone: string; invoice: string; card_count: number }>;
  risks: string[];
  qoq: QoQPoint[];
}

function BUOverview({ summary, risks, qoq }: BUOverviewProps) {
  return (
    <div className="bu-grid">
      <section className="panel">
        <h3>BU Performance Summary</h3>
        {summary.length === 0 && <p className="muted">No project data available yet.</p>}
        {summary.map((item) => (
          <div key={item.project} className="metric-card">
            <strong>{item.project}</strong>
            <p>Milestone: {item.milestone}</p>
            <p>Invoice: {item.invoice}</p>
            <p>Signals Parsed: {item.card_count}</p>
          </div>
        ))}
      </section>

      <section className="panel">
        <h3>QoQ Trend</h3>
        <div className="qoq-list">
          {qoq.map((point) => (
            <div key={point.quarter} className="qoq-row">
              <span>{point.quarter}</span>
              <div className="qoq-bar-wrap">
                <div className="qoq-bar" style={{ width: `${Math.max(8, point.score * 10)}px` }} />
              </div>
              <span>{point.score}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>Key Risks</h3>
        {risks.length === 0 && <p className="muted">No major risks detected in current scan.</p>}
        {risks.map((risk, index) => (
          <p key={`${risk}-${index}`} className="risk-item">
            {risk}
          </p>
        ))}
      </section>
    </div>
  );
}

export default BUOverview;
