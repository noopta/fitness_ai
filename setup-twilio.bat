@echo off
echo ========================================
echo   LiftOff Twilio Setup
echo ========================================
echo.
echo Adding Twilio credentials to backend/.env...
echo.

cd backend

(
echo.
echo # Twilio SMS Configuration
echo TWILIO_ACCOUNT_SID="your_twilio_account_sid_here"
echo TWILIO_AUTH_TOKEN="your_twilio_auth_token_here"
echo TWILIO_PHONE_NUMBER="your_twilio_phone_number_here"
echo NOTIFICATION_PHONE="your_notification_phone_here"
) >> .env

echo.
echo ✓ Twilio credentials added to backend/.env
echo.
echo Now restart your backend server:
echo   1. Press Ctrl+C in the backend terminal
echo   2. Run: npm run dev
echo.
echo Then test by joining the waitlist at http://localhost:5000
echo You should receive an SMS at (519) 993-8342
echo.
pause
