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
    coach: {
      sleep: 'M57 34 Q60 35 63 34',
      idle: 'M56 33 Q60 36 64 33',
      working: 'M56 34 L64 34',
      alert: 'M57 32 Q60 38 63 32 Q60 30 57 32',
      happy: 'M55 32 Q60 39 65 32',
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
    <g class="fx fx-working fx-dots"><circle cx="96" cy="22" r="3"/><circle cx="104" cy="22" r="3"/><circle cx="112" cy="22" r="3"/></g>`;

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

  // Arm pivots at the shoulder; the forearm (with the dumbbell) pivots at the elbow.
  const muscleArm = (side, x) => {
    const m = side === 'left' ? 1 : -1; // mirror the bicep peak toward the outside
    return `
  <g class="arm arm-${side} coach-arm">
    <ellipse cx="${x}" cy="66" rx="9" ry="13" class="skin"/>
    <path d="M${x - 5 * m} 64 Q${x} 59 ${x + 5 * m} 64" class="muscle-line"/>
    <g class="forearm">
      <path d="M${x - 7} 76 Q${x - 9} 88 ${x - 4} 96 H${x + 4} Q${x + 9} 88 ${x + 7} 76 Z" class="skin"/>
      <rect x="${x - 11}" y="95" width="22" height="4" rx="2" class="bar"/>
      <rect x="${x - 15}" y="90" width="6" height="14" rx="2" class="plate"/>
      <rect x="${x + 9}" y="90" width="6" height="14" rx="2" class="plate"/>
    </g>
  </g>`;
  };

  // Hand-drawn double-biceps flex (left arm; the right is its mirror image), shown when happy.
  const FLEX_ARM = `
    <path d="M37 49 Q25 37 13 49 Q10 56 14 62 L37 62 Z" class="skin"/>
    <path d="M31 47 Q25 41 18 48" class="muscle-line"/>
    <path d="M11 60 Q8 46 12 33 H22 Q24 46 22 60 Z" class="skin"/>
    <circle cx="17" cy="31" r="6" class="skin"/>
    <rect x="4" y="29" width="26" height="4" rx="2" class="bar"/>
    <rect x="1" y="24" width="6" height="14" rx="2" class="plate"/>
    <rect x="27" y="24" width="6" height="14" rx="2" class="plate"/>`;

  const COACH = `
<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
  <path d="M42 112 Q39 124 44 134 H56 Q60 124 58 112 Z" class="skin"/>
  <path d="M78 112 Q81 124 76 134 H64 Q60 124 62 112 Z" class="skin"/>
  <path d="M51 120 Q50 126 52 130 M69 120 Q70 126 68 130" class="muscle-line"/>
  <rect x="40" y="131" width="18" height="7" rx="3" class="shoe"/>
  <rect x="62" y="131" width="18" height="7" rx="3" class="shoe"/>
  <path d="M43 94 H77 L81 116 H63 L60 106 L57 116 H39 Z" class="shorts"/>
  ${muscleArm('left', 26)}
  ${muscleArm('right', 94)}
  <g class="pose-flex">${FLEX_ARM}<g transform="translate(120 0) scale(-1 1)">${FLEX_ARM}</g></g>
  <path d="M52 36 H68 L88 50 H32 Z" class="skin"/>
  <path d="M32 50 Q60 44 88 50 L82 70 Q77 84 76 96 H44 Q43 84 38 70 Z" class="tank"/>
  <path d="M44 52 Q52 70 60 66 Q68 70 76 52" class="skin"/>
  <path d="M47 60 Q53 66 60 63 Q67 66 73 60" class="muscle-line"/>
  <g class="abs"><rect x="53.5" y="74" width="6" height="5" rx="2"/><rect x="60.5" y="74" width="6" height="5" rx="2"/><rect x="53.5" y="81" width="6" height="5" rx="2"/><rect x="60.5" y="81" width="6" height="5" rx="2"/><rect x="53.5" y="88" width="6" height="5" rx="2"/><rect x="60.5" y="88" width="6" height="5" rx="2"/></g>
  <circle cx="34" cy="55" r="10" class="skin"/>
  <circle cx="86" cy="55" r="10" class="skin"/>
  <rect x="54" y="32" width="12" height="8" class="skin"/>
  <circle cx="60" cy="25" r="13" class="skin"/>
  <path d="M47 23 Q48 9 60 10 Q72 9 73 23 Q60 16 47 23 Z" class="hair"/>
  <rect x="47" y="18" width="26" height="4" rx="2" class="headband"/>
  <g class="eyes"><ellipse class="eye coach-eye" cx="55" cy="27" rx="1.9" ry="2.3"/><ellipse class="eye coach-eye" cx="65" cy="27" rx="1.9" ry="2.3"/></g>
  <circle cx="51" cy="32" r="2.5" class="cheek"/><circle cx="69" cy="32" r="2.5" class="cheek"/>
  <path id="mouth" class="mouth" d=""/>
  <g class="fx fx-working sweat"><path d="M76 14 q3 5 0 7 q-3 -2 0 -7z"/><path d="M43 18 q3 5 0 7 q-3 -2 0 -7z"/></g>
  ${FX}
</svg>`;

  const SVGS = { cat: CAT, coach: COACH, robot: ROBOT };

  const POKES = {
    coach: ['Drop and give me twenty!', 'No pain, no gain!', 'Hydrate, then check on your agents.', "I'll blow the whistle when an agent needs a spot."],
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
      buddy.innerHTML = SVGS[next.character] || CAT;
      buddy.dataset.character = next.character;
    }
    const mouth = buddy.querySelector('#mouth');
    const mouths = MOUTHS[next.character] || MOUTHS.cat;
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
    const lines = POKES[state.character] || POKES.cat;
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
