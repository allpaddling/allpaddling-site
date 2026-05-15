/* ============================================================
   ALL PADDLING — shared nav / footer mount + mobile menu toggle
   Each page has <div id="site-header"></div> and
   <div id="site-footer"></div> placeholders. This script
   fills them in, wires up the mobile nav toggle, and handles
   the footer newsletter signup (POSTs to newsletter-signup
   Edge Function — public, honeypot-protected, anon key OK).
   ============================================================ */

// Supabase project URL + anon key. Hardcoded here because public
// pages don't all load supabase-config.js, and the anon key is
// safe to expose (RLS enforces real access on the server).
const SITE_SUPABASE_URL      = 'https://crlukzkgmydyqpwndjvc.supabase.co';
const SITE_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNybHVremtnbXlkeXFwd25kanZjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNzM2OTUsImV4cCI6MjA5MjY0OTY5NX0.aBKWLnu5frWDNfNuJhw9xkRuvhyduslaLnuMsWm95V4';
const NEWSLETTER_SIGNUP_URL  = `${SITE_SUPABASE_URL}/functions/v1/newsletter-signup`;

const BRAND_MARK_SVG = `
  <span class="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" stroke="none"/>
      <polyline points="3,13 8,13 10,9 14,17 16,13 21,13" stroke="#155e75" stroke-width="2.4" fill="none"/>
    </svg>
  </span>`;

const NAV_LINKS = [
  { href: 'index.html',           label: 'Home',            match: ['/', '/index.html'] },
  { href: 'about.html',           label: 'About',           match: ['/about.html'] },
  { href: 'plans.html',           label: 'Plans',           match: ['/plans.html', '/custom-plan.html'] },
  { href: 'ergos.html',           label: 'Ergos',           match: ['/ergos.html'] },
  { href: 'pace-calculator.html', label: 'Pace Calculator', match: ['/pace-calculator.html'] },
  { href: 'blog.html',            label: 'Blog',            match: ['/blog.html'] },
  { href: 'contact.html',         label: 'Contact',         match: ['/contact.html'] },
];

function currentPath() {
  let p = window.location.pathname;
  if (p === '' || p.endsWith('/')) p = p + 'index.html';
  return p;
}

function renderHeader() {
  const here = currentPath();
  const links = NAV_LINKS.map(l => {
    const active = l.match.some(m => here.endsWith(m) || (m === '/' && here.endsWith('/index.html')));
    return `<a href="${l.href}"${active ? ' class="active"' : ''}>${l.label}</a>`;
  }).join('');

  return `
    <header class="site-header">
      <div class="container site-header-inner">
        <a href="index.html" class="brand" aria-label="All Paddling home">
          ${BRAND_MARK_SVG}
          <span class="brand-text">
            <span class="top">All Paddling</span>
            <span class="sub">Paddle Specific Training</span>
          </span>
        </a>
        <nav class="top-nav" id="top-nav" aria-label="Primary">
          ${links}
          <a href="login.html" class="btn-login">Member Login</a>
        </nav>
        <button class="menu-toggle" aria-label="Open menu" id="menu-toggle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>
    </header>`;
}

