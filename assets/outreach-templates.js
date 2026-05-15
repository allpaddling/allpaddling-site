/*
 * Reusable outreach campaign templates.
 *
 * Each entry is a fully-prepared one-click send: subject, plain-text body,
 * and full HTML body. The Outreach page renders these as a per-row dropdown
 * next to a "Send" button — pick the template, hit send, the email fires
 * through the send-email Edge Function.
 *
 *   - `{{first_name}}` substitution is applied by admin-outreach.js
 *   - The unsubscribe footer is appended automatically; don't include one in
 *     the template body or you'll get a duplicate
 *
 * To add a new template, append an object to OUTREACH_TEMPLATES with a unique
 * `id` and the four content fields (label, subject, text, html).
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------
  // Template: Newsletter launch (May 2026)
  // ---------------------------------------------------------------
  // Announces the new allpaddling.online site to newsletter subscribers,
  // leading with the four Progressive 4-Week Plans (Prone / SUP / OC / Ski)
  // and treating Custom as a one-line mention for race-goal paddlers.
  //
  // Pricing language matches Stripe reality: A$80/month, not "/ 4 weeks".

  const NEWSLETTER_LAUNCH_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The new All Paddling is live</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#1f2937; line-height:1.55;">

<!-- Preheader (hidden) -->
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">
  Progressive 4-week plans for Prone, SUP, OC and Surf Ski — built on the same 5-zone method I use with elite paddlers. A$80/month, no lock-in.
</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f6f8;">
  <tr>
    <td align="center" style="padding: 32px 16px;">

      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px; width:100%; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">

        <!-- Header / wordmark -->
        <tr>
          <td style="padding: 32px 40px 8px 40px; text-align:left; border-bottom:1px solid #e5e7eb;">
            <a href="https://allpaddling.online" style="text-decoration:none; color:#0e7490; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-size: 22px; font-weight:700; letter-spacing: -0.01em;">
              All&nbsp;Paddling
            </a>
            <div style="font-size: 12px; color:#64748b; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 4px;">A new home for paddlers</div>
          </td>
        </tr>

        <!-- Hero -->
        <tr>
          <td style="padding: 32px 40px 8px 40px;">
            <h1 style="margin:0 0 12px 0; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-size: 28px; line-height: 1.2; color:#0f172a; font-weight:700;">
              The new All Paddling is live.
            </h1>
            <p style="margin: 0; font-size: 16px; color:#334155;">
              A note from me — Mick.
            </p>
          </td>
        </tr>

        <!-- Personal intro -->
        <tr>
          <td style="padding: 16px 40px 8px 40px;">
            <p style="margin: 0 0 14px 0; font-size: 16px; color:#1f2937;">
              After a lot of work behind the scenes, the new <strong>All Paddling</strong> is finally live at
              <a href="https://allpaddling.online" style="color:#0e7490; text-decoration: underline;">allpaddling.online</a>. The same training philosophy I've used with elite paddlers for years is now in a place where any paddler — at any level, in any discipline — can plug in and start training with real structure.
            </p>
            <p style="margin: 0; font-size: 16px; color:#1f2937;">
              You're on this list because you've already shown interest in training smarter. I wanted you to be among the first to see what's there.
            </p>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding: 24px 40px 0 40px;">
            <hr style="border:0; border-top:1px solid #e5e7eb; margin:0;">
          </td>
        </tr>

        <!-- Progressive Plans section -->
        <tr>
          <td style="padding: 24px 40px 8px 40px;">
            <div style="font-size: 12px; color:#0e7490; letter-spacing: 0.08em; text-transform: uppercase; font-weight:600; margin-bottom: 8px;">Progressive 4-Week Plans</div>
            <h2 style="margin:0 0 12px 0; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-size: 22px; line-height: 1.25; color:#0f172a; font-weight:700;">
              Why I built them.
            </h2>
            <p style="margin: 0 0 16px 0; font-size: 16px; color:#1f2937;">
              Most paddlers I talk to are putting in the hours but plateauing. They paddle hard, but the same way every session. The Progressive Plans fix that.
            </p>
          </td>
        </tr>

        <!-- Benefits list -->
        <tr>
          <td style="padding: 0 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size: 15px; color:#1f2937;">
              <tr>
                <td style="padding: 0 0 14px 0; vertical-align: top; width: 28px;">
                  <span style="display:inline-block; width:18px; height:18px; border-radius:50%; background-color:#ecfeff; color:#0e7490; text-align:center; font-size: 12px; line-height: 18px; font-weight:700;">✓</span>
                </td>
                <td style="padding: 0 0 14px 0;">
                  <strong>Interval + distance sessions</strong> that target a specific energy system every session — not just "go hard, go easy."
                </td>
              </tr>
              <tr>
                <td style="padding: 0 0 14px 0; vertical-align: top; width: 28px;">
                  <span style="display:inline-block; width:18px; height:18px; border-radius:50%; background-color:#ecfeff; color:#0e7490; text-align:center; font-size: 12px; line-height: 18px; font-weight:700;">✓</span>
                </td>
                <td style="padding: 0 0 14px 0;">
                  <strong>Progressive weekly load</strong> so your fitness compounds across the block, instead of repeating week one four times.
                </td>
              </tr>
              <tr>
                <td style="padding: 0 0 14px 0; vertical-align: top; width: 28px;">
                  <span style="display:inline-block; width:18px; height:18px; border-radius:50%; background-color:#ecfeff; color:#0e7490; text-align:center; font-size: 12px; line-height: 18px; font-weight:700;">✓</span>
                </td>
                <td style="padding: 0 0 14px 0;">
                  <strong>5-zone pace targets (TZ1&ndash;TZ5)</strong> calibrated to your threshold pace using the built-in pace calculator. No more guessing what "moderate" means.
                </td>
              </tr>
              <tr>
                <td style="padding: 0 0 14px 0; vertical-align: top; width: 28px;">
                  <span style="display:inline-block; width:18px; height:18px; border-radius:50%; background-color:#ecfeff; color:#0e7490; text-align:center; font-size: 12px; line-height: 18px; font-weight:700;">✓</span>
                </td>
                <td style="padding: 0 0 14px 0;">
                  <strong>Discipline-specific programming</strong> for Prone, SUP, OC and Surf Ski — because a SUP catch isn't a ski catch, and your training shouldn't pretend otherwise.
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Price callout -->
        <tr>
          <td style="padding: 8px 40px 24px 40px;">
            <div style="background-color:#ecfeff; border:1px solid #a5f3fc; border-radius: 10px; padding: 16px 20px; text-align:center;">
              <div style="font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-size: 22px; font-weight:700; color:#0f172a;">A$80 <span style="font-size: 14px; font-weight: 500; color:#64748b;">per month</span></div>
              <div style="font-size: 14px; color:#0e7490; font-weight:600; margin-top: 4px;">✓ Cancel any time · no lock-in</div>
            </div>
          </td>
        </tr>

        <!-- Primary CTA -->
        <tr>
          <td align="center" style="padding: 0 40px 32px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="border-radius: 8px; background-color:#0e7490;">
                  <a href="https://allpaddling.online/plans.html" style="display:inline-block; padding: 14px 28px; font-size: 16px; font-weight:600; color:#ffffff; text-decoration:none; border-radius: 8px;">
                    Start a Progressive Plan →
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding: 0 40px;">
            <hr style="border:0; border-top:1px solid #e5e7eb; margin:0;">
          </td>
        </tr>

        <!-- Disciplines -->
        <tr>
          <td style="padding: 28px 40px 8px 40px;">
            <div style="font-size: 12px; color:#0e7490; letter-spacing: 0.08em; text-transform: uppercase; font-weight:600; margin-bottom: 8px;">Four disciplines, one methodology</div>
            <h2 style="margin:0 0 16px 0; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-size: 22px; line-height: 1.25; color:#0f172a; font-weight:700;">
              Pick your stroke.
            </h2>
          </td>
        </tr>

        <tr>
          <td style="padding: 0 40px 8px 40px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size: 15px;">
              <tr>
                <td width="50%" valign="top" style="padding: 0 8px 16px 0;">
                  <a href="https://allpaddling.online/plan-prone.html" style="display:block; padding: 14px 16px; border:1px solid #e5e7eb; border-radius: 10px; text-decoration: none; color:#0f172a;">
                    <div style="font-weight:700; font-size: 15px; margin-bottom: 4px;">Prone Paddle Board</div>
                    <div style="font-size: 13px; color:#64748b;">Open-water strength, stroke-by-stroke.</div>
                  </a>
                </td>
                <td width="50%" valign="top" style="padding: 0 0 16px 8px;">
                  <a href="https://allpaddling.online/plan-sup.html" style="display:block; padding: 14px 16px; border:1px solid #e5e7eb; border-radius: 10px; text-decoration: none; color:#0f172a;">
                    <div style="font-weight:700; font-size: 15px; margin-bottom: 4px;">Stand Up Paddle Board</div>
                    <div style="font-size: 13px; color:#64748b;">Balance, economy, race-pace tolerance.</div>
                  </a>
                </td>
              </tr>
              <tr>
                <td width="50%" valign="top" style="padding: 0 8px 0 0;">
                  <a href="https://allpaddling.online/plan-oc.html" style="display:block; padding: 14px 16px; border:1px solid #e5e7eb; border-radius: 10px; text-decoration: none; color:#0f172a;">
                    <div style="font-weight:700; font-size: 15px; margin-bottom: 4px;">Outrigger Canoe</div>
                    <div style="font-size: 13px; color:#64748b;">Structured progression between regattas.</div>
                  </a>
                </td>
                <td width="50%" valign="top" style="padding: 0 0 0 8px;">
                  <a href="https://allpaddling.online/plan-ski.html" style="display:block; padding: 14px 16px; border:1px solid #e5e7eb; border-radius: 10px; text-decoration: none; color:#0f172a;">
                    <div style="font-weight:700; font-size: 15px; margin-bottom: 4px;">Surf Ski</div>
                    <div style="font-size: 13px; color:#64748b;">Speed and the bigger downwind days.</div>
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding: 8px 40px 24px 40px;">
            <p style="margin: 0; font-size: 15px; color:#475569;">
              Pick your discipline. Start the 4 weeks. See what changes.
            </p>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding: 0 40px;">
            <hr style="border:0; border-top:1px solid #e5e7eb; margin:0;">
          </td>
        </tr>

        <!-- A few things worth knowing -->
        <tr>
          <td style="padding: 28px 40px 8px 40px;">
            <h2 style="margin:0 0 12px 0; font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-size: 20px; line-height: 1.3; color:#0f172a; font-weight:700;">
              A few things worth knowing.
            </h2>
            <p style="margin: 0 0 12px 0; font-size: 15px; color:#1f2937;">
              <strong>You can join mid-season.</strong> Your first month is a <em>primer block</em> that settles you in at the right baseline before the calendar progresses.
            </p>
            <p style="margin: 0 0 12px 0; font-size: 15px; color:#1f2937;">
              <strong>The pace calculator is free.</strong> If you just want to find your zones first, the <a href="https://allpaddling.online/pace-calculator.html" style="color:#0e7490;">pace calculator</a> is open to anyone — no sign-up required.
            </p>
            <p style="margin: 0 0 0 0; font-size: 15px; color:#1f2937;">
              <strong>If you have a goal race,</strong> the <a href="https://allpaddling.online/custom-plan.html" style="color:#0e7490;">Custom Season Race Plan</a> is also there — built around your race date with taper and peaking weeks programmed in. For most paddlers who want to train better right now though, a Progressive Plan is where to start.
            </p>
          </td>
        </tr>

        <!-- Sign-off -->
        <tr>
          <td style="padding: 28px 40px 32px 40px;">
            <hr style="border:0; border-top:1px solid #e5e7eb; margin: 0 0 24px 0;">
            <p style="margin: 0 0 14px 0; font-size: 16px; color:#1f2937;">
              I built this because I want paddlers training the right way — not just harder, but smarter. If a Progressive Plan looks like what you've been needing, jump in. A month is enough to feel the difference.
            </p>
            <p style="margin: 0 0 20px 0; font-size: 16px; color:#1f2937;">
              Any questions, just reply to this email.
            </p>
            <p style="margin: 0 0 4px 0; font-size: 16px; color:#1f2937;">See you on the water,</p>
            <p style="margin: 0; font-size: 16px; color:#0f172a; font-weight:600;">Mick Di Betta</p>
            <p style="margin: 0; font-size: 14px; color:#64748b;">All Paddling · <a href="https://allpaddling.online" style="color:#0e7490;">allpaddling.online</a></p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>

</body>
</html>`;

  const NEWSLETTER_LAUNCH_TEXT = `Hi {{first_name}},

Quick note from me — Mick.

After a lot of work behind the scenes, the new All Paddling is finally live at https://allpaddling.online. The same training philosophy I've used with elite paddlers for years is now in a place where any paddler — at any level, in any discipline — can plug in and start training with real structure.

You're on this list because you've already shown interest in training smarter. I wanted you to be among the first to see what's there.

--

WHY I BUILT THE PROGRESSIVE 4-WEEK PLANS

Most paddlers I talk to are putting in the hours but plateauing. They paddle hard, but the same way every session. The Progressive Plans fix that.

Each 4-week plan gives you:

• Interval + distance sessions that target a specific energy system every session — not just "go hard, go easy."

• Progressive weekly load so your fitness compounds across the block, instead of repeating week one four times.

• 5-zone pace targets (TZ1–TZ5) calibrated to your threshold pace using the built-in pace calculator. No more guessing what "moderate" means.

• Discipline-specific programming for Prone, SUP, Outrigger Canoe and Surf Ski — because a SUP catch isn't a ski catch, and your training shouldn't pretend otherwise.

A$80 per month. Cancel any time — no lock-in.

Start a Progressive Plan: https://allpaddling.online/plans.html

--

FOUR DISCIPLINES, ONE METHODOLOGY

• Prone Paddle Board — for prone paddlers building toward open-water racing or paddling stronger week to week.

• Stand Up Paddle Board — designed for SUP-specific demands: balance under load, stroke economy, race-pace tolerance.

• Outrigger Canoe — for OC1 and OC paddlers wanting structured progression between regattas.

• Surf Ski — built for ski paddlers chasing speed and the bigger downwind days.

Pick your discipline. Start the 4 weeks. See what changes.

--

A FEW THINGS WORTH KNOWING

You can join mid-season. Your first month is a primer block that settles you in at the right baseline before the calendar progresses.

The pace calculator is free — find your zones first: https://allpaddling.online/pace-calculator.html

If you have a goal race, the Custom Season Race Plan is there too — built around your race date with taper and peaking weeks. For most paddlers who want to train better right now though, a Progressive Plan is where to start.

https://allpaddling.online/custom-plan.html

--

I built this because I want paddlers training the right way — not just harder, but smarter. If a Progressive Plan looks like what you've been needing, jump in. A month is enough to feel the difference.

Any questions, just reply to this email.

See you on the water,

Mick Di Betta
All Paddling
https://allpaddling.online`;

  // ---------------------------------------------------------------
  // Registry
  // ---------------------------------------------------------------
  root.OUTREACH_TEMPLATES = [
    {
      id:            'newsletter_launch_2026_05',
      label:         'Newsletter launch — May 2026',
      campaign_name: 'Newsletter launch — May 2026',
      subject:       'The new All Paddling is live — train smarter, paddle faster.',
      text:          NEWSLETTER_LAUNCH_TEXT,
      html:          NEWSLETTER_LAUNCH_HTML,
    },
  ];
})(window);
