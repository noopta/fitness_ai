# Deployment Checklist for liftoffmvp.io 🚀

## Pre-Deployment Checklist

### ✅ Code Preparation
- [ ] All features tested locally
- [ ] Backend running on `localhost:3001` ✅
- [ ] Frontend running on `localhost:5001` ✅
- [ ] Waitlist SMS/Email notifications tested
- [ ] AI chat working
- [ ] Plan generation working
- [ ] All exercises filtering correctly
- [ ] No console errors

### ✅ Environment Variables Ready
- [ ] `OPENAI_API_KEY` - ✅ Have it
- [ ] `TWILIO_ACCOUNT_SID` - ✅ Have it
- [ ] `TWILIO_AUTH_TOKEN` - ✅ Have it
- [ ] `TWILIO_PHONE_NUMBER` - ✅ Have it
- [ ] `NOTIFICATION_PHONE` - ✅ Have it
- [ ] `EMAIL_USER` - Need Gmail app password
- [ ] `EMAIL_PASSWORD` - Need Gmail app password
- [ ] `DATABASE_URL` - Will be provided by Railway

### ✅ Accounts Created
- [ ] GitHub account (for code hosting)
- [ ] Vercel account (for frontend)
- [ ] Railway account (for backend)
- [ ] Porkbun DNS access (for domain)

---

## Step 1: Prepare Your Code

### 1.1 Push to GitHub

```bash
# Initialize git (if not done)
cd C:\Users\anupt\Documents\GitHub_Projects\strengthTrainingApp
git init
git add .
git commit -m "Initial commit - LiftOff MVP"

# Create GitHub repo and push
# Go to github.com → New Repository → "liftoff-mvp"
git remote add origin https://github.com/YOUR_USERNAME/liftoff-mvp.git
git branch -M main
git push -u origin main
```

### 1.2 Update Backend for PostgreSQL

**File: `backend/prisma/schema.prisma`**

