const socket = io();

// ============ DOM ============
const lobby = document.getElementById('lobby');
const gameEl = document.getElementById('game');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const inputJoin = document.getElementById('join-code');
const inputNick = document.getElementById('nick-input');
const avatarGrid = document.getElementById('avatar-grid');
const timerChips = document.getElementById('timer-chips');
const lobbyError = document.getElementById('lobby-error');
const roomCodeEl = document.getElementById('room-code');
const btnCopy = document.getElementById('btn-copy');
const diceDisplay = document.getElementById('dice-display');
const btnRoll = document.getElementById('btn-roll');
const btnResign = document.getElementById('btn-resign');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('btn-chat-send');
const btnVoice = document.getElementById('btn-voice');
const remoteAudio = document.getElementById('remote-audio');
const btnHelp = document.getElementById('btn-help');
const helpTooltip = document.getElementById('help-tooltip');
const winnerOverlay = document.getElementById('winner-overlay');
const winnerNameEl = document.getElementById('winner-name');
const btnNewGame = document.getElementById('btn-new-game');
const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');

const AVATARS = ['🦊','🐺','🦁','🐯','🐸','🦄','🐙','🦉','🐵','🦅','🐼','🐧'];

// ============ STATE ============
let myColor = null;
let myNick = '';
let myAvatar = '🦊';
let chosenTimer = 0;
let gameState = null;
let validSources = [];
let selectedSource = null;
let validDestinations = [];
let playerCount = 0;
let playersInfo = [];           // [{color, nick, avatar}]
let turnDeadlineMs = null;      // sunucudan gelen son hamle deadline'ı
let moveTimerSec = 0;           // odanın hamle süresi ayarı (s)
let lastSystemMsg = null;       // chat'e tekrar push etmemek için
let peerConn = null;            // RTCPeerConnection (sesli sohbet)
let localStream = null;
let voiceLocal = false;         // benim mikrofonum açık mı
let voiceRemote = false;        // karşı tarafın durumu (server üzerinden)
let audioCtx = null;            // konuşma seviyesini ölçmek için
let speakAnalysers = { local: null, remote: null };
let dragSource = null;            // sürüklenen pulun kaynağı (0-23 veya 'bar')
let dragDestinations = [];        // sürüklenen pulun geçerli hedefleri
let ghostEl = null;               // imleci takip eden hayalet pul
let pendingPointer = null;        // pointerdown'da kaydedilen, drag/tap belirleyici

// ============ CONSTANTS ============
const W = 1200, H = 700;
const FRAME = 28;
const BEAROFF_W = 76;
const BAR_W = 58;
const PLAY_L = FRAME;
const PLAY_R = W - FRAME - BEAROFF_W;
const PLAY_T = FRAME;
const PLAY_B = H - FRAME;
const PLAY_W = PLAY_R - PLAY_L;
const HALF_W = (PLAY_W - BAR_W) / 2;
const POINT_W = HALF_W / 6;
const POINT_H = (PLAY_B - PLAY_T) * 0.42;
// Pulun yarıçapı, hem nokta genişliğine hem 5'li yığının yüksekliğe sığmasına göre
const CHECKER_R = Math.min((POINT_W - 18) / 2, (POINT_H - 36) / 10);
const CHECKER_GAP = 1.2;

const C = {
  // Outer frame (board edge)
  woodOuter: ['#11141F', '#06070D'],
  // Inner play surface
  playBg: ['#161B2D', '#0B0F1B'],
  // Alternating triangle colors
  pointDark:  ['#3B2666', '#1A1235'],   // deep violet
  pointLight: ['#E2E7F2', '#9CA4BB'],   // pearl
  // Checker pieces
  white: ['#FFFFFF', '#C8CDDB', '#5A6378'],
  black: ['#3E4252', '#1A1D26', '#04060A'],
  // UI
  bar: '#0A0D17',
  bearOff: '#070A12',
  highlight: '#06D6F8',  // electric cyan
  selected: '#B069FF',   // soft violet
  text: 'rgba(231, 234, 242, 0.5)',
  textDim: 'rgba(231, 234, 242, 0.28)'
};

// ============ HELPERS ============
function pointCoord(pointNum) {
  if (pointNum >= 13) {
    let x;
    if (pointNum <= 18) {
      x = PLAY_L + (pointNum - 13) * POINT_W + POINT_W / 2;
    } else {
      x = PLAY_L + HALF_W + BAR_W + (pointNum - 19) * POINT_W + POINT_W / 2;
    }
    return { x, y: PLAY_T, dir: 1 };
  } else {
    let x;
    if (pointNum <= 6) {
      x = PLAY_L + HALF_W + BAR_W + (6 - pointNum) * POINT_W + POINT_W / 2;
    } else {
      x = PLAY_L + (12 - pointNum) * POINT_W + POINT_W / 2;
    }
    return { x, y: PLAY_B, dir: -1 };
  }
}

function checkerStackY(pointNum, stackIdx) {
  const { y, dir } = pointCoord(pointNum);
  const startY = y + dir * (CHECKER_R + 4);
  return startY + dir * stackIdx * (CHECKER_R * 2 + CHECKER_GAP);
}

