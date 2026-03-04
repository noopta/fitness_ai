# Twilio SMS Setup Guide

## Quick Setup

To enable SMS notifications when users join the waitlist, you need to configure Twilio credentials.

### Step 1: Get Twilio Credentials

1. Go to https://www.twilio.com/try-twilio
2. Sign up for a free account (gets you $15 credit + free trial phone number)
3. Once logged in, go to https://console.twilio.com/
4. You'll see your **Account SID** and **Auth Token** on the dashboard

### Step 2: Get a Phone Number

1. In the Twilio Console, go to **Phone Numbers** → **Manage** → **Buy a number**
2. Search for a number (US numbers are free on trial)
3. Purchase the number (uses your free credit)
4. Copy the phone number (format: +1234567890)

### Step 3: Configure Backend

Open `backend/.env` and add these lines:

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
TWILIO_AUTH_TOKEN="your_auth_token_here"
TWILIO_PHONE_NUMBER="+1234567890"
NOTIFICATION_PHONE="+15199938342"
```

**Replace:**
- `TWILIO_ACCOUNT_SID` → Your Account SID from Twilio Console
- `TWILIO_AUTH_TOKEN` → Your Auth Token from Twilio Console  
- `TWILIO_PHONE_NUMBER` → The phone number you purchased from Twilio
- `NOTIFICATION_PHONE` → Your phone number (+15199938342) where you want to receive notifications

### Step 4: Restart Backend

```bash
cd backend
npm run dev
```

You should see:
```
✓ Twilio initialized
✓ Email transporter initialized
🚀 LiftOff API running on http://localhost:3001
```

### Step 5: Test It

1. Go to http://localhost:5000
2. Enter your email in the waitlist form
3. Click "Join waitlist"
4. You should receive an SMS at +15199938342 with the signup details!

## SMS Message Format

When someone joins the waitlist, you'll receive:

```
🚀 New LiftOff Waitlist Signup!
Email: user@example.com
```

## Troubleshooting

### "Twilio not configured" in console
- Check that your Account SID starts with "AC"
- Verify all credentials are in `backend/.env`
- Make sure there are no quotes issues or extra spaces

### SMS not sending
- **Trial Account Limitation**: Twilio trial accounts can only send SMS to verified phone numbers
- Go to https://console.twilio.com/us1/develop/phone-numbers/manage/verified
- Click "Add a new Caller ID" and verify +15199938342
- Follow the verification process (you'll receive a code via SMS)

### "Unverified number" error
- You need to verify +15199938342 in your Twilio account
- Or upgrade to a paid account (removes this restriction)

## Cost

- **Trial**: Free $15 credit, can send to verified numbers only
- **Paid**: ~$0.0075 per SMS (very cheap!)
- **Phone Number**: $1/month

## Current Backend Configuration

The backend is already set up to:
- ✅ Check for Twilio credentials safely
- ✅ Send SMS to +15199938342 when someone joins waitlist
- ✅ Send email to anuptaislam33@gmail.com
- ✅ Send confirmation email to the user
- ✅ Gracefully handle missing credentials (won't crash)

Just add your Twilio credentials to `.env` and restart!

---

## Alternative: Email Only

If you don't want to set up Twilio, the app will still:
- ✅ Send email notifications to anuptaislam33@gmail.com
- ✅ Send confirmation emails to users
- ✅ Log all signups to console

The SMS feature is optional but highly recommended for instant notifications! 📱
