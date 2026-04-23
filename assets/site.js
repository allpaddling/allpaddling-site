/* ============================================================
   ALL PADDLING — shared nav / footer mount + mobile menu toggle
   Each page has <div id="site-header"></div> and
   <div id="site-footer"></div> placeholders. This script
   fills them in and wires up the mobile nav toggle.
   ============================================================ */

const BRAND_MARK_SVG = `
  <span class="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z" fill="currentColor" stroke="none"/>
      <polyline points="3,13 8,13 10,9 14,17 16,13 21,13" stroke="white" stroke-width="1.8" fill="none"/>
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
              <li><a href="tel:+61404556880">0404 556 880</a></li>
              <li><a href="mailto:dibetta1@gmail.com">dibetta1@gmail.com</a></li>
              <li><a href="contact.html">Contact form</a></li>
            </ul>
          </div>
          <div class="footer-col footer-subscribe">
            <h4>Get training tips</h4>
            <p style="color:#94a3b8;font-size:0.88rem;">Occasional updates on pacing, programming and race prep. No spam.</p>
            <form onsubmit="event.preventDefault(); alert('Newsletter signup coming soon.');">
              <input type="email" placeholder="your@email.com" required />
              <button type="submit">Subscribe</button>
            </form>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} All Paddling. All rights reserved.</span>
          <span>Designed for paddlers who care about speed over water.</span>
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
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountSiteChrome);
} else {
  mountSiteChrome();
}
