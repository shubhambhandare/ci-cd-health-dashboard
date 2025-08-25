# Technical Design Document
## CI/CD Pipeline Health Dashboard

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │    Backend      │    │   Database      │
│   (React)       │◄──►│   (Node.js)     │◄──►│   (SQLite)      │
│   Port: 3001    │    │   Port: 3000    │    │   File-based    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Nginx Proxy   │    │  Email Service  │    │   Data Files    │
│   (Port 80)     │    │  (Nodemailer)   │    │   (./data/)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         │                       ▼
         ▼              ┌─────────────────┐
┌─────────────────┐    │   SMTP Server   │
│   CI/CD Tools   │    │   (Gmail/etc)   │
│   (GitHub/etc)  │    └─────────────────┘
└─────────────────┘
```

#### **Component Responsibilities**

1. **Frontend (React)**
   - Renders dashboard UI
   - Fetches data from backend API
   - Auto-refreshes every 30 seconds
   - Responsive design for mobile/desktop

2. **Backend (Node.js/Express)**
   - RESTful API endpoints
   - Database operations
   - Email service integration
   - Webhook processing
   - CORS handling

3. **Database (SQLite)**
   - Pipeline metadata storage
   - Build history and metrics
   - File-based, no external dependencies

4. **Email Service (Nodemailer)**
   - SMTP integration
   - HTML email templates
   - Failure notification delivery

5. **Nginx Proxy**
   - Serves static frontend files
   - Proxies API requests to backend
   - Handles routing

### API Structure

#### **Base URL**: `http://localhost:3000/api`

#### **1. Health Check**
```http
GET /api/health
```
**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### **2. Pipeline Management**
```http
GET /api/pipelines
```
**Response:**
```json
[
  {
    "id": 1,
    "name": "GitHub Actions Test",
    "type": "github",
    "status": "success",
    "last_build_time": 1705312200,
    "created_at": 1705312000,
    "updated_at": 1705312200
  }
]
```

```http
POST /api/pipelines
Content-Type: application/json

{
  "name": "New Pipeline",
  "type": "github"
}
```

#### **3. Build Management**
```http
GET /api/builds
```
**Response:**
```json
[
  {
    "id": 1,
    "pipeline_id": 1,
    "build_number": "123",
    "status": "success",
    "start_time": 1705312200,
    "end_time": 1705312280,
    "duration": 80,
    "created_at": 1705312280,
    "pipeline_name": "GitHub Actions Test"
  }
]
```

#### **4. Webhook Endpoint**
```http
POST /api/webhooks
Content-Type: application/json

{
  "pipeline_id": 1,
  "build_number": "124",
  "status": "failed",
  "start_time": 1705312300,
  "end_time": 1705312350
}
```

#### **5. Metrics Dashboard**
```http
GET /api/metrics
```
**Response:**
```json
{
  "totalPipelines": 3,
  "totalBuilds": 15,
  "successBuilds": 12,
  "failedBuilds": 3,
  "successRate": 80.0
}
```

#### **6. Email Testing**
```http
POST /api/test-email
Content-Type: application/json

{
  "to": "user@example.com"
}
```

### Database Schema

#### **Pipelines Table**
```sql
CREATE TABLE pipelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                    -- Pipeline display name
    type TEXT NOT NULL,                    -- 'github', 'gitlab', 'jenkins'
    status TEXT DEFAULT 'unknown',         -- 'success', 'failed', 'running', 'unknown'
    last_build_time INTEGER,               -- Unix timestamp of last build
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

#### **Builds Table**
```sql
CREATE TABLE builds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL,          -- Foreign key to pipelines
    build_number TEXT NOT NULL,            -- Build identifier (e.g., "123")
    status TEXT NOT NULL,                  -- 'success', 'failed', 'running', 'cancelled'
    start_time INTEGER,                    -- Unix timestamp
    end_time INTEGER,                      -- Unix timestamp
    duration INTEGER,                      -- Duration in seconds
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (pipeline_id) REFERENCES pipelines(id)
);
```

#### **Indexes for Performance**
```sql
CREATE INDEX idx_pipelines_status ON pipelines(status);
CREATE INDEX idx_builds_pipeline_id ON builds(pipeline_id);
CREATE INDEX idx_builds_status ON builds(status);
CREATE INDEX idx_builds_created_at ON builds(created_at);
```

### UI Layout Design

#### **Dashboard Structure**

```
┌─────────────────────────────────────────────────────────────┐
│                    🚀 Simple CI/CD Dashboard                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────┐ │
│  │ Total       │ │ Total       │ │ Success     │ │ Failed  │ │
│  │ Pipelines   │ │ Builds      │ │ Rate        │ │ Builds  │ │
│  │     3       │ │    15       │ │   80.0%     │ │    3    │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────┘ │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Pipelines                                                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ GitHub Actions Test    [SUCCESS]  Last: 2 min ago      │ │
│  │ GitLab CI Pipeline     [FAILED]   Last: 5 min ago      │ │
│  │ Jenkins Build          [RUNNING]  Started: 1 min ago   │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Recent Builds                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ #124 GitHub Actions Test    [FAILED]    Duration: 50s   │ │
│  │ #123 GitHub Actions Test    [SUCCESS]   Duration: 80s   │ │
│  │ #122 GitLab CI Pipeline     [SUCCESS]   Duration: 120s  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### **Component Hierarchy**