// ============ DRAWING ============
function drawFrame() {
  // Dış çerçeve — derin lacivert düz gradient
  const og = ctx.createLinearGradient(0, 0, 0, H);
  og.addColorStop(0, C.woodOuter[0]);
  og.addColorStop(1, C.woodOuter[1]);
  ctx.fillStyle = og;
  ctx.fillRect(0, 0, W, H);

  // İç oyun alanı
  const pg = ctx.createLinearGradient(PLAY_L, PLAY_T, PLAY_L, PLAY_B);
  pg.addColorStop(0, C.playBg[0]);
  pg.addColorStop(1, C.playBg[1]);
  ctx.fillStyle = pg;
  ctx.fillRect(PLAY_L, PLAY_T, PLAY_W, PLAY_B - PLAY_T);

  // Hafif merkezi parıltı (vignette tersine)
  const vg = ctx.createRadialGradient(W/2, H/2, 100, W/2, H/2, W*0.6);
  vg.addColorStop(0, 'rgba(6, 214, 248, 0.04)');
  vg.addColorStop(1, 'transparent');
  ctx.fillStyle = vg;
  ctx.fillRect(PLAY_L, PLAY_T, PLAY_W, PLAY_B - PLAY_T);

  // Bar — ince koyu şerit, kenarlarında hafif cyan parıltı
  const barX = PLAY_L + HALF_W;
  ctx.fillStyle = C.bar;
  ctx.fillRect(barX, PLAY_T, BAR_W, PLAY_B - PLAY_T);
  // Kenar çizgileri
  ctx.strokeStyle = 'rgba(6, 214, 248, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(barX + 0.5, PLAY_T);
  ctx.lineTo(barX + 0.5, PLAY_B);
  ctx.moveTo(barX + BAR_W - 0.5, PLAY_T);
  ctx.lineTo(barX + BAR_W - 0.5, PLAY_B);
  ctx.stroke();

  // Bear-off — daha koyu, içe çökmüş his
  const boX = PLAY_R;
  ctx.fillStyle = C.bearOff;
  ctx.fillRect(boX, PLAY_T, BEAROFF_W, PLAY_B - PLAY_T);
  // İki bear-off bölgesinin çerçevesi
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(boX + 6, PLAY_T + 6, BEAROFF_W - 12, (PLAY_B - PLAY_T)/2 - 9);
  ctx.strokeRect(boX + 6, (PLAY_T + PLAY_B)/2 + 3, BEAROFF_W - 12, (PLAY_B - PLAY_T)/2 - 9);
  // Bear-off etiketleri
  ctx.fillStyle = C.textDim;
  ctx.font = '600 8px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const labelLetterSpacing = 1.4;
  function drawSpacedText(text, cx, cy) {
    const chars = text.split('');
    const width = chars.length * 5.5 + (chars.length - 1) * labelLetterSpacing;
    let xx = cx - width / 2 + 2.75;
    for (const ch of chars) {
      ctx.fillText(ch, xx, cy);
      xx += 5.5 + labelLetterSpacing;
    }
  }
  drawSpacedText('SİYAH', boX + BEAROFF_W/2, PLAY_T + 18);
  drawSpacedText('BEYAZ', boX + BEAROFF_W/2, PLAY_B - 18);

  // İç çerçeve — çok ince ışıklı çizgi
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.strokeRect(PLAY_L + 0.5, PLAY_T + 0.5, PLAY_W - 1, PLAY_B - PLAY_T - 1);
}

