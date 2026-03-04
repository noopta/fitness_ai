# Hosting Guide for liftoffmvp.io 🚀

## Your Domain: liftoffmvp.io (Porkbun)

You have a full-stack application:
- **Frontend**: React + Vite (frontend-v2)
- **Backend**: Node.js + Express + TypeScript + SQLite

## Best Free Hosting Options

### 🏆 Recommended Setup (100% Free)

#### **Option 1: Vercel + Railway (Easiest)**

**Frontend on Vercel** (Free Forever)
- ✅ Unlimited bandwidth
- ✅ Automatic HTTPS
- ✅ Global CDN
- ✅ Perfect for React/Vite
- ✅ Zero config deployment
- ✅ Custom domain support

**Backend on Railway** (Free $5/month credit)
- ✅ 500 hours/month execution time
- ✅ PostgreSQL database (better than SQLite for production)
- ✅ Automatic deployments
- ✅ Environment variables
- ⚠️ Limited to $5/month (should be enough for MVP)

**Cost**: **FREE** (Railway's $5 credit renews monthly)

---

#### **Option 2: Render (All-in-One, Free)**

**Both Frontend & Backend on Render**
- ✅ 750 hours/month for web services
- ✅ PostgreSQL database included
- ✅ Automatic HTTPS
- ✅ Custom domain support
- ⚠️ Services spin down after 15 min inactivity (cold starts)
- ⚠️ Slower than Vercel for frontend

**Cost**: **FREE** (with cold starts)

---

#### **Option 3: Fly.io (Free Tier)**

**Both Frontend & Backend on Fly.io**
- ✅ 3 shared-cpu VMs
- ✅ 160GB bandwidth/month
- ✅ Full control (like having a VPS)
- ✅ Can use NGINX if you want
- ✅ SQLite works fine
- ⚠️ More complex setup

**Cost**: **FREE** (within limits)

---

## ✨ Recommended: Vercel + Railway

This is the best setup for your MVP. Here's why:
- **Fastest frontend** (Vercel CDN)
- **Always-on backend** (Railway doesn't sleep)
- **Easiest setup** (minimal configuration)
- **Best developer experience**

### Step-by-Step Setup

#### Part 1: Deploy Frontend to Vercel

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Navigate to frontend-v2**:
   ```bash
   cd frontend-v2
   ```

3. **Create `vercel.json`** in `frontend-v2/`:
   ```json
   {
     "buildCommand": "npm run build:client",
     "outputDirectory": "dist/public",
     "devCommand": "npm run dev:client",
     "installCommand": "npm install",
     "framework": null,
     "rewrites": [
       {
         "source": "/api/(.*)",
         "destination": "https://your-backend-url.up.railway.app/api/$1"
       },
       {
         "source": "/(.*)",
         "destination": "/index.html"
       }
     ]
   }
   ```

4. **Deploy**:
   ```bash
   vercel
   ```
   - Login with GitHub/GitLab/Bitbucket
   - Follow prompts
   - It will give you a URL like: `liftoff-frontend.vercel.app`

5. **Add Custom Domain**:
   - Go to Vercel Dashboard
   - Project Settings → Domains
   - Add `liftoffmvp.io`
   - Vercel will give you DNS records

6. **Update Porkbun DNS**:
   - Login to Porkbun
   - Add these records (Vercel will tell you exactly what):
     ```
     Type: CNAME
     Host: www
     Answer: cname.vercel-dns.com
     
     Type: A
     Host: @
     Answer: 76.76.21.21
     ```

#### Part 2: Deploy Backend to Railway

1. **Go to Railway**: https://railway.app/

2. **Create New Project**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your GitHub
   - Select your repo

3. **Configure Backend**:
   - Root directory: `/backend`
   - Build command: `npm install && npm run build`
   - Start command: `npm start`

4. **Add Environment Variables**:
   ```env
   PORT=3001
   DATABASE_URL=postgresql://...  (Railway provides this)
   OPENAI_API_KEY=sk-proj-...
   TWILIO_ACCOUNT_SID=ACa7ca...
   TWILIO_AUTH_TOKEN=66248496...
   TWILIO_PHONE_NUMBER=+12896705138
   NOTIFICATION_PHONE=+15199938342
   EMAIL_USER=anuptaislam33@gmail.com
   EMAIL_PASSWORD=your_app_password
   NODE_ENV=production
   ```

5. **Add PostgreSQL Database**:
   - In Railway project, click "+ New"
   - Select "Database" → "PostgreSQL"
   - Railway auto-connects it to your backend
   - Update `DATABASE_URL` in your Prisma schema

6. **Get Backend URL**:
   - Railway gives you: `your-app-name.up.railway.app`
   - Update this in your Vercel `vercel.json` (Step 3 above)

7. **Update Prisma for PostgreSQL**:
   
   In `backend/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"  // Change from sqlite
     url      = env("DATABASE_URL")
   }
   ```

   Run migrations:
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

---

## Alternative: NGINX on VPS (If You Want Full Control)

If you want to use NGINX and have full control, here are free VPS options:

### Free VPS Providers:

1. **Oracle Cloud (Forever Free)**
   - ✅ 2 AMD VMs (1GB RAM each)
   - ✅ 4 ARM VMs (24GB RAM total)
   - ✅ 200GB storage
   - ✅ **Actually free forever**
   - Best option if you want VPS control

2. **Google Cloud (Free Tier)**
   - ✅ f1-micro instance (1 shared vCPU, 0.6GB RAM)
   - ✅ 30GB storage
   - ✅ 1GB egress/month
   - ⚠️ Limited resources

3. **AWS Free Tier (12 Months)**
   - ✅ t2.micro (1 vCPU, 1GB RAM)
   - ✅ 750 hours/month (full month)
   - ⚠️ Only free for 1 year

### NGINX Setup on VPS:

If you choose Oracle Cloud or another VPS:

1. **Install NGINX**:
   ```bash
   sudo apt update
   sudo apt install nginx
   ```

2. **Configure NGINX** (`/etc/nginx/sites-available/liftoff`):
   ```nginx
   server {
       listen 80;
       server_name liftoffmvp.io www.liftoffmvp.io;

       # Frontend
       location / {
           root /var/www/liftoff/frontend;
           try_files $uri $uri/ /index.html;
       }

       # Backend API
       location /api {
           proxy_pass http://localhost:3001;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

3. **Enable site**:
   ```bash
   sudo ln -s /etc/nginx/sites-available/liftoff /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

4. **Install Certbot for HTTPS**:
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d liftoffmvp.io -d www.liftoffmvp.io
   ```

5. **Run Backend with PM2**:
   ```bash
   npm install -g pm2
   cd /var/www/liftoff/backend
   pm2 start npm --name "liftoff-api" -- start
   pm2 startup
   pm2 save
   ```

---

## Comparison Table

| Solution | Cost | Setup Difficulty | Performance | Always-On | Custom Domain |
|----------|------|------------------|-------------|-----------|---------------|
| **Vercel + Railway** | FREE | ⭐ Easy | ⭐⭐⭐ Excellent | ✅ Yes | ✅ Yes |
| **Render** | FREE | ⭐⭐ Medium | ⭐⭐ Good | ⚠️ Cold starts | ✅ Yes |
| **Fly.io** | FREE | ⭐⭐⭐ Hard | ⭐⭐⭐ Excellent | ✅ Yes | ✅ Yes |
| **Oracle Cloud + NGINX** | FREE | ⭐⭐⭐⭐ Very Hard | ⭐⭐ Good | ✅ Yes | ✅ Yes |

---

## My Recommendation: Vercel + Railway

**Why?**
1. ✅ **Completely free** (Railway's $5 credit is enough)
2. ✅ **Easiest to set up** (no server management)
3. ✅ **Best performance** (Vercel's CDN is insanely fast)
4. ✅ **No cold starts** (Railway keeps your backend warm)
5. ✅ **Automatic deployments** (push to Git = deploy)
6. ✅ **HTTPS included** (automatic SSL certificates)
7. ✅ **Custom domain support** (liftoffmvp.io)

**When to use NGINX + VPS?**
- When you need full control
- When you have specific server requirements
- When you want to learn DevOps
- When you scale beyond free tiers

---

## Next Steps

1. **Deploy to Vercel + Railway** (recommended)
2. **Test everything works**
3. **Point liftoffmvp.io to Vercel**
4. **Share your live MVP!**

Want me to help you set up the deployment? I can create the necessary config files!
