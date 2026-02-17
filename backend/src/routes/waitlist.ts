import { Router } from 'express';
import { z } from 'zod';
import twilio from 'twilio';
import * as nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';

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

// Initialize SendGrid
let useSendGrid = false;
if (process.env.SENDGRID_API_KEY) {
  try {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    useSendGrid = true;
    console.log('✓ SendGrid initialized');
  } catch (error) {
    console.warn('⚠ SendGrid initialization failed');
  }
}

// Initialize email transporter (fallback to Gmail if SendGrid not configured)
let emailTransporter: any = null;
if (!useSendGrid && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD) {
  try {
    emailTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    console.log('✓ Email transporter (Gmail) initialized');
  } catch (error) {
    console.warn('⚠ Email transporter initialization failed, email notifications disabled');
  }
} else if (!useSendGrid) {
  console.log('⚠ Email not configured (neither SendGrid nor Gmail configured)');
}

// Helper function to send email
async function sendEmail(to: string, subject: string, html: string, from?: string) {
  const fromEmail = from || process.env.EMAIL_FROM || 'team@airthreads.ai';

  if (useSendGrid) {
    // Use SendGrid
    await sgMail.send({
      to,
      from: fromEmail,
      subject,
      html,
      text: html.replace(/<[^>]*>/g, ''), // Strip HTML for plain text fallback
    });
  } else if (emailTransporter) {
    // Use Gmail/Nodemailer
    await emailTransporter.sendMail({
      from: `"LiftOff Team" <${fromEmail}>`,
      to,
      subject,
      html,
    });
  } else {
    throw new Error('No email service configured');
  }
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
    if (useSendGrid || emailTransporter) {
      try {
        await sendEmail(
          'anuptaislam33@gmail.com',
          `🚀 ${data.email} has joined the waitlist`,
          `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #2563eb;">🚀 New LiftOff Waitlist Signup!</h2>
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Email:</strong> ${data.email}</p>
                ${data.name ? `<p><strong>Name:</strong> ${data.name}</p>` : ''}
                ${data.phone ? `<p><strong>Phone:</strong> ${data.phone}</p>` : ''}
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              </div>
            </div>
          `
        );
        console.log('✓ Email notification sent to anuptaislam33@gmail.com');
      } catch (emailError: any) {
        console.error('✗ Email sending failed:', emailError.message || emailError);
      }
    } else {
      console.log('⚠ Email not sent - Email not configured');
    }

    // Send confirmation email to user
    if (useSendGrid || emailTransporter) {
      try {
        await sendEmail(
        data.email,
        '🎉 Congratulations! You\'re on the LiftOff Waitlist',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); padding: 40px 20px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 36px; font-weight: bold;">Congratulations! 🎉</h1>
            </div>
            <div style="padding: 40px 30px; background: white;">
              <p style="font-size: 18px; line-height: 1.6; color: #374151; margin-bottom: 20px;">
                Hi${data.name ? ` ${data.name}` : ' there'},
              </p>
              <p style="font-size: 16px; line-height: 1.8; color: #374151; margin-bottom: 20px;">
                You've signed up for the <strong>LiftOff MVP</strong> and we're beyond happy to have you on board!
                We're building something truly special for lifters who are serious about breaking through plateaus
                and reaching new PRs.
              </p>
              <div style="background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); padding: 25px; border-radius: 10px; margin: 30px 0; border-left: 4px solid #2563eb;">
                <h3 style="color: #2563eb; margin-top: 0; font-size: 20px;">🚀 What's Next?</h3>
                <p style="color: #374151; line-height: 1.8; margin-bottom: 15px;">
                  From here on out, we'll keep you updated with:
                </p>
                <ul style="color: #374151; line-height: 1.9; margin: 0; padding-left: 20px;">
                  <li><strong>Product updates</strong> and new features as we build</li>
                  <li><strong>Our official launch</strong> announcement (you'll be first to know!)</li>
                  <li><strong>Exclusive early access</strong> to beta features</li>
                  <li><strong>Special discounts</strong> and promotions for our services</li>
                  <li><strong>Tips & insights</strong> on strength training and breaking plateaus</li>
                </ul>
              </div>
              <p style="font-size: 16px; line-height: 1.8; color: #374151; margin-bottom: 20px;">
                We're committed to building the best AI-powered lift diagnostic tool out there,
                and your support means everything to us. Stay tuned for exciting updates coming soon!
              </p>
              <div style="text-align: center; margin: 35px 0;">
                <a href="https://luciuslab.xyz:4009/api/lifts" style="display: inline-block; background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 6px rgba(37, 99, 235, 0.3);">
                  Try the MVP Now
                </a>
              </div>
              <p style="font-size: 16px; line-height: 1.6; color: #374151; margin-top: 30px;">
                Thanks for being part of this journey!<br><br>
                <strong style="color: #2563eb;">The LiftOff Team</strong>
              </p>
            </div>
            <div style="background: #f9fafb; padding: 25px; text-align: center; border-radius: 0 0 12px 12px; border-top: 1px solid #e5e7eb;">
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">
                <strong>LiftOff</strong> - AI-Powered Lift Diagnostics
              </p>
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                You're receiving this email because you signed up for the LiftOff waitlist.
              </p>
            </div>
          </div>
        `
      );
        console.log('✓ Confirmation email sent to user:', data.email);
      } catch (confirmError) {
        console.error('✗ User confirmation email failed:', confirmError);
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
