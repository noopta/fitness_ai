# Fitness AI Backend Deployment - Complete ✅

**Deployment Date:** February 7, 2026
**Status:** Production Ready - Running 24/7

---

## Summary

The Fitness AI (LiftOff) backend has been successfully deployed on this EC2 Ubuntu server and is now running as a 24/7 service alongside your existing MCP servers.

---

## Deployment Details

### Repository Location
- **Path:** `/home/ubuntu/fitness_ap/fitness_ai`
- **Source:** https://github.com/noopta/fitness_ai.git

### Backend Configuration
- **Service:** `fitness-ai.service`
- **Working Directory:** `/home/ubuntu/fitness_ap/fitness_ai/backend`
- **Local Port:** `3001`
- **Public Port (SSL):** `4009`
- **Public URLs:**
  - `https://luciuslab.xyz:4009`
  - `https://api.airthreads.ai:4009`

### Service Status
- **Systemd Service:** Enabled and running
- **Auto-start on boot:** Yes
- **Health Check:** https://luciuslab.xyz:4009/health

---

## API Endpoints

### Base URL
```
https://luciuslab.xyz:4009/api
https://api.airthreads.ai:4009/api
```

### Available Endpoints
- `GET /health` - Health check
- `GET /api/lifts` - Get all supported lifts
- `GET /api/lifts/:id/exercises` - Get exercises for a lift
- `POST /api/sessions` - Create diagnostic session
- `POST /api/sessions/:id/snapshots` - Add exercise snapshot
- `POST /api/sessions/:id/messages` - Send diagnostic message
- `POST /api/sessions/:id/generate` - Generate workout plan
- `GET /api/sessions/:id` - Get session details
- `POST /api/waitlist` - Join waitlist

---

## Environment Variables (.env file)

**Location:** `/home/ubuntu/fitness_ap/fitness_ai/backend/.env`

```bash
PORT=3001
DATABASE_URL="file:./dev.db"
OPENAI_API_KEY=YOUR_API_KEY_HERE  # ⚠️ NEEDS TO BE SET

# Optional: Twilio for SMS notifications
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=
# TWILIO_PHONE_NUMBER=

# Optional: Email notifications
# EMAIL_HOST=
# EMAIL_PORT=
# EMAIL_USER=
# EMAIL_PASS=
```

### ⚠️ ACTION REQUIRED
You mentioned the API keys were removed. You need to add your OpenAI API key to the `.env` file:

```bash
sudo nano /home/ubuntu/fitness_ap/fitness_ai/backend/.env
# Add your OpenAI API key, then save
sudo systemctl restart fitness-ai
```

---

## Port Allocation

The following ports are now in use on this server:

| Service | Internal Port | External Port (SSL) | Purpose |
|---------|--------------|-------------------|---------|
| Django API | 8000 | 5002 | Main Django API |
| Python MCP | 9500 | 5000, 5001 | Python API & SSE |
| Gmail MCP | 10500 | 4008 | Gmail MCP Server |
| Calendar MCP | 11000 | 4010 | Calendar MCP Server |
| OAuth Callbacks | 12000, 3111 | 3005, 4007 | OAuth redirects |
| Haircut Service | 7500 | 7600 | SMS booking service |
| **Fitness AI** | **3001** | **4009** | **LiftOff Backend** |

---

## Database

- **Type:** SQLite
- **Location:** `/home/ubuntu/fitness_ap/fitness_ai/backend/prisma/dev.db`
- **Schema:** Managed by Prisma ORM
- **Migrations:** Automatic via `prisma db push`

---

## Service Management

### Check Status
```bash
sudo systemctl status fitness-ai
```

### View Logs
```bash
# Real-time logs
sudo journalctl -u fitness-ai -f

# Last 100 lines
sudo journalctl -u fitness-ai -n 100

# Since a specific time
sudo journalctl -u fitness-ai --since "1 hour ago"
```

### Restart Service
```bash
sudo systemctl restart fitness-ai
```

### Stop/Start Service
```bash
sudo systemctl stop fitness-ai
sudo systemctl start fitness-ai
```

### Disable Auto-start
```bash
sudo systemctl disable fitness-ai
```

---

## Testing the Deployment

