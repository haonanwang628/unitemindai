// Builds the page from content.json. All text lives there, in English and Chinese.
(async function () {
  // ---- load content (a comma left after the last item is ignored)
  const dropCommas = (s) => {
    let out = '', inText = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inText) { out += c; if (c === '\\') out += s[++i] || ''; else if (c === '"') inText = false; continue; }
      if (c === '"') { inText = true; out += c; continue; }
      if (c === ',' && /^\s*[\]}]/.test(s.slice(i + 1, i + 400))) continue;
      out += c;
    }
    return out;
  };
  const load = async (file) => JSON.parse(dropCommas(await (await fetch(file, { cache: 'no-cache' })).text()));
  let data, problem = '';
  try { data = await load('content.json'); }
  catch (e) {
    problem = 'content.json 格式有误，现在显示的是备用内容。多半是引号或逗号写错了。\n' + e.message;
    console.error(problem);
    data = await load('content.backup.json');
  }

  // ---- language
  const query = new URLSearchParams(location.search);
  const read = () => { try { return localStorage.getItem('lang'); } catch { return null; } };
  let lang = ['en', 'zh'].includes(query.get('lang')) ? query.get('lang') : read() === 'zh' ? 'zh' : 'en';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const raw = (v) => (v && typeof v === 'object' ? v[lang] || v.en || '' : v || '');
  const t = (v) => esc(raw(v));

  // ---- pieces
  const mark = '<svg class="mark" viewBox="4 4 25 24" aria-hidden="true"><path class="s0" d="M5 7h5l8 8"/><path class="s1" d="M5 13h7l4 3"/><path class="s2" d="M5 19h7l4-3"/><path class="s3" d="M5 25h5l8-8"/><path class="s4" d="M17 16h6"/><circle cx="25" cy="16" r="3"/></svg>';
  const langs = () => `<div class="langs" role="group" aria-label="Language / 语言"><button type="button" data-lang="en" lang="en" aria-pressed="${lang === 'en'}">EN</button><button type="button" data-lang="zh" lang="zh" aria-pressed="${lang === 'zh'}">中</button></div>`;
  const navLinks = () => data.nav.map((n) => `<a href="#${n.to}">${t(n.label)}</a>`).join('');

  const header = () => `<header class="top"><div class="wrap bar"><a class="brand" href="#top">${mark}<span>${t(data.brand.name)}</span></a><nav class="nav" aria-label="${lang === 'zh' ? '主导航' : 'Main'}">${navLinks()}</nav>${langs()}<a class="btn small" href="#contact">${t(data.hero.primary)}</a></div></header>`;
  const hero = () => `<section class="hero wrap" id="top"><h1>${t(data.hero.heading)}</h1><div class="lead"><p>${t(data.hero.text)}</p><div class="acts"><a class="btn" href="#contact">${t(data.hero.primary)}</a><button type="button" class="btn line" data-break>${t(data.hero.secondary)}</button></div></div></section><div class="wrap" id="console-slot"></div>`;

  // Drawing used by the three steps.
  const diagram = () => {
    const cars = [[70, 90], [60, 290], [430, 320]];
    const jobs = [[190, 60], [320, 110], [420, 60], [180, 200], [300, 260], [170, 340]];
    const fan = cars.map((c, k) => jobs.map((j) => `<line class="fan v${k}" x1="${c[0]}" y1="${c[1]}" x2="${j[0]}" y2="${j[1]}"/>`).join('')).join('');
    return `<svg viewBox="0 0 500 400" role="img" aria-label="${t(data.how.alt)}">
      <g class="d-roads"><path d="M70 90 190 60 320 110 420 60M60 290 180 200 300 260 430 320M190 60 180 200 170 340M320 110 300 260 170 340M420 60 430 320M70 90 60 290 170 340"/></g>
      <g class="d-fan">${fan}</g>
      <g class="d-plan">
        <path class="v0" d="M70 90 190 60 320 110 420 60"/>
        <path class="v1 first" d="M60 290 180 200 170 340"/>
        <path class="v2" d="M430 320 300 260"/>
      </g>
      <g class="d-new"><path class="v1" d="M60 290 180 200"/><path class="v2" d="M430 320 300 260 170 340"/></g>
      <g class="d-jobs">${jobs.map((j, i) => `<g class="j${i}" transform="translate(${j[0]} ${j[1]})"><rect class="ping" x="-9" y="-9" width="18" height="18" rx="4"/><rect x="-9" y="-9" width="18" height="18" rx="3"/></g>`).join('')}</g>
      <g class="d-cars">${cars.map((c, i) => `<g class="v${i}" transform="translate(${c[0]} ${c[1]})"><circle r="17"/><text y="6" text-anchor="middle">${'ABC'[i]}</text></g>`).join('')}</g>
      <g class="d-shut" transform="translate(175 270)"><line x1="4" y1="-52" x2="-4" y2="52"/><circle r="13"/><path d="M-5 -5 5 5M5 -5 -5 5"/></g>
      <g class="d-ok" transform="translate(186 362)"><rect width="306" height="34" rx="4"/><text x="14" y="22.5">${t(data.how.closed)}</text><text class="r" x="292" y="22.5" text-anchor="end">${t(data.how.approve)}</text></g>
    </svg>`;
  };
  const how = () => `<section class="how" id="how"><div class="wrap"><h2>${t(data.how.heading)}</h2><div class="steps"><div class="stage" data-step="0">${diagram()}</div><ol>${data.how.steps.map((s, i) => `<li data-i="${i}"><p class="name">${t(s.name)}</p><h3>${t(s.title)}</h3><p>${t(s.text)}</p></li>`).join('')}</ol></div></div></section>`;
  const fit = () => `<section class="fit" id="fit"><div class="wrap"><h2>${t(data.fit.heading)}</h2><ul class="lines">${data.fit.lines.map((l, i) => `<li class="v${i % 4}"><div class="say"><h3>${t(l.name)}</h3><p>${t(l.text)}</p></div><ol>${l.stops.map((s) => `<li><i></i><span>${t(s)}</span></li>`).join('')}</ol></li>`).join('')}</ul></div></section>`;
  const abilities = () => {
    const a = data.abilities;
    return `<section class="abilities" id="abilities"><div class="wrap"><h2>${t(a.heading)}</h2><div class="grid">
      <article class="rules"><div><h3>${t(a.rules.title)}</h3><p>${t(a.rules.text)}</p></div><figure><figcaption>${t(a.reasons.example)}</figcaption><blockquote>${t(a.rules.said)}</blockquote><dl>${a.rules.parts.map((p) => `<div><dt>${t(p.key)}</dt><dd>${t(p.value)}</dd></div>`).join('')}</dl></figure></article>
      <article class="reasons"><h3>${t(a.reasons.title)}</h3><p>${t(a.reasons.text)}</p><figure><figcaption>${t(a.reasons.example)}</figcaption><p class="move"><span>${t(a.reasons.move)}</span><b class="v0">A</b><svg viewBox="0 0 40 10" aria-hidden="true"><path d="M0 5h37M32 1l5 4-5 4"/></svg><b class="v2">C</b></p><ul>${a.reasons.facts.map((f) => `<li>${t(f)}</li>`).join('')}</ul></figure></article>
      ${a.more.map((m) => `<article class="plain"><h3>${t(m.title)}</h3><p>${t(m.text)}</p></article>`).join('')}
    </div></div></section>`;
  };
  const start = () => `<section class="start" id="start"><div class="wrap"><h2>${t(data.start.heading)}</h2><ol>${data.start.steps.map((s) => `<li><h3>${t(s.title)}</h3><p>${t(s.text)}</p></li>`).join('')}</ol></div></section>`;
  const link = (v, label) => (/^https?:\/\//.test(v || '') ? `<a href="${esc(v)}" target="_blank" rel="noopener">${label}</a>` : label);
  const cases = () => (data.cases.items.length ? `<section class="list" id="cases"><div class="wrap"><h2>${t(data.cases.heading)}</h2><ul>${data.cases.items.map((c) => `<li><h3>${link(c.link, t(c.title))}</h3><p>${t(c.text)}</p></li>`).join('')}</ul></div></section>` : '');
  const team = () => (data.team.items.length ? `<section class="list team" id="team"><div class="wrap"><h2>${t(data.team.heading)}</h2><ul>${data.team.items.map((p) => `<li>${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : ''}<h3>${link(p.link, t(p.name))}</h3><p>${t(p.role)}</p></li>`).join('')}</ul></div></section>` : '');
  const faq = () => `<section class="faq" id="faq"><div class="wrap"><h2>${t(data.faq.heading)}</h2><div>${data.faq.items.map((f) => `<details><summary>${t(f.q)}</summary><p>${t(f.a)}</p></details>`).join('')}</div></div></section>`;
  const contact = () => {
    const c = data.contact;
    const mail = c.email ? `<a class="btn big" href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : `<span class="missing">${t(c.emailMissing)}</span>`;
    return `<section class="contact" id="contact"><div class="wrap"><svg class="merge" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true"><path class="s0" d="M0 12H380L600 60"/><path class="s1" d="M0 44H440L600 60"/><path class="s2" d="M0 76H440L600 60"/><path class="s3" d="M0 108H380L600 60"/><path class="s4" d="M600 60H1200"/></svg><h2>${t(c.heading)}</h2><p>${t(c.text)}</p>${mail}</div></section>`;
  };
  const footer = () => `<footer><div class="wrap"><a class="brand" href="#top">${mark}<span>${t(data.brand.name)}</span></a><p>${t(data.footer.note)}</p><nav aria-label="${lang === 'zh' ? '页脚导航' : 'Footer'}">${navLinks()}</nav><p>© ${new Date().getFullYear()} ${t(data.brand.name)}</p></div></footer>`;

  // ---- render
  const app = document.getElementById('app');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const board = document.createElement('div');
  board.className = 'console';
  let demo = null, watcher = null;
  const demoText = () => Object.fromEntries(Object.entries(data.demo).map(([k, v]) => [k, raw(v)]));

  function watchSteps() {
    if (watcher) watcher.disconnect();
    const stage = document.querySelector('.stage');
    watcher = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      stage.dataset.step = e.target.dataset.i;
      document.querySelectorAll('.steps li').forEach((li) => li.classList.toggle('on', li === e.target));
    }), { rootMargin: '-45% 0px -45% 0px' });
    document.querySelectorAll('.steps li').forEach((li) => watcher.observe(li));
  }
  function render() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = raw(data.brand.title);
    document.querySelector('meta[name=description]').content = raw(data.brand.description);
    app.innerHTML = header() + '<main>' + hero() + how() + fit() + abilities() + start() + cases() + team() + faq() + contact() + '</main>' + footer();
    document.getElementById('console-slot').append(board);
    if (demo) demo.setText(demoText()); else demo = window.createDemo(board, { text: demoText(), reduced });
    watchSteps();
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-lang]');
    if (b && b.dataset.lang !== lang) {
      const y = scrollY;
      lang = b.dataset.lang;
      try { localStorage.setItem('lang', lang); } catch { /* private window */ }
      const u = new URL(location.href); u.searchParams.set('lang', lang); history.replaceState(null, '', u);
      render(); scrollTo({ top: y, behavior: 'instant' });
      document.querySelector(`.top [data-lang=${lang}]`).focus({ preventScroll: true });
    }
    if (ev.target.closest('[data-break]')) { board.scrollIntoView({ block: 'center', behavior: reduced ? 'instant' : 'smooth' }); demo.breakPlan(); }
  });
  render();
  if (location.hash.length > 1) { const n = document.getElementById(location.hash.slice(1)); if (n) n.scrollIntoView(); }

  // ---- ?check lists missing translations
  if (query.has('check')) {
    const gaps = [];
    (function walk(v, path) {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      else if (v && typeof v === 'object') {
        if ('en' in v || 'zh' in v) { if (!v.zh) gaps.push(path + ' 缺中文'); if (!v.en) gaps.push(path + ' 缺英文'); }
        else Object.entries(v).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k));
      }
    })(data, '');
    const pre = document.createElement('pre');
    pre.className = 'check';
    pre.textContent = problem || (gaps.length ? gaps.join('\n') : '✓ 中英文一一对应，没有缺少的内容。') + (data.contact.email ? '' : '\n• contact.email 还没有填写');
    document.body.prepend(pre);
  }
})();
