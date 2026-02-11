# Quick Deploy to liftoffmvp.io 🚀

## TL;DR - Deploy in 15 Minutes

### Prerequisites
- [ ] GitHub account
- [ ] Vercel account (free)
- [ ] Railway account (free)
- [ ] Porkbun access (for DNS)

---

## Step 1: Push to GitHub (2 min)

```bash
cd C:\Users\anupt\Documents\GitHub_Projects\strengthTrainingApp
git init
git add .
git commit -m "LiftOff MVP ready for deployment"

# Create repo on github.com → "liftoff-mvp"
git remote add origin https://github.com/YOUR_USERNAME/liftoff-mvp.git
git branch -M main
git push -u origin main
```

---

## Step 2: Deploy Backend to Railway (5 min)

1. Go to: https://railway.app/
2. **New Project** → **Deploy from GitHub**
3. Select your `liftoff-mvp` repo
4. **Settings**:
   - Root: `/backend`
   - Build: `npm install && npx prisma generate && npm run build`
   - Start: `npm start`

5. **Add PostgreSQL**: Click "+ New" → Database → PostgreSQL

6. **Add Variables**:
   ```env
   NODE_ENV=production
   OPENAI_API_KEY=your_openai_api_key_here
   TWILIO_ACCOUNT_SID=your_twilio_account_sid_here
   TWILIO_AUTH_TOKEN=your_twilio_auth_token_here
   TWILIO_PHONE_NUMBER=your_twilio_phone_number_here
   NOTIFICATION_PHONE=+15199938342
   ```

7. **Copy Backend URL**: `https://liftoff-backend-xxx.up.railway.app`

---

## Step 3: Update Frontend Config (1 min)

Edit `frontend-v2/vercel.json` line 8:

```json
"destination": "https://YOUR-RAILWAY-URL.up.railway.app/api/$1"
```

Commit and push:
```bash
git add frontend-v2/vercel.json
git commit -m "Update backend URL"
git push
```

---

## Step 4: Deploy Frontend to Vercel (3 min)

1. Go to: https://vercel.com/
2. **New Project** → Import from GitHub
3. Select `liftoff-mvp`
4. **Settings**:
   - Root: `frontend-v2`
   - Framework: Vite
   - Build: `npm run build:client`
   - Output: `dist/public`
5. Click **Deploy**

---

## Step 5: Connect Domain (4 min)

### In Vercel:
1. Project → Settings → Domains
2. Add: `liftoffmvp.io` and `www.liftoffmvp.io`
3. Copy the DNS records shown

### In Porkbun:
1. Login → Domain → DNS Records
2. Add:
   ```
   Type: A
   Host: @
   Answer: 76.76.21.21
   
   Type: CNAME
   Host: www
   Answer: cname.vercel-dns.com
   ```

3. Wait 5-60 minutes for DNS propagation

---

## Step 6: Test (2 min)

Visit: `https://liftoffmvp.io`

Test:
- [ ] Homepage loads
- [ ] Join waitlist → SMS received
- [ ] Try MVP → Full flow works
- [ ] No console errors

---

## Done! 🎉

Your app is live at: **https://liftoffmvp.io**

---

## Troubleshooting

### Backend Error
```bash
# Check Railway logs
railway logs

# Run migrations
railway run npx prisma migrate deploy
```

### Frontend Not Loading
```bash
# Check Vercel build logs
# Redeploy if needed
vercel --prod
```

### Domain Not Working
- Wait 1 hour for DNS
- Check: https://www.whatsmydns.net/
- Verify DNS records in Porkbun

---

## Need More Details?

- Full guide: `DEPLOYMENT_CHECKLIST.md`
- Hosting options: `HOSTING_GUIDE.md`
- Changes made: `CHANGES_SUMMARY.md`