### 1. Health Check (Direct)
```bash
curl http://127.0.0.1:3001/health
```
**Expected:** `{"status":"ok","message":"LiftOff API is running"}`

### 2. Health Check (via Nginx/SSL)
```bash
curl https://luciuslab.xyz:4009/health
```
**Expected:** `{"status":"ok","message":"LiftOff API is running"}`

### 3. List Lifts
```bash
curl https://luciuslab.xyz:4009/api/lifts
```

### 4. Test from Frontend
The frontend should be configured to point to:
```javascript
const API_URL = "https://luciuslab.xyz:4009/api";
// or
const API_URL = "https://api.airthreads.ai:4009/api";
```

---

## Architecture

### Systemd Service
- **File:** `/etc/systemd/system/fitness-ai.service`
- **User:** ubuntu
- **Auto-restart:** Yes (on failure)
- **Restart delay:** 5 seconds
- **Environment:** Loaded from `.env` file

### Nginx Configuration
- **File:** `/etc/nginx/sites-enabled/mcp-service` (appended)
- **SSL Certificates:** Let's Encrypt (luciuslab.xyz)
- **Proxy:** Port 4009 → 3001
- **CORS:** Enabled for all origins

### Tech Stack
- **Runtime:** Node.js 18
- **Framework:** Express + TypeScript
- **Database:** SQLite with Prisma ORM
- **AI:** OpenAI GPT-4 (requires API key)

---

## File Structure

```
/home/ubuntu/fitness_ap/fitness_ai/
├── backend/
│   ├── dist/                    # Compiled JavaScript (built)
│   ├── prisma/
│   │   ├── schema.prisma       # Database schema
│   │   └── dev.db              # SQLite database
│   ├── src/                    # TypeScript source
│   │   ├── data/               # Exercise & lift data
│   │   ├── engine/             # Rules engine
│   │   ├── routes/             # API routes
│   │   └── services/           # LLM service
│   ├── .env                    # Environment variables ⚠️
│   └── package.json
├── frontend/                   # React frontend (not deployed)
└── frontend-v2/                # Alternative frontend (not deployed)
```

---

## Monitoring & Maintenance

### Daily Health Check
```bash
# Add to crontab if desired
curl -f https://luciuslab.xyz:4009/health || echo "Fitness AI is down!"
```

### Log Rotation
Logs are managed by systemd journald with automatic rotation.

### Disk Space
The SQLite database will grow over time. Monitor with:
```bash
du -h /home/ubuntu/fitness_ap/fitness_ai/backend/prisma/dev.db
```

---

## Troubleshooting

### Service won't start
```bash
# Check logs for errors
sudo journalctl -u fitness-ai -n 50

# Common issues:
# 1. Missing OPENAI_API_KEY in .env
# 2. Port 3001 already in use
# 3. Missing node_modules (run npm install)
```

### Can't connect via public URL
```bash
# Check nginx is running
sudo systemctl status nginx

# Check port 4009 is listening
sudo ss -tlnp | grep :4009

# Test local connection first
curl http://127.0.0.1:3001/health
```

### 502 Bad Gateway
```bash
# Backend is down, check service
sudo systemctl status fitness-ai
sudo systemctl restart fitness-ai
```

---

## Next Steps

1. **Add OpenAI API Key** to `/home/ubuntu/fitness_ap/fitness_ai/backend/.env`
2. **Test the API** using the endpoints above
3. **Configure Frontend** to use the new backend URL
4. **(Optional)** Set up monitoring/alerting for the service

---

## Notes

- The backend is compiled TypeScript (ES modules)
- CORS is enabled for all origins (suitable for development/testing)
- Optional features (Twilio SMS, Email) are disabled until credentials are added
- Service will automatically restart on failure
- Service will auto-start on system reboot

---

## Support

For issues with the deployment, check:
1. Service logs: `sudo journalctl -u fitness-ai -f`
2. Nginx logs: `sudo tail -f /var/log/nginx/error.log`
3. Backend source: `/home/ubuntu/fitness_ap/fitness_ai/backend/src`

---

**Deployment completed successfully! The Fitness AI backend is now running 24/7 on port 4009 (SSL).** 🚀
