-- Simple CI/CD Dashboard Database Schema

-- Pipelines table
CREATE TABLE IF NOT EXISTS pipelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- 'github', 'gitlab', 'jenkins'
    status TEXT DEFAULT 'unknown', -- 'success', 'failed', 'running', 'unknown'
    last_build_time INTEGER, -- Unix timestamp
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Builds table
CREATE TABLE IF NOT EXISTS builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL,
    build_number TEXT NOT NULL,
    status TEXT NOT NULL, -- 'success', 'failed', 'running', 'cancelled'
    start_time INTEGER, -- Unix timestamp
    end_time INTEGER, -- Unix timestamp
    duration INTEGER, -- Duration in seconds
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (pipeline_id) REFERENCES pipelines(id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines(status);
CREATE INDEX IF NOT EXISTS idx_builds_pipeline_id ON builds(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status);
CREATE INDEX IF NOT EXISTS idx_builds_created_at ON builds(created_at);