function renderFooter() {
  return `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-col">
            <a href="index.html" class="brand" aria-label="All Paddling">
              ${BRAND_MARK_SVG}
              <span class="brand-text">
                <span class="top">All Paddling</span>
                <span class="sub">Paddle Specific Training</span>
              </span>
            </a>
            <p>Progressive monthly plans and bespoke season builds for paddlers who want to go faster — for longer.</p>
          </div>
          <div class="footer-col">
            <h4>Explore</h4>
            <ul>
              <li><a href="about.html">About Mick</a></li>
              <li><a href="plans.html">Training Plans</a></li>
              <li><a href="ergos.html">Ergos</a></li>
              <li><a href="pace-calculator.html">Pace Calculator</a></li>
              <li><a href="blog.html">Blog</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Contact</h4>
            <ul>
              <li><a href="mailto:mick@allpaddling.online">mick@allpaddling.online</a></li>
              <li><a href="contact.html">Contact form</a></li>
              <li><a href="login.html">Member sign-in</a></li>
            </ul>
          </div>
          <div class="footer-col footer-subscribe">
            <h4>Get training tips</h4>
            <p style="color:#94a3b8;font-size:0.88rem;">Occasional updates on pacing, programming and race prep. No spam.</p>
            <form id="newsletter-signup-form" novalidate>
              <input type="text"  id="newsletter-signup-firstname" placeholder="First name" autocomplete="given-name" />
              <input type="text"  id="newsletter-signup-lastname"  placeholder="Last name (optional)" autocomplete="family-name" />
              <input type="email" id="newsletter-signup-email"     placeholder="your@email.com" autocomplete="email" required />
              <!-- Honeypot: hidden from humans, bots fill it. Server returns 200 silently if filled. -->
              <input type="text" id="newsletter-signup-hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;" />
              <button type="submit" id="newsletter-signup-submit">Subscribe</button>
              <p id="newsletter-signup-msg" role="status" style="display:none;font-size:0.85rem;margin-top:0.6rem;line-height:1.4;"></p>
            </form>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} All Paddling. All rights reserved.</span>
          <span class="footer-legal">
            <span>ABN 52 173 453 156</span>
            <a href="/privacy.html">Privacy Policy</a>
            <a href="/terms.html">Terms &amp; Conditions</a>
          </span>
        </div>
      </div>
    </footer>`;
}

function mountSiteChrome() {
  const header = document.getElementById('site-header');
  const footer = document.getElementById('site-footer');
  if (header) header.innerHTML = renderHeader();
  if (footer) footer.innerHTML = renderFooter();

  const toggle = document.getElementById('menu-toggle');
  const nav = document.getElementById('top-nav');
  if (toggle && nav) {
    toggle.addEventListener('click', () => nav.classList.toggle('open'));
  }

  wireNewsletterSignup();
}

function wireNewsletterSignup () {
  const form    = document.getElementById('newsletter-signup-form');
  const input   = document.getElementById('newsletter-signup-email');
  const fname   = document.getElementById('newsletter-signup-firstname');
  const lname   = document.getElementById('newsletter-signup-lastname');
  const hp      = document.getElementById('newsletter-signup-hp');
  const submit  = document.getElementById('newsletter-signup-submit');
  const msg     = document.getElementById('newsletter-signup-msg');
  if (!form || !input || !submit || !msg) return;

  function showMsg (text, ok) {
    msg.textContent = text;
    msg.style.display = '';
    msg.style.color = ok ? '#86efac' : '#fca5a5';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.style.display = 'none';

    const email = (input.value || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showMsg('Please enter a valid email address.', false);
      input.focus();
      return;
    }

    const originalLabel = submit.textContent;
    submit.disabled = true;
    submit.textContent = 'Subscribing…';

    try {
      const res = await fetch(NEWSLETTER_SIGNUP_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          // Edge Function requires apikey + bearer even on --no-verify-jwt
          // routes — these route the request to the project, not auth.
          'apikey':        SITE_SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email,
          first_name: (fname && fname.value || '').trim() || null,
          last_name:  (lname && lname.value || '').trim() || null,
          source:     'public_footer',
          _hp:        (hp && hp.value) || '',
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const err = (data && data.error) || `HTTP ${res.status}`;
        showMsg('Sorry — ' + err + '. Try again, or email mick@allpaddling.online.', false);
        submit.disabled = false;
        submit.textContent = originalLabel;
        return;
      }

      // Success: replace the form contents with a thanks message so
      // the user gets clear confirmation and can't double-submit.
      form.innerHTML = '<p style="color:#86efac;font-size:0.9rem;line-height:1.5;margin:0;">Thanks — you\'re on the list. Look out for the next update.</p>';
    } catch (err) {
      console.error('newsletter-signup fetch failed:', err);
      showMsg('Network error. Try again, or email mick@allpaddling.online.', false);
      submit.disabled = false;
      submit.textContent = originalLabel;
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountSiteChrome);
} else {
  mountSiteChrome();
}
