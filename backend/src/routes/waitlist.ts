import { Router } from 'express';
import { z } from 'zod';
import twilio from 'twilio';
import * as nodemailer from 'nodemailer';

const router = Router();

const joinWaitlistSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  phone: z.string().optional(),
});

// Initialize Twilio client if credentials are provided
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && 
    process.env.TWILIO_ACCOUNT_SID.startsWith('AC')) {
  try {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('✓ Twilio initialized');
  } catch (error) {
    console.warn('⚠ Twilio initialization failed, SMS notifications disabled');
  }
} else {
  console.log('⚠ Twilio not configured, SMS notifications disabled');
}

// Initialize email transporter (optional)
let emailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
  try {
    const createTransporter = nodemailer.createTransporter || (nodemailer as any).default?.createTransporter;
    if (createTransporter) {
      emailTransporter = createTransporter({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASSWORD,
        },
      });
      console.log('✓ Email transporter initialized');
    }
  } catch (error) {
    console.warn('⚠ Email transporter initialization failed, email notifications disabled');
  }
} else {
  console.log('⚠ Email not configured (EMAIL_USER/EMAIL_PASSWORD missing), email notifications disabled');
}

// POST /api/waitlist - Join waitlist
router.post('/waitlist', async (req, res) => {
  try {
    const data = joinWaitlistSchema.parse(req.body);
    
    console.log('New waitlist signup:', data);

    // Send SMS notification if Twilio is configured
    if (twilioClient && process.env.TWILIO_PHONE_NUMBER && process.env.NOTIFICATION_PHONE) {
      try {
        const message = await twilioClient.messages.create({
          body: `🚀 New LiftOff Waitlist Signup!\nEmail: ${data.email}${data.name ? `\nName: ${data.name}` : ''}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: process.env.NOTIFICATION_PHONE,
        });
        console.log('✓ SMS notification sent to', process.env.NOTIFICATION_PHONE, '- SID:', message.sid);
      } catch (smsError: any) {
        console.error('✗ SMS sending failed:', smsError.message || smsError);
      }
    } else {
      console.log('⚠ SMS not sent - Twilio not fully configured');
    }

    // Send email notification
    if (emailTransporter) {
      try {
        await emailTransporter.sendMail({
          from: '"LiftOff Waitlist" <noreply@liftoff.app>',
          to: 'anuptaislam33@gmail.com',
          subject: `🚀 ${data.email} has joined the waitlist`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">🚀 New LiftOff Waitlist Signup!</h2>
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Email:</strong> ${data.email}</p>
                ${data.name ? `<p><strong>Name:</strong> ${data.name}</p>` : ''}
                ${data.phone ? `<p><strong>Phone:</strong> ${data.phone}</p>` : ''}
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              </div>
            </div>
          `,
        });
        console.log('✓ Email notification sent to anuptaislam33@gmail.com');
      } catch (emailError: any) {
        console.error('✗ Email sending failed:', emailError.message || emailError);
      }
    } else {
      console.log('⚠ Email not sent - Email not configured');
    }

    // Send confirmation email to user
    if (emailTransporter) {
      try {
        await emailTransporter.sendMail({
        from: '"LiftOff" <noreply@liftoff.app>',
        to: data.email,
        subject: '🚀 Welcome to the LiftOff Waitlist!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); padding: 40px 20px; border-radius: 8px 8px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 32px;">Welcome to LiftOff! 🚀</h1>
            </div>
            <div style="padding: 40px 20px; background: white;">
              <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                Hi${data.name ? ` ${data.name}` : ''},
              </p>
              <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                Thank you for joining the LiftOff waitlist! We're building something special for lifters like you who are serious about breaking through plateaus.
              </p>
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h3 style="color: #2563eb; margin-top: 0;">What to Expect:</h3>
                <ul style="color: #374151; line-height: 1.8;">
                  <li>🎯 AI-powered diagnosis of your weak points</li>
                  <li>💪 Personalized accessory recommendations</li>
                  <li>📊 Data-driven insights from your current lifts</li>
                  <li>🚀 Launch updates and early access opportunities</li>
                </ul>
              </div>
              <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                In the meantime, feel free to try our <a href="http://localhost:5000/mvp" style="color: #2563eb; text-decoration: none;">MVP prototype</a> to see what we're building!
              </p>
              <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                Talk soon,<br>
                <strong>The LiftOff Team</strong>
              </p>
            </div>
            <div style="background: #f9fafb; padding: 20px; text-align: center; border-radius: 0 0 8px 8px;">
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                LiftOff - AI-Powered Lift Diagnostics
              </p>
            </div>
          </div>
        `,
      });
        console.log('Confirmation email sent to user');
      } catch (confirmError) {
        console.error('User confirmation email failed:', confirmError);
      }
    }

    res.json({ 
      success: true, 
      message: 'Successfully joined waitlist! Check your email for confirmation.' 
    });
    
  } catch (error) {
    console.error('Error processing waitlist signup:', error);
    res.status(400).json({ error: 'Invalid request data' });
  }
});

export default router;