```
App
├── Header
│   └── Title
├── Main
│   ├── Metrics Section
│   │   └── Metric Cards (4 cards)
│   ├── Pipelines Section
│   │   └── Pipeline Cards (dynamic list)
│   └── Builds Section
│       └── Build Cards (dynamic list, limited to 10)
```

#### **Responsive Design**

**Desktop (1200px+)**
- 4-column metrics grid
- 3-column pipeline/build cards
- Full-width layout

**Tablet (768px - 1199px)**
- 2-column metrics grid
- 2-column pipeline/build cards
- Reduced padding

**Mobile (< 768px)**
- 1-column layout
- Stacked metrics cards
- Single-column pipeline/build cards
- Touch-friendly spacing

#### **Color Scheme**

- **Success**: `#4caf50` (Green)
- **Failed**: `#f44336` (Red)
- **Running**: `#2196f3` (Blue)
- **Unknown**: `#9e9e9e` (Gray)
- **Background**: `#f5f5f5` (Light Gray)
- **Cards**: `#ffffff` (White)
- **Text**: `#333333` (Dark Gray)

#### **Status Indicators**

- **Badges**: Rounded corners, uppercase text, white text on colored background
- **Cards**: White background with subtle shadow and colored left border
- **Icons**: Emoji indicators for quick visual recognition

### Data Flow

#### **1. Dashboard Initialization**
```
Frontend → GET /api/metrics → Backend → Database → Response
Frontend → GET /api/pipelines → Backend → Database → Response
Frontend → GET /api/builds → Backend → Database → Response
```

#### **2. Webhook Processing**
```
CI/CD Tool → POST /api/webhooks → Backend → Database Update → Email (if failed)
```

#### **3. Real-time Updates**
```
Frontend → setInterval(30s) → API Calls → UI Update
```

#### **4. Email Notification**
```
Failed Build → Email Service → SMTP Server → Recipient Inbox
```

### Security Considerations

#### **Input Validation**
- All API endpoints validate required fields
- SQL injection prevention through parameterized queries
- CORS configuration for frontend-backend communication

#### **Environment Variables**
- Sensitive data (SMTP credentials) stored in `.env` file
- `.env` file excluded from version control
- Configuration validation on startup

#### **Error Handling**
- Graceful error responses with appropriate HTTP status codes
- Error logging for debugging
- Non-blocking email failures (webhook continues even if email fails)

### Performance Considerations

#### **Database Optimization**
- Indexes on frequently queried columns
- Limited result sets (100 builds max)
- Efficient JOIN queries for build-pipeline relationships

#### **Frontend Performance**
- 30-second refresh interval (configurable)
- Efficient React rendering with proper key props
- Minimal bundle size with Vite optimization

#### **API Performance**
- Simple SQLite queries for fast response times
- No complex aggregations or joins in hot paths
- Static file serving through Nginx

### Deployment Architecture

#### **Development Environment**
```
Docker Compose
├── backend (Node.js + TypeScript)
├── frontend (React + Vite)
└── nginx (Reverse Proxy)
```

#### **Production Considerations**
- Multi-stage Docker builds for smaller images
- Environment-specific configurations
- Health check endpoints
- Graceful shutdown handling