function drawPoint(pointNum) {
  const { x, y, dir } = pointCoord(pointNum);
  const isDark = pointNum % 2 === 0;
  const colors = isDark ? C.pointDark : C.pointLight;
  const grad = ctx.createLinearGradient(x, y, x, y + dir * POINT_H);
  grad.addColorStop(0, colors[0]);
  grad.addColorStop(1, colors[1]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(x - POINT_W/2 + 1.5, y);
  ctx.lineTo(x + POINT_W/2 - 1.5, y);
  ctx.lineTo(x, y + dir * POINT_H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Subtle highlight on one edge
  ctx.beginPath();
  ctx.moveTo(x - POINT_W/2 + 2, y);
  ctx.lineTo(x, y + dir * POINT_H);
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Number label outside the play area
  ctx.fillStyle = C.textDim;
  ctx.font = '500 9px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = dir === 1 ? 'bottom' : 'top';
  const labelY = dir === 1 ? y - 4 : y + 4;
  ctx.fillText(pointNum, x, labelY);
}

function drawChecker(x, y, color, alpha = 1) {
  const cols = color === 'white' ? C.white : C.black;
  ctx.save();
  ctx.globalAlpha = alpha;

  // Drop shadow
  ctx.beginPath();
  ctx.arc(x + 1, y + 2.5, CHECKER_R, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill();

  // Body radial gradient
  const grad = ctx.createRadialGradient(x - CHECKER_R*0.35, y - CHECKER_R*0.4, CHECKER_R*0.1, x, y, CHECKER_R);
  grad.addColorStop(0, cols[0]);
  grad.addColorStop(0.55, cols[1]);
  grad.addColorStop(1, cols[2]);
  ctx.beginPath();
  ctx.arc(x, y, CHECKER_R, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Outer border
  ctx.strokeStyle = color === 'white' ? 'rgba(90, 99, 120, 0.7)' : 'rgba(0, 0, 0, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Inner detail rings (sadece beyazda hafif görünsün)
  ctx.beginPath();
  ctx.arc(x, y, CHECKER_R * 0.78, 0, Math.PI * 2);
  ctx.strokeStyle = color === 'white' ? 'rgba(120, 130, 150, 0.4)' : 'rgba(60, 65, 80, 0.6)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, CHECKER_R * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // Specular highlight — daha güçlü, modern parlak yüzey hissi
  ctx.beginPath();
  ctx.ellipse(x - CHECKER_R*0.32, y - CHECKER_R*0.35, CHECKER_R*0.36, CHECKER_R*0.2, -0.4, 0, Math.PI*2);
  ctx.fillStyle = color === 'white' ? 'rgba(255,255,255,0.7)' : 'rgba(176, 105, 255, 0.18)';
  ctx.fill();

  ctx.restore();
}

function drawCheckersOnPoint(pointNum) {
  const p = gameState.points[pointNum - 1];
  if (!p.color || p.count === 0) return;
  const { x } = pointCoord(pointNum);
  // Bu noktadan pul sürükleniyorsa görsel olarak bir azalt
  let count = p.count;
  if (dragSource === pointNum - 1) count = Math.max(0, count - 1);
  if (count === 0) return;
  const max = 5;
  const visible = Math.min(count, max);
  for (let i = 0; i < visible; i++) {
    const cy = checkerStackY(pointNum, i);
    drawChecker(x, cy, p.color);
  }
  if (count > max) {
    const topY = checkerStackY(pointNum, visible - 1);
    ctx.fillStyle = p.color === 'white' ? '#1a1a1a' : '#fff';
    ctx.font = 'bold 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×' + count, x, topY);
  }
}

function drawBar() {
  const bx = PLAY_L + HALF_W + BAR_W/2;
  let whiteOn = gameState.bar.white;
  let blackOn = gameState.bar.black;
  if (dragSource === 'bar') {
    if (myColor === 'white') whiteOn = Math.max(0, whiteOn - 1);
    else blackOn = Math.max(0, blackOn - 1);
  }
  for (let i = 0; i < whiteOn; i++) {
    const y = PLAY_T + CHECKER_R + 10 + i * (CHECKER_R * 2 + CHECKER_GAP);
    drawChecker(bx, y, 'white');
  }
  for (let i = 0; i < blackOn; i++) {
    const y = PLAY_B - CHECKER_R - 10 - i * (CHECKER_R * 2 + CHECKER_GAP);
    drawChecker(bx, y, 'black');
  }
}

function drawBearOff() {
  const cx = PLAY_R + BEAROFF_W/2;
  const stackR = CHECKER_R * 0.85;
  for (let i = 0; i < gameState.off.white; i++) {
    const y = PLAY_B - 14 - i * 6;
    ctx.beginPath();
    ctx.ellipse(cx, y, stackR, 3.5, 0, 0, Math.PI*2);
    ctx.fillStyle = '#D2D7E3';
    ctx.fill();
    ctx.strokeStyle = 'rgba(110, 120, 142, 0.6)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  for (let i = 0; i < gameState.off.black; i++) {
    const y = PLAY_T + 14 + i * 6;
    ctx.beginPath();
    ctx.ellipse(cx, y, stackR, 3.5, 0, 0, Math.PI*2);
    ctx.fillStyle = '#15181F';
    ctx.fill();
    ctx.strokeStyle = 'rgba(50, 55, 70, 0.8)';
    ctx.lineWidth = 0.6;
    ctx.stroke();
  }
  // Sayaçlar
  ctx.fillStyle = C.text;
  ctx.font = '600 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(gameState.off.white + '/15', cx, PLAY_B + 2);
  ctx.fillText(gameState.off.black + '/15', cx, PLAY_T + 2);
}

function drawGlow(x, y, r, alpha = 0.4) {
  ctx.save();
  const grad = ctx.createRadialGradient(x, y, r*0.3, x, y, r*1.7);
  grad.addColorStop(0, C.highlight);
  grad.addColorStop(1, 'transparent');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r*1.7, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = C.highlight;
  ctx.lineWidth = 2;
  ctx.shadowColor = C.highlight;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function drawSelectionRing(x, y, r) {
  ctx.save();
  ctx.strokeStyle = C.selected;
  ctx.lineWidth = 3;
  ctx.shadowColor = C.selected;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function drawHighlights() {
  if (!gameState || gameState.winner) return;
  if (gameState.turn !== myColor) return;
  if (!gameState.rolled) return;

  // Pul sürüklenirken: bırakılabilecek hedef noktaları işaretle
  if (dragSource !== null) {
    for (const dest of dragDestinations) {
      if (dest.to === 'off') {
        const cx = PLAY_R + BEAROFF_W/2;
        const cy = myColor === 'white' ? PLAY_B - 30 : PLAY_T + 30;
        drawGlow(cx, cy, 26, 0.6);
      } else {
        const pointNum = dest.to + 1;
        const p = gameState.points[dest.to];
        const { x } = pointCoord(pointNum);
        const nextIdx = (p.color === myColor) ? Math.min(p.count, 5) : 0;
        const cy = checkerStackY(pointNum, nextIdx);
        drawGlow(x, cy, CHECKER_R + 3, 0.55);
      }
    }
    return;
  }

  if (selectedSource !== null) {
    let sx, sy;
    if (selectedSource === 'bar') {
      sx = PLAY_L + HALF_W + BAR_W/2;
      const cnt = gameState.bar[myColor];
      sy = myColor === 'white'
        ? PLAY_T + CHECKER_R + 10 + (cnt - 1) * (CHECKER_R*2 + CHECKER_GAP)
        : PLAY_B - CHECKER_R - 10 - (cnt - 1) * (CHECKER_R*2 + CHECKER_GAP);
    } else {
      const pointNum = selectedSource + 1;
      const p = gameState.points[selectedSource];
      const { x } = pointCoord(pointNum);
      const topIdx = Math.min(p.count, 5) - 1;
      sx = x;
      sy = checkerStackY(pointNum, Math.max(0, topIdx));
    }
    drawSelectionRing(sx, sy, CHECKER_R + 5);

    for (const dest of validDestinations) {
      if (dest.to === 'off') {
        const cx = PLAY_R + BEAROFF_W/2;
        const cy = myColor === 'white' ? PLAY_B - 30 : PLAY_T + 30;
        drawGlow(cx, cy, 22, 0.5);
      } else {
        const pointNum = dest.to + 1;
        const p = gameState.points[dest.to];
        const { x } = pointCoord(pointNum);
        const nextIdx = (p.color === myColor) ? Math.min(p.count, 5) : 0;
        const cy = checkerStackY(pointNum, nextIdx);
        drawGlow(x, cy, CHECKER_R + 2, 0.5);
      }
    }
  }
}

function render() {
  ctx.clearRect(0, 0, W, H);
  drawFrame();
  for (let p = 1; p <= 24; p++) drawPoint(p);
  if (gameState) {
    for (let p = 1; p <= 24; p++) drawCheckersOnPoint(p);
    drawBar();
    drawBearOff();
    drawHighlights();
  }
}

// ============ HIT TEST ============
function hitTest(mx, my) {
  const barX = PLAY_L + HALF_W;
  if (mx >= barX && mx <= barX + BAR_W && my >= PLAY_T && my <= PLAY_B) return 'bar';
  if (mx >= PLAY_R && mx <= PLAY_R + BEAROFF_W && my >= PLAY_T && my <= PLAY_B) return 'off';

  for (let p = 1; p <= 24; p++) {
    const { x, y, dir } = pointCoord(p);
    const left = x - POINT_W/2;
    const right = x + POINT_W/2;
    if (mx < left || mx > right) continue;
    if (dir === 1) {
      // Top row: from y down to roughly the middle of the board
      if (my >= y && my <= y + POINT_H + 60) return p - 1;
    } else {
      if (my >= y - POINT_H - 60 && my <= y) return p - 1;
    }
  }
  return null;
}

// ============ INTERACTION (PUL SÜRÜKLE-BIRAK) ============
const DRAG_THRESHOLD = 5; // px

function pointerToCanvas(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    mx: (e.clientX - rect.left) * scaleX,
    my: (e.clientY - rect.top) * scaleY
  };
}

function createGhost(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const displayScale = rect.width / canvas.width;
  const size = CHECKER_R * 2 * displayScale;
  const el = document.createElement('div');
  el.className = 'checker-ghost ' + myColor;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.left = (clientX - size/2) + 'px';
  el.style.top = (clientY - size/2) + 'px';
  document.body.appendChild(el);
  ghostEl = el;
}

function moveGhost(clientX, clientY) {
  if (!ghostEl) return;
  const r = ghostEl.getBoundingClientRect();
  ghostEl.style.left = (clientX - r.width/2) + 'px';
  ghostEl.style.top  = (clientY - r.height/2) + 'px';
}

function destroyGhost() {
  if (ghostEl) { ghostEl.remove(); ghostEl = null; }
}

// Bir hedef seçildiğinde, ulaşmak için gereken zar dizisini sırayla gönder.
// Sunucu her bir hamleyi ayrı ayrı doğrular ve uygular.
function executeMoveSequence(seq) {
  for (const step of seq) {
    socket.emit('move', { from: step.from, to: step.to, die: step.die }, (resp) => {
      if (resp && resp.error) pushChatSystem(resp.error);
    });
  }
}

function onCanvasPointerDown(e) {
  if (!gameState || gameState.winner) return;
  if (gameState.turn !== myColor || !gameState.rolled) return;

  const { mx, my } = pointerToCanvas(e);
  const hit = hitTest(mx, my);

  // Bir kaynak zaten seçiliyse (tıkla akışı), tıklanan yer geçerli bir hedefse oyna
  if (selectedSource !== null) {
    let chosen = null;
    for (const d of validDestinations) {
      if ((d.to === 'off' && hit === 'off') || d.to === hit) { chosen = d; break; }
    }
    if (chosen) {
      selectedSource = null;
      validDestinations = [];
      executeMoveSequence(chosen.sequence);
      render();
      return;
    }
  }

  // Tıklanan yer benim oynayabileceğim bir pul mu?
  let source = null;
  if (hit === 'bar' && gameState.bar[myColor] > 0 && validSources.includes('bar')) {
    source = 'bar';
  } else if (typeof hit === 'number' &&
             gameState.points[hit].color === myColor &&
             validSources.includes(hit)) {
    source = hit;
  }

  if (source === null) {
    // Boş yere veya oynanamayan bir pula bastı → seçimi temizle
    selectedSource = null;
    validDestinations = [];
    render();
    return;
  }

  // Sürükle/tap için bekle: pointermove gelirse drag, gelmezse tap
  const destinations = computeValidDestinations(source);
  pendingPointer = { source, destinations, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
  canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  canvas.addEventListener('pointermove', onCanvasPointerMove);
  canvas.addEventListener('pointerup', onCanvasPointerUp);
  canvas.addEventListener('pointercancel', onCanvasPointerUp);
}

function onCanvasPointerMove(e) {
  if (!pendingPointer) return;
  const dx = e.clientX - pendingPointer.startX;
  const dy = e.clientY - pendingPointer.startY;

  if (dragSource === null) {
    if (dx*dx + dy*dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
    // Drag başlat
    dragSource = pendingPointer.source;
    dragDestinations = pendingPointer.destinations;
    selectedSource = null;
    validDestinations = [];
    createGhost(e.clientX, e.clientY);
    render();
  } else {
    moveGhost(e.clientX, e.clientY);
  }
}

function onCanvasPointerUp(e) {
  canvas.removeEventListener('pointermove', onCanvasPointerMove);
  canvas.removeEventListener('pointerup', onCanvasPointerUp);
  canvas.removeEventListener('pointercancel', onCanvasPointerUp);

  if (dragSource !== null) {
    // Sürüklenen pul bırakıldı — hedef geçerli mi?
    const { mx, my } = pointerToCanvas(e);
    const hit = hitTest(mx, my);
    let chosen = null;
    for (const d of dragDestinations) {
      if ((d.to === 'off' && hit === 'off') || d.to === hit) { chosen = d; break; }
    }
    if (chosen) {
      executeMoveSequence(chosen.sequence);
    }
    dragSource = null;
    dragDestinations = [];
    destroyGhost();
    render();
  } else if (pendingPointer) {
    // Drag eşiği aşılmadı → tap = pulu seç (tıkla-akışı yedek)
    selectedSource = pendingPointer.source;
    validDestinations = pendingPointer.destinations;
    render();
  }
  pendingPointer = null;
}

// ---- Kural fonksiyonları: state parametre alıyor (simülasyon için) ----
function canLandState(state, pointIndex) {
  const p = state.points[pointIndex];
  if (p.color === null || p.color === myColor) return true;
  return p.count <= 1;
}

function allInHomeState(state) {
  if (state.bar[myColor] > 0) return false;
  if (myColor === 'white') {
    for (let i = 6; i < 24; i++) {
      if (state.points[i].color === 'white' && state.points[i].count > 0) return false;
    }
  } else {
    for (let i = 0; i < 18; i++) {
      if (state.points[i].color === 'black' && state.points[i].count > 0) return false;
    }
  }
  return true;
}

function canBearOffState(state, sourceIndex, die) {
  if (!allInHomeState(state)) return false;
  const sp = sourceIndex + 1;
  if (myColor === 'white') {
    if (die === sp) return true;
    if (die > sp) {
      for (let p = sp + 1; p <= 6; p++) {
        if (state.points[p-1].color === 'white' && state.points[p-1].count > 0) return false;
      }
      return true;
    }
    return false;
  } else {
    const dist = 25 - sp;
    if (die === dist) return true;
    if (die > dist) {
      for (let p = sp - 1; p >= 19; p--) {
        if (state.points[p-1].color === 'black' && state.points[p-1].count > 0) return false;
      }
      return true;
    }
    return false;
  }
}

function singleDieDest(state, pos, die) {
  if (pos === 'bar') {
    const dest = myColor === 'white' ? (24 - die) : (die - 1);
    if (dest < 0 || dest > 23) return null;
    if (!canLandState(state, dest)) return null;
    return dest;
  }
  const sp = pos + 1;
  const destPoint = myColor === 'white' ? (sp - die) : (sp + die);
  if (destPoint >= 1 && destPoint <= 24) {
    const di = destPoint - 1;
    if (!canLandState(state, di)) return null;
    return di;
  }
  if (canBearOffState(state, pos, die)) return 'off';
  return null;
}

function cloneStateLite(s) {
  return {
    points: s.points.map(p => ({ color: p.color, count: p.count })),
    bar: { white: s.bar.white, black: s.bar.black },
    off: { white: s.off.white, black: s.off.black }
  };
}

function applyMoveClone(state, source, to) {
  const s = cloneStateLite(state);
  if (source === 'bar') {
    s.bar[myColor]--;
  } else {
    s.points[source].count--;
    if (s.points[source].count === 0) s.points[source].color = null;
  }
  if (to === 'off') {
    s.off[myColor]++;
  } else {
    const p = s.points[to];
    if (p.color && p.color !== myColor) {
      const opp = myColor === 'white' ? 'black' : 'white';
      s.bar[opp]++;
      p.count = 0;
      p.color = null;
    }
    p.color = myColor;
    p.count++;
  }
  return s;
}

// Bir kaynaktan kalan zarları tek veya kombine kullanarak ulaşılabilecek
// tüm bitiş noktalarını ve adım dizisini döndürür. Aynı noktaya birden
// fazla yol varsa, en az zar tüketen yolu seçer.
function computeValidDestinations(source) {
  const best = new Map(); // key (to) -> sequence

  function explore(state, pos, dicePool, path) {
    if (dicePool.length === 0) return;
    const tried = new Set();
    for (let i = 0; i < dicePool.length; i++) {
      const die = dicePool[i];
      if (tried.has(die)) continue;
      tried.add(die);

      const dest = singleDieDest(state, pos, die);
      if (dest === null) continue;

      const newPath = path.concat([{ from: pos, to: dest, die }]);
      const key = String(dest);
      const existing = best.get(key);
      if (!existing || existing.length > newPath.length) {
        best.set(key, newPath);
      }

      if (dest !== 'off') {
        const newState = applyMoveClone(state, pos, dest);
        const newDice = dicePool.slice(0, i).concat(dicePool.slice(i + 1));
        explore(newState, dest, newDice, newPath);
      }
    }
  }

  explore(cloneStateLite(gameState), source, gameState.remaining.slice(), []);

  const result = [];
  for (const [key, seq] of best) {
    const to = key === 'off' ? 'off' : parseInt(key, 10);
    result.push({ to, sequence: seq });
  }
  return result;
}

// ============ DICE UI ============
function pipPositions(v) {
  const a = 0.26, c = 0.5, b = 0.74;
  return {
    1: [[c, c]],
    2: [[a, a], [b, b]],
    3: [[a, a], [c, c], [b, b]],
    4: [[a, a], [a, b], [b, a], [b, b]],
    5: [[a, a], [a, b], [c, c], [b, a], [b, b]],
    6: [[a, a], [a, c], [a, b], [b, a], [b, c], [b, b]]
  }[v] || [];
}

function makeDieEl(value, used) {
  const el = document.createElement('div');
  el.className = 'die' + (used ? ' used' : '');
  for (const [px, py] of pipPositions(value)) {
    const pip = document.createElement('div');
    pip.className = 'pip';
    pip.style.left = (px * 100) + '%';
    pip.style.top = (py * 100) + '%';
    pip.style.transform = 'translate(-50%, -50%)';
    el.appendChild(pip);
  }
  return el;
}

// ============ UI UPDATE ============
function updateUI() {
  if (!gameState) return;

  // Dice
  diceDisplay.innerHTML = '';
  if (gameState.rolled && gameState.dice.length > 0) {
    const all = gameState.dice[0] === gameState.dice[1]
      ? [gameState.dice[0], gameState.dice[0], gameState.dice[0], gameState.dice[0]]
      : gameState.dice.slice();
    const remCounts = {};
    for (const d of gameState.remaining) remCounts[d] = (remCounts[d] || 0) + 1;
    all.forEach(v => {
      const used = !(remCounts[v] > 0);
      if (!used) remCounts[v]--;
      diceDisplay.appendChild(makeDieEl(v, used));
    });
  } else {
    diceDisplay.innerHTML = '<div class="die-placeholder">—</div><div class="die-placeholder">—</div>';
  }

  // Roll button
  btnRoll.disabled = !(
    playerCount === 2 &&
    gameState.turn === myColor &&
    !gameState.rolled &&
    !gameState.winner
  );

  // Oyuncu kartlarını güncelle
  updatePlayerCards();

  // gameState.message değiştiğinde chat'e sistem mesajı olarak akıt
  if (gameState.message && gameState.message !== lastSystemMsg) {
    pushChatSystem(gameState.message);
    lastSystemMsg = gameState.message;
  }

  // Winner
  if (gameState.winner) {
    winnerOverlay.classList.remove('hidden');
    winnerNameEl.textContent = gameState.winner === 'white' ? 'BEYAZ' : 'SİYAH';
  } else {
    winnerOverlay.classList.add('hidden');
  }
}

// ============ PLAYER CARDS + TIMER ============
function updatePlayerCards() {
  // Renge göre oyuncu bul (varsa)
  const byColor = { white: null, black: null };
  for (const p of playersInfo) byColor[p.color] = p;

  const renderOne = (idx, color) => {
    const p = byColor[color];
    const card = document.getElementById('player-card-' + idx);
    const avatarEl = document.getElementById('p' + idx + '-avatar');
    const nickEl = document.getElementById('p' + idx + '-nick');
    const checkerEl = document.getElementById('p' + idx + '-checker');
    const colorEl = document.getElementById('p' + idx + '-color');
    const youEl = document.getElementById('p' + idx + '-you');
    const timerEl = document.getElementById('p' + idx + '-timer');

    if (p) {
      card.classList.remove('empty');
      avatarEl.textContent = p.avatar || '🦊';
      nickEl.textContent = p.nick || (color === 'white' ? 'Beyaz' : 'Siyah');
    } else {
      card.classList.add('empty');
      avatarEl.textContent = '?';
      nickEl.textContent = 'bekleniyor…';
    }
    checkerEl.className = 'checker-mini ' + color;
    colorEl.textContent = color === 'white' ? 'beyaz' : 'siyah';
    youEl.classList.toggle('hidden', myColor !== color);

    // Aktif mi?
    const isActive = !!gameState && !gameState.winner
      && playerCount === 2 && gameState.turn === color;
    card.classList.toggle('active', isActive);

    // Timer görünür mü?
    const showTimer = isActive && moveTimerSec > 0 && turnDeadlineMs;
    timerEl.classList.toggle('hidden', !showTimer);
  };

  renderOne(1, 'white');
  renderOne(2, 'black');
}

function fmtTimer(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function tickTimer() {
  if (!gameState || gameState.winner || playerCount !== 2 || !turnDeadlineMs || !moveTimerSec) {
    return;
  }
  const turn = gameState.turn;
  const idx = turn === 'white' ? 1 : 2;
  const timerEl = document.getElementById('p' + idx + '-timer');
  const left = Math.max(0, Math.ceil((turnDeadlineMs - Date.now()) / 1000));
  timerEl.textContent = fmtTimer(left);
  timerEl.classList.toggle('warn', left <= 10 && left > 5);
  timerEl.classList.toggle('danger', left <= 5);
}
setInterval(tickTimer, 250);

// ============ CHAT ============
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function pushChat({ from, nick, avatar, text }) {
  const row = document.createElement('div');
  const isMe = from === myColor;
  row.className = 'chat-msg' + (isMe ? ' me' : '');
  row.innerHTML = `
    <div class="avatar">${escHtml(avatar || '🦊')}</div>
    <div>
      <div class="nick">${escHtml(nick || 'Oyuncu')}</div>
      <div class="bubble">${escHtml(text)}</div>
    </div>
  `;
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
function pushChatSystem(text) {
  if (!text) return;
  const row = document.createElement('div');
  row.className = 'chat-msg system';
  row.innerHTML = `<div class="bubble">${escHtml(text)}</div>`;
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat', { text });
  chatInput.value = '';
}
chatSendBtn.onclick = sendChat;
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
});

socket.on('chat', (msg) => pushChat(msg));

// ============ HELP TOOLTIP ============
btnHelp.onclick = (e) => {
  e.stopPropagation();
  helpTooltip.classList.toggle('hidden');
};
document.addEventListener('click', (e) => {
  if (!helpTooltip.contains(e.target) && e.target !== btnHelp) {
    helpTooltip.classList.add('hidden');
  }
});

// ============ SESLİ SOHBET (WebRTC) ============
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function setVoiceBtnState(state) {
  // state: 'off' | 'on' | 'requesting'
  btnVoice.classList.remove('active', 'requesting');
  if (state === 'on') {
    btnVoice.classList.add('active');
    btnVoice.querySelector('.voice-state').textContent = 'Açık';
    btnVoice.setAttribute('aria-pressed', 'true');
  } else if (state === 'requesting') {
    btnVoice.classList.add('requesting');
    btnVoice.querySelector('.voice-state').textContent = '...';
  } else {
    btnVoice.querySelector('.voice-state').textContent = 'Sesli';
    btnVoice.setAttribute('aria-pressed', 'false');
  }
}

async function toggleVoice() {
  if (voiceLocal) {
    stopVoice();
    return;
  }
  setVoiceBtnState('requesting');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
  } catch (err) {
    setVoiceBtnState('off');
    pushChatSystem('Mikrofon izni reddedildi.');
    return;
  }
  voiceLocal = true;
  setVoiceBtnState('on');
  socket.emit('voice-status', { enabled: true });
  ensurePeer();
  for (const t of localStream.getAudioTracks()) peerConn.addTrack(t, localStream);
  watchLocalLevel();

  // Eğer karşı taraf da sesli açıksa, ben (beyaz olan) teklif başlatırım
  if (voiceRemote && myColor === 'white') {
    await sendOffer();
  }
}

function stopVoice() {
  voiceLocal = false;
  setVoiceBtnState('off');
  socket.emit('voice-status', { enabled: false });
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  closePeer();
  setSpeaking(myColor, false);
}

function ensurePeer() {
  if (peerConn) return peerConn;
  peerConn = new RTCPeerConnection(RTC_CONFIG);
  peerConn.onicecandidate = (e) => {
    if (e.candidate) socket.emit('webrtc-ice', { candidate: e.candidate });
  };
  peerConn.ontrack = (e) => {
    const [stream] = e.streams;
    remoteAudio.srcObject = stream;
    watchRemoteLevel(stream);
  };
  peerConn.onconnectionstatechange = () => {
    if (!peerConn) return;
    if (['failed', 'disconnected', 'closed'].includes(peerConn.connectionState)) {
      // bağlantı koptu → temizle ama mic'i kapatma
      setSpeaking(otherColor(), false);
    }
  };
  return peerConn;
}
function otherColor() {
  return myColor === 'white' ? 'black' : 'white';
}
function closePeer() {
  if (peerConn) {
    try { peerConn.close(); } catch (e) {}
    peerConn = null;
  }
  remoteAudio.srcObject = null;
}

async function sendOffer() {
  ensurePeer();
  try {
    const offer = await peerConn.createOffer();
    await peerConn.setLocalDescription(offer);
    socket.emit('webrtc-offer', { sdp: offer });
  } catch (e) { console.error('offer error', e); }
}

socket.on('voice-status', ({ enabled }) => {
  voiceRemote = !!enabled;
  if (!voiceRemote) {
    closePeer();
    setSpeaking(otherColor(), false);
  } else if (voiceLocal && myColor === 'white') {
    sendOffer();
  }
});
socket.on('webrtc-offer', async ({ sdp }) => {
  if (!voiceLocal) return; // mic açık değilse cevaplama
  ensurePeer();
  try {
    await peerConn.setRemoteDescription(sdp);
    const answer = await peerConn.createAnswer();
    await peerConn.setLocalDescription(answer);
    socket.emit('webrtc-answer', { sdp: answer });
  } catch (e) { console.error('answer error', e); }
});
socket.on('webrtc-answer', async ({ sdp }) => {
  if (!peerConn) return;
  try { await peerConn.setRemoteDescription(sdp); }
  catch (e) { console.error('setRemote answer', e); }
});
socket.on('webrtc-ice', async ({ candidate }) => {
  if (!peerConn || !candidate) return;
  try { await peerConn.addIceCandidate(candidate); }
  catch (e) { console.error('ice add', e); }
});

btnVoice.onclick = toggleVoice;

// ============ KONUŞMA ALGILAMA ============
function ensureAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function makeAnalyser(stream) {
  const ctx = ensureAudioCtx();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.5;
  src.connect(analyser);
  return analyser;
}
function watchLocalLevel() {
  if (!localStream) return;
  speakAnalysers.local = makeAnalyser(localStream);
}
function watchRemoteLevel(stream) {
  speakAnalysers.remote = makeAnalyser(stream);
}
const SPEAK_THRESHOLD = 18; // RMS eşiği
function pollLevels() {
  const buf = new Uint8Array(256);
  function readLevel(an) {
    if (!an) return 0;
    an.getByteFrequencyData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i];
    return sum / buf.length;
  }
  const lLvl = readLevel(speakAnalysers.local);
  const rLvl = readLevel(speakAnalysers.remote);
  setSpeaking(myColor, lLvl > SPEAK_THRESHOLD);
  setSpeaking(otherColor(), rLvl > SPEAK_THRESHOLD);
}
setInterval(pollLevels, 120);

function setSpeaking(color, on) {
  if (!color) return;
  const idx = color === 'white' ? 1 : 2;
  const card = document.getElementById('player-card-' + idx);
  if (card) card.classList.toggle('speaking', !!on);
}

// ============ SOCKET EVENTS ============
socket.on('state', ({ state, validSources: vs, players, settings, turnDeadline }) => {
  gameState = state;
  validSources = (vs && vs[myColor]) || [];
  playerCount = (players && players.length) || 0;
  playersInfo = players || [];
  moveTimerSec = (settings && settings.moveTimer) || 0;
  turnDeadlineMs = turnDeadline || null;
  if (selectedSource !== null) {
    if (!validSources.includes(selectedSource)) {
      selectedSource = null;
      validDestinations = [];
    } else {
      validDestinations = computeValidDestinations(selectedSource);
    }
  }
  updateUI();
  tickTimer();
  render();
});

socket.on('disconnect', () => {
  pushChatSystem('Sunucu bağlantısı koptu.');
});

// ============ LOBBY INIT ============
function buildAvatarGrid() {
  AVATARS.forEach((emoji, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-btn' + (i === 0 ? ' selected' : '');
    btn.textContent = emoji;
    btn.dataset.avatar = emoji;
    btn.onclick = () => {
      avatarGrid.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      myAvatar = emoji;
    };
    avatarGrid.appendChild(btn);
  });
  myAvatar = AVATARS[0];
}
buildAvatarGrid();

// Random nick suggestion
const sampleNicks = ['Tahir', 'Kanka', 'Pasa', 'Reis', 'Hocam', 'Usta', 'Veli', 'Ayse'];
inputNick.placeholder = sampleNicks[Math.floor(Math.random() * sampleNicks.length)];

// Timer chips
timerChips.querySelectorAll('.chip').forEach(chip => {
  chip.onclick = () => {
    timerChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    chosenTimer = Number(chip.dataset.timer);
  };
});

function captureProfile() {
  myNick = (inputNick.value || '').trim() || inputNick.placeholder || 'Oyuncu';
}

btnCreate.onclick = () => {
  lobbyError.textContent = '';
  captureProfile();
  socket.emit('create-room', { nick: myNick, avatar: myAvatar, moveTimer: chosenTimer }, (resp) => {
    if (resp.error) { lobbyError.textContent = resp.error; return; }
    myColor = resp.color;
    enterGame(resp.code);
  });
};

btnJoin.onclick = () => {
  lobbyError.textContent = '';
  const code = inputJoin.value.trim().toUpperCase();
  if (code.length < 4) { lobbyError.textContent = 'Geçerli bir kod gir.'; return; }
  captureProfile();
  socket.emit('join-room', { code, nick: myNick, avatar: myAvatar }, (resp) => {
    if (resp.error) { lobbyError.textContent = resp.error; return; }
    myColor = resp.color;
    enterGame(resp.code);
  });
};

inputJoin.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});
inputJoin.addEventListener('input', () => {
  inputJoin.value = inputJoin.value.toUpperCase();
});

function enterGame(code) {
  roomCodeEl.textContent = code;
  lobby.classList.add('hidden');
  gameEl.classList.remove('hidden');
}

btnCopy.onclick = async () => {
  try {
    await navigator.clipboard.writeText(roomCodeEl.textContent);
    btnCopy.textContent = 'Kopyalandı ✓';
    setTimeout(() => btnCopy.textContent = 'Kodu Kopyala', 1400);
  } catch (e) {}
};

btnRoll.onclick = () => socket.emit('roll');
btnNewGame.onclick = () => socket.emit('new-game');
btnResign.onclick = () => {
  if (confirm('Odadan çıkmak istediğine emin misin?')) location.reload();
};

canvas.addEventListener('pointerdown', onCanvasPointerDown);

// Initial empty render
render();
