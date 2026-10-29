// @ts-check
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const bubble = $('bubble');
  const buddy = $('buddy');
  const list = $('sessions');
  const mute = $('mute');

  const MOUTHS = {
    robot: {
      sleep: 'M52 68 Q60 70 68 68',
      idle: 'M50 66 Q60 72 70 66',
      working: 'M52 68 L68 68',
      alert: 'M54 66 Q60 76 66 66 Q60 62 54 66',
      happy: 'M48 64 Q60 78 72 64',
    },
    cat: {
      sleep: 'M54 76 Q60 78 66 76',
      idle: 'M52 75 Q56 79 60 75 Q64 79 68 75',
      working: 'M54 77 L66 77',
      alert: 'M55 75 Q60 85 65 75 Q60 72 55 75',
      happy: 'M50 73 Q55 82 60 75 Q65 82 70 73',
    },
  };

  const FX = `
    <g class="fx fx-sleep"><text x="92" y="28">z</text><text x="100" y="18">z</text><text x="108" y="8">Z</text></g>
    <g class="fx fx-alert"><text x="98" y="30" class="bang">!</text></g>
    <g class="fx fx-happy"><text x="8" y="30" class="heart">♥</text><text x="100" y="24" class="heart h2">♥</text></g>
    <g class="fx fx-working"><circle cx="96" cy="22" r="3"/><circle cx="104" cy="22" r="3"/><circle cx="112" cy="22" r="3"/></g>`;

  const ROBOT = `
<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
  <line x1="60" y1="10" x2="60" y2="25" class="stroke"/>
  <circle cx="60" cy="9" r="5" class="antenna"/>
  <rect x="20" y="25" width="80" height="60" rx="16" class="shell"/>
  <rect x="30" y="35" width="60" height="40" rx="10" class="screen"/>
  <g class="eyes"><ellipse class="eye" cx="48" cy="52" rx="6" ry="7"/><ellipse class="eye" cx="72" cy="52" rx="6" ry="7"/></g>
  <circle cx="38" cy="64" r="4" class="cheek"/><circle cx="82" cy="64" r="4" class="cheek"/>
  <path id="mouth" class="mouth" d=""/>
  <rect x="12" y="90" width="12" height="30" rx="6" class="shell arm arm-left"/>
  <rect x="96" y="90" width="12" height="30" rx="6" class="shell arm arm-right"/>
  <rect x="30" y="88" width="60" height="40" rx="12" class="shell body"/>
  <circle cx="60" cy="106" r="7" class="chest"/>
  ${FX}
</svg>`;

  const CAT = `
<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
  <path class="tail fur-stroke" d="M90 120 Q115 110 108 85"/>
  <ellipse cx="60" cy="112" rx="32" ry="24" class="fur body"/>
  <ellipse cx="60" cy="118" rx="18" ry="14" class="belly"/>
  <path d="M30 48 L34 18 L52 36 Z" class="fur ear"/>
  <path d="M90 48 L86 18 L68 36 Z" class="fur ear"/>
  <path d="M35 42 L37 26 L47 36 Z" class="ear-inner"/>
  <path d="M85 42 L83 26 L73 36 Z" class="ear-inner"/>
  <circle cx="60" cy="62" r="32" class="fur head"/>
  <g class="eyes"><ellipse class="eye cat-eye" cx="48" cy="60" rx="5" ry="7"/><ellipse class="eye cat-eye" cx="72" cy="60" rx="5" ry="7"/></g>
  <circle cx="40" cy="72" r="4" class="cheek"/><circle cx="80" cy="72" r="4" class="cheek"/>
  <path d="M57 69 L63 69 L60 72 Z" class="nose"/>
  <path id="mouth" class="mouth" d=""/>
  <g class="whiskers"><line x1="22" y1="68" x2="40" y2="70"/><line x1="22" y1="76" x2="40" y2="74"/><line x1="98" y1="68" x2="80" y2="70"/><line x1="98" y1="76" x2="80" y2="74"/></g>
  <ellipse cx="86" cy="104" rx="8" ry="6" class="fur arm arm-right"/>
  ${FX}
</svg>`;

  const POKES = {
    robot: ['Beep boop!', 'Systems nominal. I am watching your agents.', 'Bzzt! That tickles.', 'I will shout when an agent needs you.'],
    cat: ['Meow!', 'Purrr… I am watching your agents.', 'Hey, no poking! …okay, one more.', 'I will meow when an agent needs you.'],
  };

  let state = { character: '', mood: '', line: '', focusCwd: undefined, sessions: [], muted: false };
  let typing = 0;
  let pokeTimer = 0;

  function setLine(text) {
    clearInterval(typing);
    bubble.textContent = '';
    let i = 0;
    typing = setInterval(() => {
      bubble.textContent = text.slice(0, ++i);
      if (i >= text.length) clearInterval(typing);
    }, 18);
  }

  function render(next) {
    if (next.character !== state.character) {
      buddy.innerHTML = next.character === 'cat' ? CAT : ROBOT;
      buddy.dataset.character = next.character;
    }
    const mouth = buddy.querySelector('#mouth');
    const mouths = MOUTHS[next.character] || MOUTHS.robot;
    if (mouth) mouth.setAttribute('d', mouths[next.mood] || mouths.idle);
    document.body.className = `mood-${next.mood}`;

    if (next.line !== state.line && !pokeTimer) setLine(next.line);
    bubble.classList.toggle('clickable', !!next.focusCwd);

    mute.textContent = next.muted ? '🔕 Muted — click to unmute' : '🔔 Alerts on — click to mute';

    list.innerHTML = '';
    if (next.sessions.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No active Claude Code or Codex sessions.';
      list.appendChild(li);
    }
    for (const s of next.sessions) {
      const li = document.createElement('li');
      li.className = `session state-${s.state}`;
      li.title = s.cwd || '';
      li.innerHTML = '<span class="dot"></span><span class="name"></span><span class="meta"></span>';
      li.querySelector('.name').textContent = `${s.agent} · ${s.folder}`;
      li.querySelector('.meta').textContent = `${s.stateLabel} · ${s.ago}`;
      if (s.cwd) li.addEventListener('click', () => vscode.postMessage({ type: 'open', cwd: s.cwd }));
      list.appendChild(li);
    }
    state = next;
  }

  bubble.addEventListener('click', () => {
    if (state.focusCwd) vscode.postMessage({ type: 'open', cwd: state.focusCwd });
  });

  buddy.addEventListener('click', () => {
    const lines = POKES[state.character] || POKES.robot;
    const extra = state.sessions.length ? [`I'm watching ${state.sessions.length} session${state.sessions.length > 1 ? 's' : ''} for you.`] : [];
    const pool = lines.concat(extra);
    setLine(pool[Math.floor(Math.random() * pool.length)]);
    vscode.postMessage({ type: 'poke' });
    buddy.classList.remove('poked');
    void buddy.offsetWidth; // restart the animation
    buddy.classList.add('poked');
    clearTimeout(pokeTimer);
    pokeTimer = setTimeout(() => {
      pokeTimer = 0;
      setLine(state.line);
    }, 3000);
  });

  mute.addEventListener('click', () => vscode.postMessage({ type: 'toggleMute' }));

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'status') render(e.data);
  });
  vscode.postMessage({ type: 'ready' });
})();