Change:
```prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

To:
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

**Install PostgreSQL dependencies**:
```bash
cd backend
npm install pg
```

**Test locally (optional)**:
```bash
# Install PostgreSQL locally to test
# Or skip and test in production
```

### 1.3 Add Build Scripts

**File: `backend/package.json`**

Ensure you have:
```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts"
  }
}
```

**Create `backend/tsconfig.json`** (should already exist):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

---

## Step 2: Deploy Backend to Railway

### 2.1 Create Railway Project

1. Go to: https://railway.app/
2. Click **"Start a New Project"**
3. Select **"Deploy from GitHub repo"**
4. Authorize Railway to access your GitHub
5. Select your `liftoff-mvp` repository

### 2.2 Configure Backend Service

1. **Root Directory**: `/backend`
2. **Build Command**: `npm install && npx prisma generate && npm run build`
3. **Start Command**: `npm start`
4. **Watch Paths**: `/backend/**`

### 2.3 Add PostgreSQL Database

1. In your Railway project, click **"+ New"**
2. Select **"Database"** → **"Add PostgreSQL"**
3. Railway will automatically:
   - Create database
   - Set `DATABASE_URL` environment variable
   - Connect it to your backend service

### 2.4 Add Environment Variables

In Railway, go to your backend service → **Variables** tab:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=${{Postgres.DATABASE_URL}}
OPENAI_API_KEY=your_openai_api_key_here
TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
NOTIFICATION_PHONE=your_notification_phone_here
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_gmail_app_password_here
```

### 2.5 Run Database Migrations

In Railway, go to your backend service → **Settings** tab → **One-off Commands**:

```bash
npx prisma migrate deploy
```

Or SSH into the service:
```bash
railway run npx prisma migrate deploy
```

### 2.6 Get Your Backend URL

Railway will give you a URL like:
```
https://liftoff-backend-production-abc123.up.railway.app
```

**Copy this URL** - you'll need it for Vercel!

### 2.7 Test Backend

Visit: `https://your-backend-url.up.railway.app/health`

Should see:
```json
{
  "status": "ok",
  "message": "LiftOff API is running"
}
```

---

## Step 3: Deploy Frontend to Vercel

### 3.1 Update API URL in Frontend

**File: `frontend-v2/vercel.json`** (already created)

Update line 8:
```json
"destination": "https://liftoff-backend-production-abc123.up.railway.app/api/$1"
```

Replace with your actual Railway backend URL!

### 3.2 Deploy to Vercel

**Option A: Vercel CLI**
```bash
cd frontend-v2
npm install -g vercel
vercel
```

**Option B: Vercel Dashboard**
1. Go to: https://vercel.com/
2. Click **"Add New Project"**
3. Import your GitHub repo
4. **Root Directory**: `frontend-v2`
5. **Framework Preset**: Vite
6. **Build Command**: `npm run build:client`
7. **Output Directory**: `dist/public`
8. Click **"Deploy"**

### 3.3 Verify Deployment

Vercel will give you a URL like:
```
https://liftoff-mvp.vercel.app
```

Test it:
- [ ] Homepage loads
- [ ] Waitlist form works
- [ ] "Try the MVP" button works
- [ ] Onboarding flow works
- [ ] Backend API calls work

---

## Step 4: Connect Custom Domain

### 4.1 Add Domain in Vercel

1. Go to Vercel Dashboard → Your Project
2. Click **"Settings"** → **"Domains"**
3. Add domain: `liftoffmvp.io`
4. Add domain: `www.liftoffmvp.io`

Vercel will show you DNS records needed.

### 4.2 Update Porkbun DNS

1. Login to Porkbun: https://porkbun.com/
2. Go to your domain: `liftoffmvp.io`
3. Click **"DNS Records"**

**Add these records** (Vercel will tell you exact values):

```
Type: A
Host: @
Answer: 76.76.21.21
TTL: 600

Type: CNAME
Host: www
Answer: cname.vercel-dns.com
TTL: 600
```

### 4.3 Wait for DNS Propagation

- Usually takes 5-60 minutes
- Check status: https://www.whatsmydns.net/

### 4.4 Verify SSL Certificate

Vercel automatically provisions SSL certificates.

Visit: `https://liftoffmvp.io` (should have 🔒)

---

## Step 5: Post-Deployment Testing

### 5.1 Test Full Flow

- [ ] Visit `https://liftoffmvp.io`
- [ ] Join waitlist → SMS received
- [ ] Click "Try the MVP"
- [ ] Select a lift (e.g., Flat Bench Press)
- [ ] Enter user profile (height, weight)
- [ ] Continue to snapshot
- [ ] Enter lift data (weight, sets, reps)
- [ ] Continue to diagnostic chat
- [ ] Answer AI questions
- [ ] View generated plan
- [ ] Click "New session" → restarts flow

### 5.2 Check Backend Logs

In Railway:
1. Go to your backend service
2. Click **"Deployments"**
3. View logs
4. Look for:
   - ✓ Server started
   - ✓ Database connected
   - ✓ API requests
   - ✗ Any errors

### 5.3 Monitor Costs

**Railway Free Tier**:
- $5/month credit (renews monthly)
- Should be enough for MVP
- Monitor usage in dashboard

**Vercel**:
- Unlimited for personal projects
- No credit card needed

---

## Step 6: Optional Improvements

### 6.1 Custom Railway Domain (Optional)

Add custom domain for API:
```
https://api.liftoffmvp.io
```

1. In Railway → Backend service → Settings → Domains
2. Add custom domain
3. Update Porkbun DNS with Railway's CNAME

### 6.2 Analytics (Optional)

Add Vercel Analytics:
1. Vercel Dashboard → Your Project → Analytics
2. Enable (free for hobby projects)
3. See page views, performance

### 6.3 Monitoring (Optional)

Set up error tracking:
- **Sentry** (free tier): Error monitoring
- **LogRocket** (free tier): Session replay
- **Posthog** (free tier): Analytics

---

## Troubleshooting

### Backend Not Connecting

**Symptoms**: API calls fail, 500 errors

**Check**:
1. Railway logs for errors
2. Environment variables set correctly
3. Database migrations ran
4. `DATABASE_URL` format: `postgresql://...`

**Fix**:
```bash
railway run npx prisma migrate deploy
railway logs
```

### Frontend Not Loading

**Symptoms**: Blank page, 404 errors

**Check**:
1. Vercel build logs
2. Build command correct
3. Output directory correct
4. API URL in `vercel.json` correct

**Fix**:
```bash
# Redeploy
vercel --prod
```

### Domain Not Working

**Symptoms**: DNS not resolving

**Check**:
1. DNS records in Porkbun correct
2. Wait 1 hour for propagation
3. Check: https://www.whatsmydns.net/

**Fix**:
- Verify DNS records match Vercel's requirements
- Clear browser cache

### SMS Not Sending

**Symptoms**: No SMS received on waitlist signup

**Check**:
1. Twilio credentials correct in Railway
2. Railway logs for Twilio errors
3. Twilio Console for message status

**Fix**:
- Verify phone number format: `+15199938342`
- Check Twilio account balance
- Verify phone number in Twilio (if trial account)

---

## Success Criteria ✅

- [ ] Code pushed to GitHub
- [ ] Backend deployed to Railway
- [ ] Database connected and migrated
- [ ] Frontend deployed to Vercel
- [ ] Custom domain `liftoffmvp.io` working
- [ ] HTTPS enabled (🔒)
- [ ] Waitlist SMS notifications working
- [ ] Full user flow tested end-to-end
- [ ] No errors in production logs
- [ ] App is fast and responsive

---

## Cost Summary

| Service | Monthly Cost | What It Does |
|---------|--------------|--------------|
| Vercel | **FREE** | Frontend hosting |
| Railway | **FREE** ($5 credit) | Backend + PostgreSQL |
| Porkbun | **$10/year** | Domain (already paid) |
| Twilio | **Pay-as-you-go** | SMS ($0.0075/SMS) |
| **Total** | **~$0-1/month** | Full production app |

---

## What's Next?

After deployment:
1. ✅ Share on social media
2. ✅ Get user feedback
3. ✅ Monitor usage and costs
4. ✅ Iterate based on feedback
5. ✅ Scale up when needed (upgrade Railway plan)

**Your MVP is production-ready!** 🚀
