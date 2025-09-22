import React, { useState, useEffect } from 'react';
import './App.css';

interface Pipeline {
  id: number;
  name: string;
  type: string;
  status: string;
  last_build_time?: number;
}

interface Build {
  id: number;
  pipeline_id: number;
  build_number: string;
  status: string;
  duration?: number;
  pipeline_name: string;
}

interface Metrics {
  totalPipelines: number;
  totalBuilds: number;
  successBuilds: number;
  failedBuilds: number;
  successRate: number;
}

function App() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [builds, setBuilds] = useState<Build[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [pipelinesRes, buildsRes, metricsRes] = await Promise.all([
        fetch('/api/pipelines'),
        fetch('/api/builds'),
        fetch('/api/metrics')
      ]);

      if (pipelinesRes.ok) setPipelines(await pipelinesRes.json());
      if (buildsRes.ok) setBuilds(await buildsRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.json());
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return '#4caf50';
      case 'failed': return '#f44336';
      case 'running': return '#2196f3';
      default: return '#9e9e9e';
    }
  };

  if (loading) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🚀 Simple CI/CD Dashboard</h1>
      </header>

      <main className="main">
        {/* Metrics Overview */}
        {metrics && (
          <div className="metrics">
            <div className="metric-card">
              <h3>Total Pipelines</h3>
              <p className="metric-value">{metrics.totalPipelines}</p>
            </div>
            <div className="metric-card">
              <h3>Total Builds</h3>
              <p className="metric-value">{metrics.totalBuilds}</p>
            </div>
            <div className="metric-card">
              <h3>Success Rate</h3>
              <p className="metric-value">{metrics.successRate}%</p>
            </div>
            <div className="metric-card">
              <h3>Failed Builds</h3>
              <p className="metric-value error">{metrics.failedBuilds}</p>
            </div>
          </div>
        )}

        {/* Pipelines */}
        <section className="section">
          <h2>Pipelines</h2>
          <div className="pipeline-list">
            {pipelines.map(pipeline => (
              <div key={pipeline.id} className="pipeline-card">
                <div className="pipeline-header">
                  <h3>{pipeline.name}</h3>
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(pipeline.status) }}
                  >
                    {pipeline.status}
                  </span>
                </div>
                <p>Type: {pipeline.type}</p>
                {pipeline.last_build_time && (
                  <p>Last Build: {new Date(pipeline.last_build_time * 1000).toLocaleString()}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Recent Builds */}
        <section className="section">
          <h2>Recent Builds</h2>
          <div className="build-list">
            {builds.slice(0, 10).map(build => (
              <div key={build.id} className="build-card">
                <div className="build-header">
                  <span className="build-number">#{build.build_number}</span>
                  <span 
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(build.status) }}
                  >
                    {build.status}
                  </span>
                </div>
                <p>Pipeline: {build.pipeline_name}</p>
                {build.duration && <p>Duration: {build.duration}s</p>}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
