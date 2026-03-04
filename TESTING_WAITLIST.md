# Testing Waitlist Notifications 🚀

## Current Status

✅ **Backend Running**: `http://localhost:3001`
✅ **Frontend Running**: `http://localhost:5001`
✅ **Twilio Configured**: SMS notifications enabled
⚠️ **Email Optional**: Requires Gmail app password setup

## Quick Test

### Step 1: Open the App
Navigate to: **http://localhost:5001/**

### Step 2: Join the Waitlist
1. Scroll to the "Get notified at launch" section
2. Enter any email address (e.g., `test@example.com`)
3. Watch the button become **bold and highlighted** as you type
4. Click "Join waitlist"

### Step 3: Verify Notifications

#### What You Should See:
- ✅ Success toast: "🎉 You've joined the waitlist! Check your email for confirmation."
- ✅ Email field clears
- ✅ Button returns to normal state

#### What You Should Receive:
- 📱 **SMS to +15199938342**:
  ```
  🚀 New LiftOff Waitlist Signup!
  Email: test@example.com
  ```

- 📧 **Email to anuptaislam33@gmail.com** (if email is configured):
  ```
  Subject: 🚀 test@example.com has joined the waitlist
  
  Body: New LiftOff Waitlist Signup!
  Email: test@example.com
  Time: [timestamp]
  ```

### Step 4: Check Backend Console
You should see in the backend terminal:

```
New waitlist signup: { email: 'test@example.com' }
✓ SMS notification sent to +15199938342 - SID: SM...
⚠ Email not sent - Email not configured
```

## If SMS Not Received

### Check Twilio Status
1. Login to [Twilio Console](https://console.twilio.com/)
2. Go to **Messaging** → **Logs**
3. Look for recent messages to +15199938342
4. Check delivery status

### Verify Configuration
Check `backend/.env` has:
```env
TWILIO_ACCOUNT_SID="your_twilio_account_sid_here"
TWILIO_AUTH_TOKEN="your_twilio_auth_token_here"
TWILIO_PHONE_NUMBER="your_twilio_phone_number_here"
NOTIFICATION_PHONE="your_notification_phone_here"
```

### Check Backend Logs
Look for error messages in the backend console:
- ✗ SMS sending failed: [error message]

Common issues:
- Invalid phone number format
- Twilio account not verified
- Insufficient Twilio credits
- Phone number not verified in trial account

## Enable Email Notifications

To receive email notifications to anuptaislam33@gmail.com:

### Step 1: Generate Gmail App Password
1. Go to [Google Account Settings](https://myaccount.google.com/)
2. Navigate to **Security** → **2-Step Verification**
3. Scroll to **App passwords**
4. Generate a new app password for "Mail"
5. Copy the 16-character password

### Step 2: Update .env
Add to `backend/.env`:
```env
EMAIL_USER=anuptaislam33@gmail.com
EMAIL_PASSWORD=your_16_char_app_password
```

### Step 3: Restart Backend
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

## Testing Different Scenarios

### Test 1: Valid Email
```
Input: test@example.com
Expected: ✅ Success toast, SMS sent
```

### Test 2: Invalid Email
```
Input: notanemail
Expected: ❌ Error toast: "Please enter a valid email."
```

### Test 3: Empty Email
```
Input: (empty)
Click button
Expected: Button is clickable but faded, shows error toast
```

### Test 4: Network Error
```
Stop backend
Try to join waitlist
Expected: ❌ Error toast: "Failed to join waitlist. Please try again."
```

## Debugging

### Backend Not Responding
```bash
# Check if backend is running
netstat -ano | findstr :3001

# If not running, start it
cd backend
npm run dev
```

### Frontend Not Responding
```bash
# Check if frontend is running
netstat -ano | findstr :5001

# If not running, start it
cd frontend-v2
npm run dev:client
```

### CORS Errors
Check that `backend/src/index.ts` has:
```typescript
app.use(cors());
```

### Twilio Errors
Common error codes:
- **21211**: Invalid 'To' phone number
- **21408**: Permission to send SMS not enabled
- **21606**: The "From" phone number is not verified
- **21610**: Message cannot be sent to unverified number (trial accounts)

## Success Checklist

- [ ] Backend running on port 3001
- [ ] Frontend running on port 5001
- [ ] Can access http://localhost:5001/
- [ ] Email input field works
- [ ] Button becomes bold when typing
- [ ] Button shows "Joining..." when clicked
- [ ] Success toast appears after submission
- [ ] SMS received on +15199938342
- [ ] Email received on anuptaislam33@gmail.com (if configured)
- [ ] Backend console shows success logs

## Next Steps

Once testing is complete:
1. ✅ Verify SMS notifications work
2. ⚠️ Set up email notifications (optional)
3. 🚀 Test the full user flow (onboarding → snapshot → diagnostic → plan)
4. 📝 Document any issues or improvements needed
