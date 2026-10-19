(() => {
  'use strict';

  /* ------------------------------------------------------------------
   * Elements
   * ------------------------------------------------------------------ */
  const $ = (sel) => document.querySelector(sel);

  const stage = $('#stage');
  const avatarWrap = $('#avatarWrap');
  const avatar = $('#avatar');
  const face = $('#avatarFace');
  const splats = $('#splats');
  const floaters = $('#floaters');
  const dizzy = $('#dizzy');
  const toastEl = $('#toast');
  const fx = $('#fx');
  const fctx = fx.getContext('2d');

  const stressValue = $('#stressValue');
  const stressFill = $('#stressFill');
  const hitCount = $('#hitCount');
  const comboCount = $('#comboCount');

  const photoInput = $('#photoInput');
  const removeBtn = $('#removePhoto');
  const adjustEl = $('#adjust');
  const zoomEl = $('#zoom');
  const panXEl = $('#panX');
  const panYEl = $('#panY');

  /* ------------------------------------------------------------------
   * Config and state
   * ------------------------------------------------------------------ */
  const TOOLS = [
    { id: 'punch',   label: 'Punch',   emoji: '👊', power: 4,   windup: 100, words: ['POW!', 'BAM!', 'WHAM!', 'BIFF!'] },
    { id: 'slap',    label: 'Slap',    emoji: '🖐️', power: 3,   windup: 120, words: ['SMACK!', 'SLAP!', 'THWACK!'] },
    { id: 'kick',    label: 'Kick',    emoji: '🦵', power: 5,   windup: 125, words: ['KICK!', 'WHOMP!', 'BOOT!'] },
    { id: 'slipper', label: 'Slipper', emoji: '🩴', power: 3.2, windup: 100, words: ['SELIPAR!', 'THWAP!', 'FLAP!'] },
    { id: 'poke',    label: 'Poke',    emoji: '👆', power: 1.2, windup: 70,  words: ['boop', 'poke', 'tap'] },
    { id: 'squeeze', label: 'Squeeze', emoji: '🤏', power: 0,   hold: true,   words: ['squish', 'squeeeeze', 'mmph'] },
    { id: 'hammer',  label: 'Hammer',  emoji: '🔨', power: 6,   windup: 250, words: ['BONK!', 'THUD!', 'CRUNCH!'] },
    { id: 'jump',    label: 'Jump',    emoji: '🤸', power: 5.5, windup: 310, words: ['STOMP!', 'BOING!', 'SQUASH!'] },
    { id: 'tomato',  label: 'Tomato',  emoji: '🍅', power: 3,   windup: 235, words: ['SPLAT!', 'SPLOOSH!', 'SQUISH!'] },
    { id: 'pie',     label: 'Pie',     emoji: '🥧', power: 2.8, windup: 230, words: ['SPLORT!', 'PIE!', 'SPLAT!'] },
    { id: 'durian',  label: 'Durian',  icon: 'durian', power: 4.5, windup: 300, words: ['STINKY!', 'SPIKY!', 'OUCH!'] },
    { id: 'yell',    label: 'Yell',    emoji: '📣', power: 2.5, windup: 120, words: ['AAAARGH!', 'HEY!!', 'GRRR!'] },
  ];

  // Keys 1-9, 0, - and = pick the tools in order.
  const KEYS = '1234567890-=';

  // There is no durian emoji, so it is drawn as an SVG.
  function durianInner() {
    const cx = 32, cy = 33, rx = 21, ry = 24;
    const f = (n) => n.toFixed(1);
    const spike = (bx, by, ang, len, w) => {
      const nx = Math.cos(ang), ny = Math.sin(ang);
      const tx = bx + nx * len, ty = by + ny * len;
      const px = -ny * w, py = nx * w;
      return `<polygon points="${f(bx + px)},${f(by + py)} ${f(tx)},${f(ty)} ${f(bx - px)},${f(by - py)}" fill="#5f8a2e" stroke="#3f5e1c" stroke-width="1" stroke-linejoin="round"/>`;
    };
    let out = `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#c9d85c" stroke="#8fa33a" stroke-width="1.5"/>`;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      out += spike(cx + Math.cos(a) * rx * 0.96, cy + Math.sin(a) * ry * 0.96, a, 6.5, 3.4);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      out += spike(cx + Math.cos(a) * rx * 0.6, cy + Math.sin(a) * ry * 0.6, a, 6, 3);
    }
    out += spike(32, 34, -Math.PI / 2, 6, 3) + spike(25, 40, -Math.PI / 2.4, 5.5, 2.8) + spike(39, 40, -Math.PI / 1.7, 5.5, 2.8);
    out += '<path d="M30 10 Q30 2 34 2 L34 10Z" fill="#6b4a2b"/>';
    return out;
  }
  const DURIAN_INNER = durianInner();

  function iconHtml(tool, px) {
    if (tool.icon === 'durian') {
      return `<svg viewBox="0 0 64 64" width="${px}" height="${px}" aria-hidden="true">${DURIAN_INNER}</svg>`;
    }
    return tool.emoji;
  }

  /* ------------------------------------------------------------------
   * Characters (drawn as SVG, no emoji)
   * ------------------------------------------------------------------ */
  function eyeIdle(d, x, y, side) {
    const ink = d.ink;
    switch (d.eyes) {
      case 'googly':
        return `<circle cx="${x}" cy="${y}" r="14" fill="#fff" stroke="${ink}" stroke-width="3"/>` +
          `<circle cx="${x + 2}" cy="${y + 2}" r="6.5" fill="${ink}"/>` +
          `<circle cx="${x + 4}" cy="${y - 0.5}" r="2" fill="#fff"/>`;
      case 'led':
        return `<rect x="${x - 13}" y="${y - 10}" width="26" height="20" rx="6" fill="${ink}"/>` +
          `<rect x="${x - 8}" y="${y - 6}" width="8" height="4" rx="2" fill="#fff" opacity=".7"/>`;
      case 'alien':
        return `<ellipse cx="${x}" cy="${y}" rx="15" ry="22" transform="rotate(${side * 22} ${x} ${y})" fill="#150b2b"/>` +
          `<circle cx="${x - side * 3}" cy="${y - 9}" r="3.5" fill="#fff" opacity=".85"/>`;
      default:
        return `<ellipse cx="${x}" cy="${y}" rx="9" ry="12" fill="${ink}"/>` +
          `<circle cx="${x + 3}" cy="${y - 5}" r="3.5" fill="#fff"/>`;
    }
  }

  // One set of expressions shared by every character, positioned by each character's own numbers.
  function moodGroups(d) {
    const { spread, ey, my, ink } = d;
    const lx = 100 - spread;
    const rx = 100 + spread;
    const ln = (dd, stroke = ink) => `<path class="ink" style="stroke:${stroke}" d="${dd}"/>`;
    const brows = (a, b) => (d.brows === false ? '' : ln(a) + ln(b));
    const tongue = (dd) => (d.tongue === false ? '' : dd);

    const idleBrows = d.curvedBrows
      ? ln(`M${lx - 18} ${ey - 24} Q${lx} ${ey - 34} ${lx + 18} ${ey - 24}`) +
        ln(`M${rx - 18} ${ey - 24} Q${rx} ${ey - 34} ${rx + 18} ${ey - 24}`)
      : '';
    const idleMouth = d.idleMouth || ln(`M72 ${my - 6} Q100 ${my + 16} 128 ${my - 6}`);

    const idle = eyeIdle(d, lx, ey, 1) + eyeIdle(d, rx, ey, -1) + idleBrows + idleMouth;

    const hurt =
      ln(`M${lx - 14} ${ey - 12} L${lx + 14} ${ey} L${lx - 14} ${ey + 12}`) +
      ln(`M${rx + 14} ${ey - 12} L${rx - 14} ${ey} L${rx + 14} ${ey + 12}`) +
      brows(`M${lx - 22} ${ey - 28} L${lx + 18} ${ey - 18}`, `M${rx + 22} ${ey - 28} L${rx - 18} ${ey - 18}`) +
      `<ellipse cx="100" cy="${my + 4}" rx="17" ry="13" fill="${ink}"/>` +
      tongue(`<ellipse cx="100" cy="${my + 10}" rx="9" ry="5" fill="#ff7a8a"/>`);

    const squeeze =
      ln(`M${lx - 14} ${ey} Q${lx} ${ey + 12} ${lx + 14} ${ey}`) +
      ln(`M${rx - 14} ${ey} Q${rx} ${ey + 12} ${rx + 14} ${ey}`) +
      ln(`M${100 - 38} ${my} q9 -12 19 0 t19 0 t19 0 t19 0`) +
      '<path d="M160 52 q9 13 0 20 q-9 -7 0 -20z" fill="#8fd3ff"/>';

    const happy =
      ln(`M${lx - 14} ${ey + 6} Q${lx} ${ey - 14} ${lx + 14} ${ey + 6}`) +
      ln(`M${rx - 14} ${ey + 6} Q${rx} ${ey - 14} ${rx + 14} ${ey + 6}`) +
      `<path d="M${100 - 34} ${my - 14} Q100 ${my + 36} ${100 + 34} ${my - 14} Z" fill="${ink}"/>` +
      tongue(`<path d="M84 ${my + 10} Q100 ${my} 116 ${my + 10} Q100 ${my + 22} 84 ${my + 10}Z" fill="#ff7a8a"/>`);

    const dizzyMood =
      ln(`M${lx - 12} ${ey - 12} L${lx + 12} ${ey + 12} M${lx + 12} ${ey - 12} L${lx - 12} ${ey + 12}`) +
      ln(`M${rx - 12} ${ey - 12} L${rx + 12} ${ey + 12} M${rx + 12} ${ey - 12} L${rx - 12} ${ey + 12}`) +
      ln(`M${100 - 30} ${my} q8 -9 15 0 t15 0 t15 0 t15 0`);

    const stink =
      (d.cheeks === false
        ? ''
        : `<circle cx="${lx - 28}" cy="${ey + 32}" r="15" fill="#9ccf4a" opacity=".7"/>` +
          `<circle cx="${rx + 28}" cy="${ey + 32}" r="15" fill="#9ccf4a" opacity=".7"/>`) +
      ln(`M${lx - 16} ${ey} L${lx + 16} ${ey}`) +
      ln(`M${rx - 16} ${ey} L${rx + 16} ${ey}`) +
      brows(`M${lx - 22} ${ey - 26} L${lx + 18} ${ey - 16}`, `M${rx + 22} ${ey - 26} L${rx - 18} ${ey - 16}`) +
      ln(`M${100 - 32} ${my + 14} Q100 ${my - 12} ${100 + 32} ${my + 14}`) +
      ln('M26 70 q-8 -10 0 -20 t0 -20', '#7fae2c') +
      ln('M174 70 q8 -10 0 -20 t0 -20', '#7fae2c');

    const g = (name, body) => `<g class="mood m-${name}">${body}</g>`;
    return g('idle', idle) + g('hurt', hurt) + g('squeeze', squeeze) + g('happy', happy) + g('dizzy', dizzyMood) + g('stink', stink);
  }

  const CHARACTERS = [
    {
      id: 'putty', name: 'Putty',
      art: '<rect width="200" height="200" fill="#ffd35a"/>' +
        '<circle cx="42" cy="122" r="16" fill="#ff8a7a" opacity=".55"/>' +
        '<circle cx="158" cy="122" r="16" fill="#ff8a7a" opacity=".55"/>',
      face: { spread: 30, ey: 88, my: 140, ink: '#2a1f3d', eyes: 'dot', curvedBrows: true },
    },
    {
      id: 'whiskers', name: 'Whiskers',
      art: '<rect width="200" height="200" fill="#7fd6d0"/>' +
        '<polygon points="38,92 44,22 96,58" fill="#f59a3d"/><polygon points="50,80 52,40 82,60" fill="#ffb5b0"/>' +
        '<polygon points="162,92 156,22 104,58" fill="#f59a3d"/><polygon points="150,80 148,40 118,60" fill="#ffb5b0"/>' +
        '<ellipse cx="100" cy="114" rx="74" ry="66" fill="#f59a3d"/>' +
        '<path d="M100 50 L100 70 M84 54 L87 70 M116 54 L113 70" stroke="#d97a1f" stroke-width="5" stroke-linecap="round" fill="none"/>' +
        '<ellipse cx="100" cy="140" rx="28" ry="19" fill="#fff2dc"/>' +
        '<polygon points="91,124 109,124 100,134" fill="#ff7a8a"/>' +
        '<path d="M66 136 L28 128 M66 144 L28 148 M134 136 L172 128 M134 144 L172 148" stroke="#8a4a14" stroke-width="2.5" stroke-linecap="round" fill="none"/>',
      face: {
        spread: 32, ey: 100, my: 150, ink: '#2a1f3d', eyes: 'dot', brows: false,
        idleMouth: '<path class="ink" style="stroke:#2a1f3d" d="M100 134 L100 146 M86 148 Q93 158 100 148 Q107 158 114 148"/>',
      },
    },
    {
      id: 'teddy', name: 'Teddy',
      art: '<rect width="200" height="200" fill="#ffb7c5"/>' +
        '<circle cx="48" cy="60" r="25" fill="#a8693a"/><circle cx="48" cy="60" r="12" fill="#e0a67a"/>' +
        '<circle cx="152" cy="60" r="25" fill="#a8693a"/><circle cx="152" cy="60" r="12" fill="#e0a67a"/>' +
        '<circle cx="100" cy="114" r="70" fill="#a8693a"/>' +
        '<ellipse cx="100" cy="138" rx="31" ry="25" fill="#ecc79a"/>' +
        '<ellipse cx="100" cy="126" rx="11" ry="8" fill="#3b2416"/>',
      face: {
        spread: 30, ey: 100, my: 150, ink: '#24160d', eyes: 'dot', brows: false,
        idleMouth: '<path class="ink" style="stroke:#24160d" d="M100 134 L100 144 M87 146 Q94 156 100 146 Q106 156 113 146"/>',
      },
    },
    {
      id: 'bolt', name: 'Bolt',
      art: '<rect width="200" height="200" fill="#b9a8ff"/>' +
        '<rect x="95" y="30" width="10" height="30" fill="#8795ad"/><circle cx="100" cy="28" r="10" fill="#ff6b5e"/>' +
        '<rect x="20" y="96" width="16" height="44" rx="6" fill="#8795ad"/><rect x="164" y="96" width="16" height="44" rx="6" fill="#8795ad"/>' +
        '<rect x="32" y="56" width="136" height="120" rx="28" fill="#cfd8e6" stroke="#8795ad" stroke-width="4"/>' +
        '<circle cx="46" cy="68" r="4" fill="#8795ad"/><circle cx="154" cy="68" r="4" fill="#8795ad"/>' +
        '<circle cx="46" cy="164" r="4" fill="#8795ad"/><circle cx="154" cy="164" r="4" fill="#8795ad"/>' +
        '<rect x="46" y="76" width="108" height="84" rx="18" fill="#0f1a2e"/>',
      face: {
        spread: 28, ey: 104, my: 140, ink: '#7dffd0', eyes: 'led', brows: false, tongue: false, cheeks: false,
        idleMouth: '<path class="ink" style="stroke:#7dffd0" d="M74 140 L126 140 M86 132 L86 148 M100 132 L100 148 M114 132 L114 148"/>',
      },
    },
    {
      id: 'zorp', name: 'Zorp',
      art: '<rect width="200" height="200" fill="#26256b"/>' +
        '<circle cx="30" cy="40" r="2.5" fill="#fff"/><circle cx="170" cy="62" r="2" fill="#fff"/><circle cx="24" cy="130" r="2" fill="#fff"/>' +
        '<circle cx="176" cy="150" r="2.5" fill="#fff"/><circle cx="150" cy="26" r="2" fill="#fff"/>' +
        '<path d="M80 54 L64 26 M120 54 L136 26" stroke="#5fbf63" stroke-width="5" stroke-linecap="round" fill="none"/>' +
        '<circle cx="64" cy="24" r="7" fill="#ffd35a"/><circle cx="136" cy="24" r="7" fill="#ffd35a"/>' +
        '<ellipse cx="100" cy="114" rx="68" ry="74" fill="#7ee081"/>' +
        '<circle cx="70" cy="68" r="4" fill="#5fbf63"/><circle cx="132" cy="70" r="5" fill="#5fbf63"/><circle cx="104" cy="58" r="3.5" fill="#5fbf63"/>',
      face: {
        spread: 30, ey: 102, my: 150, ink: '#17321f', eyes: 'alien', brows: false,
        idleMouth: '<path class="ink" style="stroke:#17321f" d="M88 150 Q100 158 112 150"/>',
      },
    },
    {
      id: 'boo', name: 'Boo',
      art: '<rect width="200" height="200" fill="#8f87e8"/>' +
        '<path d="M36 172 L36 108 C36 62 66 36 100 36 C134 36 164 62 164 108 L164 172 Q150 190 136 172 Q122 154 108 172 Q94 190 80 172 Q66 154 52 172 Q44 182 36 172 Z" fill="#f4f1ff" stroke="#cfc8ff" stroke-width="4"/>' +
        '<circle cx="60" cy="128" r="11" fill="#ff9fb8" opacity=".55"/><circle cx="140" cy="128" r="11" fill="#ff9fb8" opacity=".55"/>',
      face: {
        spread: 26, ey: 98, my: 136, ink: '#2a2a4a', eyes: 'dot', brows: false,
        idleMouth: '<ellipse cx="100" cy="138" rx="8" ry="11" fill="#2a2a4a"/>',
      },
    },
    {
      id: 'spud', name: 'Spud',
      art: '<rect width="200" height="200" fill="#9ad1ff"/>' +
        '<path d="M100 36 C140 34 170 62 168 108 C166 150 140 176 100 176 C58 176 32 150 34 108 C36 62 60 38 100 36 Z" fill="#c8975a" stroke="#a8763c" stroke-width="4"/>' +
        '<ellipse cx="64" cy="68" rx="6" ry="4" fill="#a8763c"/><ellipse cx="138" cy="64" rx="5" ry="3.5" fill="#a8763c"/>' +
        '<ellipse cx="152" cy="134" rx="6" ry="4" fill="#a8763c"/><ellipse cx="50" cy="142" rx="5" ry="3.5" fill="#a8763c"/>' +
        '<ellipse cx="112" cy="162" rx="6" ry="4" fill="#a8763c"/>' +
        '<path d="M100 38 Q92 20 78 22 Q82 36 100 38Z" fill="#7fc96a"/><path d="M100 38 Q108 18 124 20 Q118 36 100 38Z" fill="#7fc96a"/>' +
        '<circle cx="58" cy="126" r="11" fill="#e58f7a" opacity=".5"/><circle cx="142" cy="126" r="11" fill="#e58f7a" opacity=".5"/>',
      face: { spread: 28, ey: 98, my: 142, ink: '#3b2a18', eyes: 'googly', curvedBrows: true },
    },
    {
      id: 'grumble', name: 'Grumble',
      art: '<rect width="200" height="200" fill="#ffc98a"/>' +
        '<polygon points="56,78 46,28 88,54" fill="#fff2c9"/><polygon points="144,78 154,28 112,54" fill="#fff2c9"/>' +
        '<circle cx="100" cy="114" r="72" fill="#8a5cf6"/>' +
        '<path d="M52 72 L90 86 M148 72 L110 86" stroke="#2a0f4a" stroke-width="7" stroke-linecap="round" fill="none"/>',
      face: {
        spread: 30, ey: 100, my: 142, ink: '#2a0f4a', eyes: 'googly', brows: false,
        idleMouth: '<path d="M62 134 Q100 178 138 134 Z" fill="#2a0f4a"/>' +
          '<polygon points="70,134 78,146 86,134" fill="#fff"/><polygon points="90,134 98,148 106,134" fill="#fff"/><polygon points="110,134 118,146 126,134" fill="#fff"/>',
      },
    },
  ];

  const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

  function characterSvg(def, mood = 'idle', decorative = false) {
    const a11y = decorative ? 'aria-hidden="true"' : `role="img" aria-label="${def.name}, a cartoon character"`;
    return `<svg class="face-svg" data-mood="${mood}" viewBox="0 0 200 200" ${a11y} preserveAspectRatio="xMidYMid slice">${def.art}${moodGroups(def.face)}</svg>`;
  }

  function starPoints(cx, cy, R, r) {
    let pts = '';
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r : R;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      pts += `${(cx + Math.cos(a) * rad).toFixed(1)},${(cy + Math.sin(a) * rad).toFixed(1)} `;
    }
    return pts.trim();
  }

  // Orbiting stars for the dizzy state (drawn, not an emoji).
  function dizzySvg() {
    let out = '';
    [-90, 30, 150].forEach((deg) => {
      const a = (deg * Math.PI) / 180;
      out += `<polygon points="${starPoints(32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22, 8, 3.6)}" fill="#ffd35a" stroke="#c99a12" stroke-width="1.5" stroke-linejoin="round"/>`;
    });
    return `<svg viewBox="0 0 64 64" aria-hidden="true">${out}</svg>`;
  }

  const COMBO_WINDOW = 1100;
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionScale = calm ? 0.4 : 1;

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('stressbuster.' + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (_) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('stressbuster.' + key, JSON.stringify(value)); return true; }
      catch (_) { return false; }
    },
    del(key) {
      try { localStorage.removeItem('stressbuster.' + key); } catch (_) { /* ignore */ }
    },
  };

  const state = {
    tool: store.get('tool', 'punch'),
    stress: 100,
    hits: 0,
    combo: 0,
    lastHit: 0,
    sound: store.get('sound', true),
    haptics: store.get('haptics', true),
    hold: null,
    mood: 'idle',
    moodTimer: 0,
  };

  const adjust = Object.assign({ z: 1, x: 0, y: 0 }, store.get('adjust', {}));

  const toolById = (id) => TOOLS.find((t) => t.id === id) || TOOLS[0];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  /* ------------------------------------------------------------------
   * Sound (synthesised with Web Audio, no files needed)
   * ------------------------------------------------------------------ */
  const Sound = (() => {
    let ctx = null;
    let master = null;
    let noiseBuf = null;

    function ensure() {
      if (!state.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.7;
        master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    function tone(type, f0, f1, dur, gain, at = 0) {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime + at;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.03);
    }

    function noise(dur, opts = {}, at = 0) {
      const c = ensure();
      if (!c) return;
      const { type = 'lowpass', freq = 1000, q = 1, gain = 0.5 } = opts;
      const t = c.currentTime + at;
      const s = c.createBufferSource();
      s.buffer = noiseBuf;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f).connect(g).connect(master);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.03);
    }

    function play(id, k = 1) {
      const j = 0.92 + Math.random() * 0.16;
      switch (id) {
        case 'punch':
          tone('sine', 170 * j, 40, 0.2, 0.9 * k);
          noise(0.09, { freq: 900, gain: 0.5 * k });
          break;
        case 'slap':
          noise(0.1, { type: 'bandpass', freq: 2600 * j, q: 0.9, gain: 0.9 });
          tone('triangle', 520 * j, 180, 0.07, 0.25);
          break;
        case 'poke':
          tone('sine', 720 * j, 340, 0.09, 0.55);
          break;
        case 'hammer':
          tone('square', 130 * j, 45, 0.24, 0.3 * k);
          noise(0.14, { freq: 1300, gain: 0.8 });
          tone('sine', 1500 * j, 1380, 0.4, 0.1, 0.02);
          break;
        case 'tomato':
          noise(0.3, { freq: 700, q: 4, gain: 1 });
          tone('sine', 230 * j, 70, 0.22, 0.45);
          break;
        case 'kick':
          tone('sine', 130 * j, 35, 0.25, 1 * k);
          noise(0.1, { freq: 600, gain: 0.9 });
          break;
        case 'jump':
          tone('sine', 95 * j, 30, 0.3, 1 * k);
          noise(0.12, { freq: 500, gain: 0.6 });
          tone('sine', 180, 420, 0.15, 0.25, 0.14);
          break;
        case 'slipper':
          noise(0.06, { type: 'bandpass', freq: 2000 * j, q: 1.2, gain: 0.9 });
          noise(0.06, { type: 'bandpass', freq: 2300 * j, q: 1.2, gain: 0.8 }, 0.09);
          tone('triangle', 400 * j, 150, 0.08, 0.25);
          break;
        case 'pie':
          noise(0.25, { freq: 1200, q: 2, gain: 0.8 });
          tone('sine', 300 * j, 100, 0.18, 0.35);
          break;
        case 'durian':
          noise(0.35, { freq: 500, q: 6, gain: 1 });
          tone('sine', 120 * j, 45, 0.3, 0.5);
          tone('sine', 90, 60, 0.4, 0.25, 0.08);
          break;
        case 'yell':
          tone('sawtooth', 240 * j, 180, 0.55, 0.3);
          tone('sawtooth', 243 * j, 176, 0.55, 0.25);
          noise(0.5, { type: 'bandpass', freq: 1500, q: 0.8, gain: 0.35 });
          break;
        case 'boing':
          tone('sine', 200, 560, 0.15, 0.4);
          break;
        case 'miss':
          noise(0.08, { type: 'highpass', freq: 3500, gain: 0.15 });
          break;
        case 'chime':
          [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone('sine', f, f, 0.5, 0.25, i * 0.12));
          break;
        default:
          break;
      }
    }

    function squeezeStart() {
      const c = ensure();
      if (!c) return null;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = 260;
      g.gain.value = 0.0001;
      o.connect(g).connect(master);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.12, c.currentTime + 0.05);
      return {
        update(t) { o.frequency.setTargetAtTime(260 + t * 520, c.currentTime, 0.03); },
        stop() {
          const n = c.currentTime;
          g.gain.cancelScheduledValues(n);
          g.gain.setTargetAtTime(0.0001, n, 0.03);
          o.stop(n + 0.2);
        },
      };
    }

    return { unlock: ensure, play, squeezeStart };
  })();

  function buzz(pattern) {
    if (state.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }

  /* ------------------------------------------------------------------
   * Particles (canvas)
   * ------------------------------------------------------------------ */
  let fxW = 0;
  let fxH = 0;
  let parts = [];
  let raf = 0;
  let lastT = 0;

  function resizeFx() {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    fxW = r.width;
    fxH = r.height;
    fx.width = Math.round(fxW * dpr);
    fx.height = Math.round(fxH * dpr);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const PALETTES = {
    spark: ['#ffd35a', '#ffffff', '#ff9b3d', '#b9a8ff'],
    hammer: ['#ffd35a', '#ff6b5e', '#ffffff', '#9aa0ff'],
    tomato: ['#e63b2e', '#ff7a63', '#b8231a', '#7ccf5b'],
    cream: ['#ffffff', '#fff3d6', '#f7e3b5', '#ffd9e2'],
    durian: ['#d9e36a', '#a8c23a', '#6f8f2a', '#f2d86b'],
  };

  function burst(x, y, kind, count) {
    const n = Math.max(2, Math.round(count * (calm ? 0.5 : 1)));
    const pal = PALETTES[kind] || PALETTES.spark;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 120 + Math.random() * 320;
      const isDrop = kind === 'tomato' || kind === 'cream' || kind === 'durian';
      const life = 0.5 + Math.random() * 0.4;
      parts.push({
        kind: isDrop ? 'drop' : kind === 'hammer' && i % 2 ? 'chunk' : 'star',
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 80,
        g: isDrop ? 900 : kind === 'hammer' ? 800 : 300,
        life, max: life,
        size: isDrop ? 5 + Math.random() * 8 : 4 + Math.random() * 7,
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 12,
        color: pick(pal),
      });
    }
    parts.push({
      kind: 'ring', x, y, r: 6,
      grow: kind === 'hammer' ? 520 : 300,
      life: 0.28, max: 0.28,
      color: kind === 'tomato' ? '#ff7a63' : kind === 'durian' ? '#d9e36a' : '#ffffff',
    });
    ensureLoop();
  }

  function drawStar(x, y, r, rot) {
    fctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const ang = rot + (i * Math.PI) / 5;
      const px = x + Math.cos(ang) * rad;
      const py = y + Math.sin(ang) * rad;
      if (i === 0) fctx.moveTo(px, py); else fctx.lineTo(px, py);
    }
    fctx.closePath();
    fctx.fill();
  }

  function tick(now) {
    const dt = Math.min(0.04, (now - lastT) / 1000);
    lastT = now;
    fctx.clearRect(0, 0, fxW, fxH);

    parts = parts.filter((p) => {
      if (p.delay > 0) { p.delay -= dt; return true; }
      p.life -= dt;
      if (p.life <= 0) return false;
      const a = Math.max(0, p.life / p.max);

      if (p.kind === 'ring') {
        p.r += dt * p.grow;
        fctx.globalAlpha = a;
        fctx.strokeStyle = p.color;
        fctx.lineWidth = 4 * a + 1;
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        fctx.stroke();
        return true;
      }

      if (p.kind === 'cloud') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.r += p.grow * dt;
        fctx.globalAlpha = a * 0.4;
        fctx.fillStyle = p.color;
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        fctx.fill();
        return true;
      }

      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      fctx.globalAlpha = Math.min(1, a * 1.6);
      fctx.fillStyle = p.color;

      if (p.kind === 'star') {
        drawStar(p.x, p.y, p.size, p.rot);
      } else if (p.kind === 'chunk') {
        fctx.save();
        fctx.translate(p.x, p.y);
        fctx.rotate(p.rot);
        fctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
        fctx.restore();
      } else {
        fctx.beginPath();
        fctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
        fctx.fill();
      }
      return true;
    });

    fctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  }

  function ensureLoop() {
    if (!raf) {
      lastT = performance.now();
      raf = requestAnimationFrame(tick);
    }
  }

  function stinkCloud(x, y) {
    const n = calm ? 3 : 7;
    for (let i = 0; i < n; i++) {
      const life = 1.3 + Math.random() * 0.6;
      parts.push({
        kind: 'cloud',
        x: x + (Math.random() - 0.5) * 50,
        y: y + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 30,
        vy: -30 - Math.random() * 40,
        r: 14 + Math.random() * 14,
        grow: 18 + Math.random() * 14,
        life, max: life,
        color: pick(['#c5df4f', '#a7c83a', '#dfe98a']),
      });
    }
    ensureLoop();
  }

  function shockwave(x, y) {
    const rings = calm ? 2 : 4;
    for (let i = 0; i < rings; i++) {
      parts.push({
        kind: 'ring', x, y, r: 10,
        grow: 520 + i * 60,
        life: 0.5, max: 0.5,
        delay: i * 0.08,
        color: i % 2 ? '#ffd35a' : '#ffffff',
      });
    }
    ensureLoop();
  }

  /* ------------------------------------------------------------------
   * Small UI helpers
   * ------------------------------------------------------------------ */
  let toastTimer = 0;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  function floatWord(text, x, y, color) {
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.setProperty('--rot', (Math.random() * 24 - 12) + 'deg');
    if (color) el.style.color = color;
    floaters.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  function updateHud() {
    const s = Math.round(state.stress);
    stressValue.textContent = s + '%';
    stressFill.style.width = state.stress + '%';
    stressFill.style.backgroundColor = `hsl(${Math.round(150 - state.stress * 1.46)} 85% 62%)`;
    stressFill.parentElement.setAttribute('aria-valuenow', String(s));
    hitCount.textContent = state.hits;
    comboCount.textContent = state.combo;
  }

  /* ------------------------------------------------------------------
   * Mood (default face expressions + red tint on any avatar)
   * ------------------------------------------------------------------ */
  const baseMood = () => (state.stress <= 0 ? 'happy' : 'idle');

  function applyMood(name, tint) {
    state.mood = name;
    const svg = face.querySelector('svg');
    if (svg) svg.dataset.mood = name;
    avatar.classList.toggle('is-hurt', tint === true || tint === 'red');
    avatar.classList.toggle('is-stink', tint === 'green');
  }

  function setMood(name, ms = 0, tint = false) {
    clearTimeout(state.moodTimer);
    applyMood(name, tint);
    if (ms) state.moodTimer = setTimeout(() => applyMood(baseMood(), false), ms);
  }

  /* ------------------------------------------------------------------
   * Tools UI
   * ------------------------------------------------------------------ */
  function setCursor(tool) {
    const inner = tool.icon === 'durian'
      ? `<svg x="0" y="0" width="48" height="48" viewBox="0 0 64 64">${DURIAN_INNER}</svg>`
      : `<text x="24" y="38" font-size="34" text-anchor="middle">${tool.emoji}</text>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48">${inner}</svg>`;
    stage.style.cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 24 24, pointer`;
  }

  function renderTools() {
    const wrap = $('#tools');
    wrap.innerHTML = '';
    TOOLS.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.tool = t.id;
      b.title = `${t.label} (key ${KEYS[i]})`;
      b.innerHTML = `<span class="emoji" aria-hidden="true">${iconHtml(t, 32)}</span><span class="label">${t.label}</span>`;
      b.addEventListener('click', () => selectTool(t.id));
      wrap.appendChild(b);
    });
  }

  function selectTool(id) {
    endSqueeze();
    state.tool = toolById(id).id;
    store.set('tool', state.tool);
    document.querySelectorAll('.tool').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.tool === state.tool));
    });
    setCursor(toolById(state.tool));
  }

  /* ------------------------------------------------------------------
   * Hits
   * ------------------------------------------------------------------ */
  function registerHit() {
    const now = performance.now();
    state.combo = now - state.lastHit < COMBO_WINDOW ? state.combo + 1 : 1;
    state.lastHit = now;
    state.hits++;
    return Math.min(1.6, 1 + (state.combo - 1) * 0.04);
  }

  function reduceStress(amount) {
    const before = state.stress;
    state.stress = Math.max(0, state.stress - amount);
    if (before > 50 && state.stress <= 50) showToast('Halfway there.');
    if (before > 0 && state.stress === 0) {
      showToast('Stress at zero. Take a slow breath.');
      Sound.play('chime');
      burst(fxW / 2, fxH * 0.4, 'spark', 40);
      setMood('happy');
    }
  }

  function toolFx(tool, x, y, nx) {
    const el = document.createElement('div');
    el.className = 'tool-fx';
    el.innerHTML = iconHtml(tool, 64);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    stage.appendChild(el);

    const dir = nx >= 0 ? 1 : -1;
    let frames;
    let opts = { duration: 300, easing: 'ease-out' };

    switch (tool.id) {
      case 'punch':
        frames = [
          { transform: 'translateY(70px) scale(2.4)', opacity: 0 },
          { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.32 },
          { transform: 'translateY(0) scale(1.1)', opacity: 1, offset: 0.7 },
          { transform: 'translateY(-10px) scale(1)', opacity: 0 },
        ];
        opts.duration = 320;
        break;
      case 'slap':
        frames = [
          { transform: `translateX(${dir * 110}px) rotate(${dir * 40}deg)`, opacity: 0 },
          { transform: `translateX(0) rotate(${-dir * 15}deg)`, opacity: 1, offset: 0.4 },
          { transform: `translateX(${-dir * 40}px) rotate(${-dir * 30}deg)`, opacity: 0 },
        ];
        break;
      case 'hammer':
        frames = [
          { transform: 'translate(30px,-150px) rotate(-80deg)', opacity: 0 },
          { transform: 'translate(0,-20px) rotate(-35deg)', opacity: 1, offset: 0.35 },
          { transform: 'translate(0,10px) rotate(15deg)', opacity: 1, offset: 0.6 },
          { transform: 'translate(0,10px) rotate(15deg)', opacity: 1, offset: 0.8 },
          { transform: 'translate(0,0) rotate(0)', opacity: 0 },
        ];
        opts = { duration: 420, easing: 'ease-in' };
        break;
      case 'kick':
        frames = [
          { transform: `translate(${dir * 170}px, 50px) rotate(${-dir * 60}deg)`, opacity: 0 },
          { transform: `translate(${dir * 10}px, 0) rotate(${dir * 10}deg)`, opacity: 1, offset: 0.4 },
          { transform: `translate(${-dir * 40}px, -14px) rotate(${dir * 45}deg)`, opacity: 0 },
        ];
        opts = { duration: 320, easing: 'ease-in' };
        break;
      case 'slipper':
        frames = [
          { transform: `translate(${dir * 90}px,-70px) rotate(${dir * 70}deg)`, opacity: 0 },
          { transform: `translate(0,0) rotate(${-dir * 12}deg)`, opacity: 1, offset: 0.3 },
          { transform: `translate(${dir * 35}px,-35px) rotate(${dir * 35}deg)`, opacity: 1, offset: 0.5 },
          { transform: `translate(0,0) rotate(${-dir * 12}deg)`, opacity: 1, offset: 0.7 },
          { transform: `translate(${dir * 30}px,-30px) rotate(${dir * 40}deg)`, opacity: 0 },
        ];
        opts = { duration: 340, easing: 'ease-out' };
        break;
      case 'jump':
        frames = [
          { transform: 'translate(0,-240px) scale(1.3) rotate(-25deg)', opacity: 0 },
          { transform: 'translate(0,-120px) scale(1.2) rotate(-10deg)', opacity: 1, offset: 0.3 },
          { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0.6 },
          { transform: 'translate(0,-10px) scale(.95) rotate(0deg)', opacity: 1, offset: 0.8 },
          { transform: 'translate(0,-130px) scale(1.1) rotate(10deg)', opacity: 0 },
        ];
        opts = { duration: 520, easing: 'ease-in' };
        break;
      case 'durian': {
        const dsx = (Math.random() < 0.5 ? -1 : 1) * fxW * 0.45;
        frames = [
          { transform: `translate(${dsx}px,${fxH * 0.35}px) scale(.7) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${dsx * 0.45}px,${-fxH * 0.22}px) scale(1.1) rotate(300deg)`, opacity: 1, offset: 0.5 },
          { transform: 'translate(0,0) scale(1) rotate(640deg)', opacity: 1, offset: 0.95 },
          { transform: 'translate(0,0) scale(1.5) rotate(640deg)', opacity: 0 },
        ];
        opts = { duration: 316, easing: 'linear' };
        break;
      }
      case 'yell':
        frames = [
          { transform: `translate(${dir * 140}px,0) scale(${-dir * 0.6},0.6)`, opacity: 0 },
          { transform: `translate(${dir * 75}px,0) scale(${-dir * 1.1},1.1)`, opacity: 1, offset: 0.3 },
          { transform: `translate(${dir * 75}px,0) scale(${-dir},1)`, opacity: 1, offset: 0.85 },
          { transform: `translate(${dir * 75}px,0) scale(${-dir},1)`, opacity: 0 },
        ];
        opts = { duration: 450, easing: 'ease-out' };
        break;
      case 'tomato':
      case 'pie': {
        const sx = (Math.random() < 0.5 ? -1 : 1) * fxW * 0.5;
        frames = [
          { transform: `translate(${sx}px,${fxH * 0.5}px) scale(.7) rotate(0deg)`, opacity: 1 },
          { transform: 'translate(0,0) scale(1) rotate(540deg)', opacity: 1, offset: 0.95 },
          { transform: 'translate(0,0) scale(1.6) rotate(540deg)', opacity: 0 },
        ];
        opts = { duration: 250, easing: 'ease-in' };
        break;
      }
      default: // poke
        frames = [
          { transform: 'translateY(60px) scale(1.4)', opacity: 0 },
          { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.3 },
          { transform: 'translateY(0) scale(.95)', opacity: 1, offset: 0.6 },
          { transform: 'translateY(20px)', opacity: 0 },
        ];
        opts.duration = 260;
    }

    const anim = el.animate(frames, opts);
    anim.onfinish = () => el.remove();
  }

  let knockAnim = null;
  let squashAnim = null;
  const SQUASH = {
    punch: [1.06, 0.92],
    hammer: [1.14, 0.8],
    slap: [0.96, 1.03],
    poke: [1.03, 0.97],
    tomato: [1.05, 0.95],
    kick: [1.08, 0.9],
    jump: [1.22, 0.66],
    slipper: [0.97, 1.02],
    durian: [1.1, 0.88],
    pie: [1.04, 0.96],
    yell: [1.05, 1.05],
  };
  const KNOCK = { punch: 34, slap: 30, poke: 8, hammer: 22, tomato: 16, kick: 48, jump: 30, slipper: 26, durian: 20, pie: 14, yell: 60 };
  const ROT_MUL = { slap: 1.6, slipper: 1.6, kick: 1.8, yell: 0.6 };

  function knock(tool, p, k) {
    const amt = (KNOCK[tool.id] || 20) * k * motionScale;
    let nx = p.nx;
    let ny = p.ny;
    if (Math.hypot(nx, ny) < 0.2) {
      nx = (Math.random() < 0.5 ? -1 : 1) * 0.3;
      ny = -0.1;
    }
    let tx = -nx * amt;
    let ty = -ny * amt * 0.7;
    const rot = -nx * amt * 0.35 * (ROT_MUL[tool.id] || 1);
    if (tool.id === 'jump') { tx = 0; ty = amt * 0.8; }

    if (knockAnim) knockAnim.cancel();
    knockAnim = avatarWrap.animate([
      { transform: 'translate(0,0) rotate(0deg)' },
      { transform: `translate(${tx}px,${ty}px) rotate(${rot}deg)`, offset: 0.25 },
      { transform: `translate(${-tx * 0.35}px,${-ty * 0.35}px) rotate(${-rot * 0.35}deg)`, offset: 0.6 },
      { transform: 'translate(0,0) rotate(0deg)' },
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.3,1)' });

    if (!state.hold) {
      const [sx, sy] = SQUASH[tool.id] || [1, 1];
      if (squashAnim) squashAnim.cancel();
      squashAnim = avatar.animate([
        { transform: 'scale(1,1)' },
        { transform: `scale(${sx},${sy})`, offset: 0.2 },
        { transform: `scale(${1 - (sx - 1) * 0.3},${1 - (sy - 1) * 0.3})`, offset: 0.55 },
        { transform: 'scale(1,1)' },
      ], { duration: 380, easing: 'ease-out' });
    }
  }

  function addSplat(p, variant) {
    const r = avatar.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'splat' + (variant ? ' ' + variant : '');
    el.style.left = ((p.clientX - r.left) / r.width) * 100 + '%';
    el.style.top = ((p.clientY - r.top) / r.height) * 100 + '%';
    el.style.setProperty('--w', 16 + Math.random() * 16 + '%');
    el.style.setProperty('--r', Math.random() * 360 + 'deg');
    splats.appendChild(el);
    while (splats.children.length > 40) splats.firstChild.remove();
  }

  let dizzyTimer = 0;
  function dizzyBurst() {
    dizzy.classList.add('show');
    setMood('dizzy', 1800, true);
    clearTimeout(dizzyTimer);
    dizzyTimer = setTimeout(() => dizzy.classList.remove('show'), 1800);
    floatWord(`Combo x${state.combo}!`, fxW / 2, 44, '#6fe8b8');
  }

  function impact(tool, p) {
    const k = registerHit();
    Sound.play(tool.id, k);
    buzz(tool.id === 'hammer' ? [30, 20, 40] : tool.id === 'poke' ? 8 : 20);
    knock(tool, p, k);
    floatWord(pick(tool.words), p.x, p.y - 30);

    switch (tool.id) {
      case 'tomato':
        burst(p.x, p.y, 'tomato', 22 * k);
        addSplat(p);
        break;
      case 'pie':
        burst(p.x, p.y, 'cream', 22 * k);
        addSplat(p, 'cream');
        break;
      case 'durian':
        burst(p.x, p.y, 'durian', 26 * k);
        addSplat(p, 'durian');
        stinkCloud(p.x, p.y);
        break;
      case 'hammer':
        burst(p.x, p.y, 'hammer', 26 * k);
        break;
      case 'jump':
        burst(p.x, p.y, 'hammer', 16 * k);
        break;
      case 'yell': {
        const ar = avatar.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        shockwave(ar.left - sr.left + ar.width / 2, ar.top - sr.top + ar.height / 2);
        break;
      }
      case 'poke':
        burst(p.x, p.y, 'spark', 6);
        break;
      default:
        burst(p.x, p.y, 'spark', 14 * k);
    }

    if (tool.id === 'durian') setMood('stink', 1500, 'green');
    else setMood('hurt', 380, tool.id !== 'poke');
    reduceStress(tool.power * 0.8 * k);
    if (state.combo > 0 && state.combo % 10 === 0) dizzyBurst();
    updateHud();
  }

  function strike(tool, clientX, clientY) {
    const r = avatar.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rad = r.width / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const sr = stage.getBoundingClientRect();
    const x = clientX - sr.left;
    const y = clientY - sr.top;

    if (Math.hypot(dx, dy) > rad * 1.02) {
      Sound.play('miss');
      floatWord('whiff', x, y, '#a9acd9');
      return;
    }

    const p = {
      x, y, clientX, clientY,
      nx: clamp(dx / rad, -1, 1),
      ny: clamp(dy / rad, -1, 1),
    };
    toolFx(tool, x, y, p.nx);
    setTimeout(() => impact(tool, p), tool.windup);
  }

  /* ------------------------------------------------------------------
   * Squeeze (hold to press, release to boing back)
   * ------------------------------------------------------------------ */
  function startSqueeze(clientX, clientY, pointerId) {
    if (state.hold) return;
    const r = avatar.getBoundingClientRect();
    const rad = r.width / 2;
    const dx = clientX - (r.left + rad);
    const dy = clientY - (r.top + r.height / 2);
    const sr = stage.getBoundingClientRect();
    const x = clientX - sr.left;
    const y = clientY - sr.top;

    if (Math.hypot(dx, dy) > rad * 1.02) {
      Sound.play('miss');
      floatWord('whiff', x, y, '#a9acd9');
      return;
    }

    if (pointerId !== null && pointerId !== undefined) {
      try { stage.setPointerCapture(pointerId); } catch (_) { /* ignore */ }
    }

    const el = document.createElement('div');
    el.className = 'tool-fx';
    el.textContent = toolById('squeeze').emoji;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    stage.appendChild(el);

    const now = performance.now();
    state.hold = { start: now, last: now, x, y, el, t: 0, raf: 0, snd: Sound.squeezeStart() };
    if (knockAnim) knockAnim.cancel();
    if (squashAnim) squashAnim.cancel();
    setMood('squeeze');
    buzz(15);
    state.hold.raf = requestAnimationFrame(holdLoop);
  }

  function holdLoop(now) {
    const h = state.hold;
    if (!h) return;
    const dt = Math.min(0.05, (now - h.last) / 1000);
    h.last = now;
    h.t = Math.min(1, (now - h.start) / 900);
    const e = 1 - Math.pow(1 - h.t, 3);

    avatar.style.transform = `scale(${1 + 0.3 * e},${1 - 0.4 * e})`;
    h.el.style.transform = `scale(${1 - 0.15 * e})`;
    if (h.snd) h.snd.update(e);

    state.lastHit = now;
    reduceStress(9 * dt);
    updateHud();
    h.raf = requestAnimationFrame(holdLoop);
  }

  function endSqueeze() {
    const h = state.hold;
    if (!h) return;
    cancelAnimationFrame(h.raf);
    state.hold = null;
    if (h.snd) h.snd.stop();
    h.el.remove();

    const e = 1 - Math.pow(1 - h.t, 3);
    const sx = 1 + 0.3 * e;
    const sy = 1 - 0.4 * e;
    avatar.style.transform = '';
    squashAnim = avatar.animate([
      { transform: `scale(${sx},${sy})` },
      { transform: `scale(${1 - (sx - 1) * 0.6},${1 + (1 - sy) * 0.6})`, offset: 0.35 },
      { transform: `scale(${1 + (sx - 1) * 0.2},${1 - (1 - sy) * 0.2})`, offset: 0.65 },
      { transform: 'scale(1,1)' },
    ], { duration: 520, easing: 'ease-out' });

    Sound.play('boing');
    registerHit();
    burst(h.x, h.y, 'spark', 8 + e * 10);
    floatWord(pick(toolById('squeeze').words), h.x, h.y - 30);
    setMood('hurt', 350, false);
    updateHud();
  }

  /* ------------------------------------------------------------------
   * Input
   * ------------------------------------------------------------------ */
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    Sound.unlock();
    const tool = toolById(state.tool);
    if (tool.hold) startSqueeze(e.clientX, e.clientY, e.pointerId);
    else strike(tool, e.clientX, e.clientY);
  });

  stage.addEventListener('pointerup', endSqueeze);
  stage.addEventListener('pointercancel', endSqueeze);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  avatarWrap.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (e.repeat) return;
    Sound.unlock();
    const r = avatar.getBoundingClientRect();
    const cx = r.left + r.width / 2 + (Math.random() - 0.5) * r.width * 0.5;
    const cy = r.top + r.height / 2 + (Math.random() - 0.5) * r.height * 0.5;
    const tool = toolById(state.tool);
    if (tool.hold) startSqueeze(cx, cy, null);
    else strike(tool, cx, cy);
  });

  avatarWrap.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') endSqueeze();
  });
  avatarWrap.addEventListener('blur', endSqueeze);

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const idx = e.key.length === 1 ? KEYS.indexOf(e.key) : -1;
    if (idx >= 0 && idx < TOOLS.length) selectTool(TOOLS[idx].id);
  });

  setInterval(() => {
    if (state.combo && !state.hold && performance.now() - state.lastHit > COMBO_WINDOW) {
      state.combo = 0;
      updateHud();
    }
  }, 250);

  /* ------------------------------------------------------------------
   * Photo handling
   * ------------------------------------------------------------------ */
  function applyAdjust() {
    const img = face.querySelector('img');
    if (!img) return;
    img.style.transform = `translate(${adjust.x}%, ${adjust.y}%) scale(${adjust.z})`;
  }

  function syncSliders() {
    zoomEl.value = adjust.z;
    panXEl.value = adjust.x;
    panYEl.value = adjust.y;
  }

  function showCharacter() {
    face.innerHTML = characterSvg(characterById(state.character), baseMood());
    adjustEl.hidden = true;
    applyMood(baseMood(), false);
  }

  function showPhoto(dataUrl) {
    const img = new Image();
    img.alt = 'Your attached photo';
    img.draggable = false;
    img.src = dataUrl;
    face.replaceChildren(img);
    adjustEl.hidden = false;
    applyAdjust();
    applyMood(baseMood(), false);
  }

  function refreshFace() {
    if (state.mode === 'photo' && state.photo) showPhoto(state.photo);
    else showCharacter();
    removeBtn.hidden = !state.photo;
    renderPicker();
    updateNamePlate();
  }

  function loadPhotoFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast("That file isn't a picture.");
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', 0.88);

      adjust.z = 1; adjust.x = 0; adjust.y = 0;
      syncSliders();
      store.set('adjust', adjust);
      const saved = store.set('photo', dataUrl);
      state.photo = dataUrl;
      state.mode = 'photo';
      store.set('mode', 'photo');
      refreshFace();
      showToast(saved ? 'Photo attached.' : 'Photo attached for this session.');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast("Couldn't read that picture. Try a JPG or PNG.");
    };
    img.src = url;
  }

  photoInput.addEventListener('change', () => {
    loadPhotoFile(photoInput.files && photoInput.files[0]);
    photoInput.value = '';
  });

  removeBtn.addEventListener('click', () => {
    store.del('photo');
    state.photo = null;
    state.mode = 'character';
    store.set('mode', 'character');
    refreshFace();
    showToast('Photo removed.');
  });

  [zoomEl, panXEl, panYEl].forEach((el) => {
    el.addEventListener('input', () => {
      adjust.z = parseFloat(zoomEl.value);
      adjust.x = parseFloat(panXEl.value);
      adjust.y = parseFloat(panYEl.value);
      applyAdjust();
      store.set('adjust', adjust);
    });
  });

  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  ['dragenter', 'dragover'].forEach((type) => {
    stage.addEventListener(type, (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      stage.classList.add('drop-active');
    });
  });

  stage.addEventListener('dragleave', () => stage.classList.remove('drop-active'));

  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('drop-active');
    const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
    const file = files.find((f) => f.type.startsWith('image/'));
    if (file) loadPhotoFile(file);
    else showToast("That file isn't a picture.");
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  window.addEventListener('paste', (e) => {
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
    const file = files.find((f) => f.type.startsWith('image/'));
    if (file) {
      e.preventDefault();
      loadPhotoFile(file);
    }
  });

  /* ------------------------------------------------------------------
   * Character picker and name
   * ------------------------------------------------------------------ */
  const picker = $('#chars');
  const nameInput = $('#avatarName');
  const namePlate = $('#nameplate');

  function isSelected(id) {
    const usingPhoto = state.mode === 'photo' && !!state.photo;
    return id === 'photo' ? usingPhoto : !usingPhoto && state.character === id;
  }

  function renderPicker() {
    picker.replaceChildren();
    const add = (id, label, thumbNode) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'char';
      b.setAttribute('aria-pressed', String(isSelected(id)));
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      thumb.appendChild(thumbNode);
      const cap = document.createElement('span');
      cap.className = 'cap';
      cap.textContent = label;
      b.append(thumb, cap);
      b.addEventListener('click', () => chooseFace(id));
      picker.appendChild(b);
    };

    if (state.photo) {
      const img = new Image();
      img.alt = '';
      img.draggable = false;
      img.src = state.photo;
      add('photo', 'My photo', img);
    }

    CHARACTERS.forEach((c) => {
      const holder = document.createElement('span');
      holder.className = 'thumb-svg';
      holder.innerHTML = characterSvg(c, 'idle', true);
      add(c.id, c.name, holder);
    });
  }

  function chooseFace(id) {
    if (id === 'photo') {
      state.mode = 'photo';
    } else {
      state.character = id;
      state.mode = 'character';
      store.set('character', id);
    }
    store.set('mode', state.mode);
    refreshFace();
  }

  function updateNamePlate() {
    const n = state.name.trim();
    namePlate.textContent = n;
    namePlate.hidden = !n;
  }

  nameInput.addEventListener('input', () => {
    state.name = nameInput.value.slice(0, 24);
    store.set('name', state.name);
    updateNamePlate();
  });

  nameInput.addEventListener('change', () => {
    const n = state.name.trim();
    if (n) showToast(`Meet ${n}.`);
  });

  /* ------------------------------------------------------------------
   * Settings and reset buttons
   * ------------------------------------------------------------------ */
  const soundToggle = $('#soundToggle');
  const hapticToggle = $('#hapticToggle');

  soundToggle.checked = state.sound;
  soundToggle.addEventListener('change', () => {
    state.sound = soundToggle.checked;
    store.set('sound', state.sound);
  });

  if (!navigator.vibrate) {
    $('#hapticLabel').hidden = true;
  } else {
    hapticToggle.checked = state.haptics;
    hapticToggle.addEventListener('change', () => {
      state.haptics = hapticToggle.checked;
      store.set('haptics', state.haptics);
    });
  }

  $('#wipeBtn').addEventListener('click', () => {
    splats.replaceChildren();
    showToast('Wiped clean.');
  });

  $('#resetBtn').addEventListener('click', () => {
    endSqueeze();
    state.stress = 100;
    state.hits = 0;
    state.combo = 0;
    splats.replaceChildren();
    dizzy.classList.remove('show');
    setMood(baseMood());
    updateHud();
    showToast('Fresh start.');
  });

  /* ------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------ */
  renderTools();
  selectTool(state.tool);
  resizeFx();
  if (window.ResizeObserver) new ResizeObserver(resizeFx).observe(stage);
  else window.addEventListener('resize', resizeFx);

  syncSliders();
  dizzy.innerHTML = dizzySvg();
  state.photo = store.get('photo', null);
  state.character = characterById(store.get('character', 'putty')).id;
  state.mode = store.get('mode', 'photo') === 'character' ? 'character' : 'photo';
  state.name = String(store.get('name', '')).slice(0, 24);
  nameInput.value = state.name;
  refreshFace();

  updateHud();
  showToast('Pick a move, then tap the face.');
})();
