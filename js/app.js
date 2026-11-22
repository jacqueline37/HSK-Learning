'use strict';
/* ========== 保存 ========== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const settings = Object.assign({ pinyin: true, rate: 0.8, twice: false, voice: '' }, LS.get('hsk1_settings', {}));
const saveSettings = () => LS.set('hsk1_settings', settings);

/* ========== 小道具 ========== */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const py = p => settings.pinyin ? `<div class="py">${esc(p)}</div>` : '';
const KEYS = 'ABCDEF';
const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
const wordOf = h => VOCAB.find(w => w.h === h);

/* ========== 音声（ブラウザ読み上げ） ========== */
const TTS = {
  ok: 'speechSynthesis' in window, voices: [], tok: 0,
  init() {
    if (!this.ok) return;
    const load = () => {
      const all = speechSynthesis.getVoices();
      const zh = all.filter(v => /^(zh|cmn)/i.test(v.lang));
      const cn = zh.filter(v => !/(TW|HK|Hant|yue)/i.test(v.lang));
      this.voices = cn.length ? cn : zh;
    };
    load();
    speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', load);
  },
  female: /(xiaoxiao|xiaoyi|huihui|yaoyao|ting|lili|li-mu|meijia|普通话|female|女)/i,
  male: /(kangkang|yunxi|yunjian|yunyang|male|男)/i,
  base() { return this.voices.find(v => v.name === settings.voice) || this.voices.find(v => /xiaoxiao|google/i.test(v.name)) || this.voices[0] || null; },
  voiceFor(who) {
    const b = this.base();
    if (who === 'm') return this.voices.find(v => this.male.test(v.name)) || b;
    if (who === 'f') return this.voices.find(v => this.female.test(v.name) && !this.male.test(v.name)) || b;
    return b;
  },
  // 収録済み音声ファイル（js/audio-map.js）を優先し、無い文だけブラウザ読み上げ
  audio: typeof Audio !== 'undefined' ? new Audio() : null,
  fileFor(text, who) { return typeof AUDIO !== 'undefined' ? AUDIO[(who === 'm' ? 'm' : 'f') + '|' + text] : null; },
  hasFiles: typeof AUDIO !== 'undefined',
  playFile(src) {
    return new Promise(res => {
      const a = this.audio;
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      a.onended = fin; a.onerror = fin; a.onpause = fin;
      a.src = src;
      a.playbackRate = Math.min(2, Math.max(0.5, settings.rate / 0.8)); // ファイルは速度0.8相当で収録
      a.preservesPitch = true;
      const p = a.play(); if (p && p.catch) p.catch(fin);
    });
  },
  speak(text, who) {
    const f = this.fileFor(text, who);
    if (f && this.audio) return this.playFile(f);
    if (!this.ok) return Promise.resolve();
    return new Promise(res => {
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = settings.rate;
      const v = this.voiceFor(who); if (v) u.voice = v;
      // 男女で同じ声しかない場合は高さを変えて区別
      if (who && (!v || v === this.voiceFor(who === 'm' ? 'f' : 'm'))) u.pitch = who === 'm' ? 0.7 : 1.25;
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
      setTimeout(fin, 4000 + text.length * 700 / settings.rate); // 終了イベントが来ない端末向けの保険
    });
  },
  async play(lines, times = 1, btn) {
    if (!this.ok && !this.hasFiles) return;
    this.stop();
    const t = this.tok;
    btn && btn.classList.add('playing');
    for (let r = 0; r < times; r++) {
      for (const l of lines) {
        if (t !== this.tok) return;
        await this.speak(l.t, l.who);
        await sleep(l.who ? 450 : 300);
      }
      if (r < times - 1) await sleep(900);
    }
    if (t === this.tok && btn) btn.classList.remove('playing');
  },
  stop() { this.tok++; if (this.audio) this.audio.pause(); if (this.ok) speechSynthesis.cancel(); document.querySelectorAll('.play.playing').forEach(b => b.classList.remove('playing')); },
};

/* ========== 問題の作り方（パートごと） ========== */
const picWords = VOCAB.filter(w => w.e);

function genJudge(part, h, listen) {
  const w = wordOf(h);
  const truth = Math.random() < 0.5;
  const shown = truth ? w : pick(picWords.filter(d => d.h !== w.h && d.e !== w.e && !(w.g && d.g === w.g)));
  return {
    part, key: h, kind: 'judge',
    audio: listen ? [{ t: w.h }] : null,
    show: `<div class="bigpic">${shown.e}</div>` + (listen ? '' : `<div class="zh big">${esc(w.h)}</div>${py(w.p)}`),
    opts: [{ html: '✓' , label: '正しい' }, { html: '✗', label: '違う' }],
    ans: truth ? 0 : 1,
    explain: `<div class="ln"><span class="zh">${esc(w.h)}</span>　${esc(w.p)}　<span class="ja">${esc(w.j)}</span></div>` +
      (truth ? `<div class="ln ja">絵と合っています。</div>` : `<div class="ln ja">絵は「${esc(shown.h)}（${esc(shown.p)}）＝${esc(shown.j)}」です。</div>`),
  };
}
function picOpts(a, d) {
  const o = shuffle([a, ...d]);
  return { opts: o.map(e => ({ html: `<span class="pic">${e}</span>`, label: '絵' })), ans: o.indexOf(a) };
}
function exLine(zh, p, j, who) {
  return `<div class="ln">${who ? `<b>${who === 'm' ? '男' : '女'}：</b>` : ''}<span class="zh">${esc(zh)}</span><br>${esc(p)}<br><span class="ja">${esc(j)}</span></div>`;
}
function genSentPic(part, i, listen) {
  const it = SENT_PIC[i];
  return {
    part, key: i, kind: 'pics',
    audio: listen ? [{ t: it.s }] : null,
    show: listen ? '' : `<div class="zh mid">${esc(it.s)}</div>${py(it.p)}`,
    ...picOpts(it.a, it.d),
    explain: exLine(it.s, it.p, it.j),
  };
}
function genDialog(part, i) {
  const it = DIALOG_PIC[i];
  return {
    part, key: i, kind: 'pics',
    audio: it.d.map(l => ({ t: l[1], who: l[0] })),
    show: '',
    ...picOpts(it.a, it.x),
    explain: it.d.map(l => exLine(l[1], l[2], l[3], l[0])).join(''),
  };
}
function textOpts(list, correct) {
  const o = shuffle(list);
  return { opts: o.map(([zh, p]) => ({ html: `<span><span class="zh">${esc(zh)}</span>${py(p)}</span>`, label: zh })), ans: o.findIndex(x => x[0] === correct) };
}
function genSentQ(part, i) {
  const it = SENT_Q[i];
  return {
    part, key: i, kind: 'text',
    audio: [{ t: it.s }, { t: '问：' + it.q, who: 'm' }],
    show: '',
    ...textOpts(it.o, it.o[0][0]),
    explain: exLine(it.s, it.p, it.j) + `<div class="ln"><b>问：</b><span class="zh">${esc(it.q)}</span><br>${esc(it.qp)}<br><span class="ja">${esc(it.qj)}</span></div>`,
  };
}
function genQA(part, i) {
  const it = QA[i];
  const others = shuffle(QA.filter((_, k) => k !== i)).slice(0, 2);
  return {
    part, key: i, kind: 'text',
    audio: null,
    show: `<div class="zh mid">${esc(it.q)}</div>${py(it.qp)}`,
    ...textOpts([[it.a, it.ap], ...others.map(x => [x.a, x.ap])], it.a),
    explain: exLine(it.q, it.qp, it.qj) + exLine(it.a, it.ap, it.aj),
  };
}
function genFill(part, i) {
  const it = FILL[i];
  const list = it.o.map(h => [h, (wordOf(h) || { p: '' }).p]);
  const full = it.s.replace('（　）', `<u>${esc(it.o[0])}</u>`);
  return {
    part, key: i, kind: 'text',
    audio: null,
    show: `<div class="zh mid">${esc(it.s)}</div>`,
    ...textOpts(list, it.o[0]),
    explain: `<div class="ln"><span class="zh">${full}</span><br>${esc(it.p)}<br><span class="ja">${esc(it.j)}</span></div>`,
  };
}
const idx = n => Array.from({ length: n }, (_, i) => i);
const PARTS = {
  L1: { sec: 'L', no: 1, name: '判断（単語）', desc: '単語を聞き、絵と合っていれば ✓、違えば ✗', inst: '音声を聞いて、絵と合っていれば ✓、違えば ✗ を選んでください。', keys: () => picWords.map(w => w.h), gen: k => genJudge('L1', k, true) },
  L2: { sec: 'L', no: 2, name: '絵を選ぶ（文）', desc: '文を聞いて、合う絵を選ぶ', inst: '音声を聞いて、内容に合う絵を選んでください。', keys: () => idx(SENT_PIC.length), gen: k => genSentPic('L2', k, true) },
  L3: { sec: 'L', no: 3, name: '会話と絵', desc: '短い会話を聞いて、合う絵を選ぶ', inst: '会話を聞いて、内容に合う絵を選んでください。', keys: () => idx(DIALOG_PIC.length), gen: k => genDialog('L3', k) },
  L4: { sec: 'L', no: 4, name: '質問に答える', desc: '文と質問を聞いて、答えを選ぶ', inst: '文と質問（问）を聞いて、正しい答えを選んでください。', keys: () => idx(SENT_Q.length), gen: k => genSentQ('L4', k) },
  R1: { sec: 'R', no: 1, name: '判断（単語）', desc: '単語と絵が合っているか判断', inst: '単語と絵が合っていれば ✓、違えば ✗ を選んでください。', keys: () => picWords.map(w => w.h), gen: k => genJudge('R1', k, false) },
  R2: { sec: 'R', no: 2, name: '文と絵', desc: '文を読んで、合う絵を選ぶ', inst: '文を読んで、内容に合う絵を選んでください。', keys: () => idx(SENT_PIC.length), gen: k => genSentPic('R2', k, false) },
  R3: { sec: 'R', no: 3, name: '問いと答え', desc: '問いに合う答えを選ぶ', inst: '問いに対する答えとして正しいものを選んでください。', keys: () => idx(QA.length), gen: k => genQA('R3', k) },
  R4: { sec: 'R', no: 4, name: '空欄補充', desc: '空欄に入る語を選ぶ', inst: '（　）に入る語を選んでください。', keys: () => idx(FILL.length), gen: k => genFill('R4', k) },
};
const partLabel = id => `${PARTS[id].sec === 'L' ? 'リスニング' : 'リーディング'} 第${PARTS[id].no}部分`;

/* ========== 記録 ========== */
const getBest = () => LS.get('hsk1_best', {});
function saveBest(id, pct) { const b = getBest(); if (!(id in b) || pct > b[id]) { b[id] = pct; LS.set('hsk1_best', b); } }
const getMiss = () => LS.get('hsk1_miss', []);
function markMiss(q, wrong) {
  let m = getMiss().filter(x => !(x.part === q.part && x.key === q.key));
  if (wrong) m.unshift({ part: q.part, key: q.key });
  LS.set('hsk1_miss', m.slice(0, 300));
}

/* ========== セッション ========== */
let S = null; // {mode, title, qs, i, answers[], picked}
function startPractice(id, n = 10) {
  const keys = shuffle(PARTS[id].keys()).slice(0, n);
  S = { mode: 'practice', id, title: `${partLabel(id)}：${PARTS[id].name}`, qs: keys.map(k => PARTS[id].gen(k)), i: 0, answers: [] };
  go('#/quiz');
}
function startMock() {
  const qs = [];
  for (const id of Object.keys(PARTS)) shuffle(PARTS[id].keys()).slice(0, 5).forEach(k => qs.push(PARTS[id].gen(k)));
  S = { mode: 'mock', id: 'mock', title: '模擬試験（40問）', qs, i: 0, answers: [] };
  go('#/quiz');
}
function startReview() {
  const m = getMiss().filter(x => PARTS[x.part]);
  if (!m.length) return;
  const items = shuffle(m).slice(0, 15);
  S = { mode: 'review', id: 'review', title: '間違えた問題の復習', qs: items.map(x => PARTS[x.part].gen(x.key)), i: 0, answers: [] };
  go('#/quiz');
}

/* ========== 画面 ========== */
const app = $('#app');
function go(hash) { if (location.hash !== hash) history.pushState(null, '', hash); route(); }
function route() {
  TTS.stop();
  const h = location.hash || '#/';
  document.querySelectorAll('.top nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === h));
  if (h === '#/quiz' && S) return S.done ? renderResult() : renderQ();
  if (h === '#/words') return renderWords();
  if (h === '#/settings') return renderSettings();
  if (h === '#/quiz' || h === '#/result') history.replaceState(null, '', '#/');
  renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', route);
document.addEventListener('click', e => {
  const a = e.target.closest('[data-nav]');
  if (a) { e.preventDefault(); go(a.dataset.nav); }
});

function bestTag(id) {
  const b = getBest()[id];
  return b == null ? '<div class="best">未挑戦</div>' : `<div class="best">ベスト <b>${b}%</b></div>`;
}
function renderHome() {
  const b = getBest();
  const miss = getMiss().length;
  const card = id => `<button class="card" data-part="${id}"><div class="t">第${PARTS[id].no}部分　${PARTS[id].name}</div><div class="d">${PARTS[id].desc}</div>${bestTag(id)}</button>`;
  app.innerHTML = `
    <h1>HSK1級 リスニング・リーディング対策</h1>
    <p class="lead">旧HSK1級（150語）の出題形式に沿った練習問題です。音声はタップで何度でも聞けます。</p>
    <div id="voiceWarn"></div>
    <button class="card hero" id="mock">
      <div class="t">📝 模擬試験に挑戦</div>
      <div class="d">リスニング20問＋リーディング20問・200点満点（120点で合格）</div>
      <div class="best">${b.mock == null ? '未挑戦' : `ベスト <b>${b.mock}点</b>`}</div>
    </button>
    <h2>🎧 リスニング（听力）</h2>
    <div class="grid">${['L1', 'L2', 'L3', 'L4'].map(card).join('')}</div>
    <h2>📖 リーディング（阅读）</h2>
    <div class="grid">${['R1', 'R2', 'R3', 'R4'].map(card).join('')}</div>
    <h2>📚 そのほか</h2>
    <div class="row2">
      <button class="card" id="review" ${miss ? '' : 'disabled'}><div class="t">🔁 間違えた問題を復習</div><div class="d">${miss ? `${miss}問 たまっています` : 'まだありません'}</div></button>
      <button class="card" data-nav="#/words"><div class="t">🈶 単語帳（150語）</div><div class="d">タップで発音を確認</div></button>
    </div>`;
  app.querySelectorAll('[data-part]').forEach(el => el.onclick = () => startPractice(el.dataset.part));
  $('#mock').onclick = startMock;
  $('#review').onclick = startReview;
  checkVoice();
}
function checkVoice() {
  const show = () => {
    const el = $('#voiceWarn'); if (!el) return;
    if (TTS.hasFiles) el.innerHTML = '';
    else if (!TTS.ok) el.innerHTML = '<div class="notice">⚠️ このブラウザは音声読み上げに対応していません。リスニング問題は Chrome / Safari / Edge でお使いください。</div>';
    else if (!TTS.voices.length) el.innerHTML = '<div class="notice">⚠️ 中国語の音声が見つかりませんでした。音が出ない場合は、端末の設定で「中国語（普通话）」の読み上げ音声を追加するか、Chrome / Edge でお試しください。</div>';
    else el.innerHTML = '';
  };
  setTimeout(show, 1200);
}

function renderQ() {
  const q = S.qs[S.i], n = S.qs.length, P = PARTS[q.part];
  const optClass = q.kind === 'pics' ? 'pics' : q.kind === 'judge' ? 'judge' : '';
  const times = S.mode === 'mock' || settings.twice ? 2 : 1;
  app.innerHTML = `
    <div class="qhead"><span>${esc(S.title)}</span><span>${S.i + 1} / ${n}</span></div>
    <div class="bar"><i style="width:${(S.i / n) * 100}%"></i></div>
    <section class="qbox">
      <p class="inst"><b>${partLabel(q.part)}</b>　${P.inst}</p>
      <div class="stage">
        ${q.audio ? `<button class="play" id="play" aria-label="音声を再生">${ICON_PLAY}<span>音声を聞く</span></button>` : ''}
        ${q.show}
      </div>
      <div class="opts ${optClass}" role="group" aria-label="選択肢">
        ${q.opts.map((o, k) => `<button class="opt" data-k="${k}" aria-label="${KEYS[k]} ${esc(o.label)}">${q.kind === 'judge' ? '' : `<span class="k">${KEYS[k]}</span>`}${o.html}</button>`).join('')}
      </div>
      <div id="fb"></div>
      <div class="actions">
        <button class="link" id="quit">やめる</button>
        <button class="btn pri" id="next" ${S.mode === 'mock' ? 'disabled' : 'hidden'}>${S.i + 1 < n ? '次へ' : '結果を見る'}</button>
      </div>
    </section>`;
  const playBtn = $('#play');
  if (playBtn) {
    playBtn.onclick = () => TTS.play(q.audio, 1, playBtn);
    TTS.play(q.audio, times, playBtn);
  }
  app.querySelectorAll('.opt').forEach(b => b.onclick = () => choose(+b.dataset.k));
  $('#next').onclick = next;
  $('#quit').onclick = () => { if (S.mode !== 'mock' || confirm('模擬試験を中断しますか？')) { S = null; go('#/'); } };
  window.scrollTo(0, 0);
}
function choose(k) {
  const q = S.qs[S.i];
  const btns = app.querySelectorAll('.opt');
  if (S.mode === 'mock') { // 本番形式：解答は最後に表示
    S.answers[S.i] = k;
    btns.forEach((b, j) => b.classList.toggle('sel', j === k));
    $('#next').disabled = false;
    return;
  }
  if (S.answers[S.i] != null) return;
  S.answers[S.i] = k;
  const right = k === q.ans;
  markMiss(q, !right);
  btns.forEach((b, j) => { b.disabled = true; if (j === q.ans) b.classList.add('ok'); else if (j === k) b.classList.add('ng'); });
  $('#fb').innerHTML = `<div class="fb ${right ? 'ok' : 'ng'}"><div class="res">${right ? '◎ 正解！' : `✕ 不正解　正解は ${q.kind === 'judge' ? q.opts[q.ans].html : KEYS[q.ans]}`}</div><div class="ex">${q.explain}</div></div>`;
  const nb = $('#next'); nb.hidden = false; nb.focus({ preventScroll: true });
  $('#fb').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function next() {
  TTS.stop();
  if (S.mode === 'mock') { const q = S.qs[S.i]; markMiss(q, S.answers[S.i] !== q.ans); }
  if (S.i + 1 < S.qs.length) { S.i++; renderQ(); }
  else { S.done = true; renderResult(); }
}

function renderResult() {
  const right = S.qs.map((q, i) => S.answers[i] === q.ans);
  const c = right.filter(Boolean).length, n = S.qs.length;
  let head;
  if (S.mode === 'mock') {
    const L = S.qs.reduce((s, q, i) => s + (q.part[0] === 'L' && right[i] ? 5 : 0), 0);
    const R = c * 5 - L;
    const total = L + R;
    saveBest('mock', total);
    const rows = Object.keys(PARTS).map(id => {
      const ix = S.qs.map((q, i) => q.part === id ? i : -1).filter(i => i >= 0);
      return `<tr><td>${partLabel(id)}　${PARTS[id].name}</td><td>${ix.filter(i => right[i]).length} / ${ix.length}</td></tr>`;
    }).join('');
    head = `<div class="score"><div class="n">${total}</div><div class="of">/ 200点（リスニング ${L}点・リーディング ${R}点）</div>
      <div class="pass ${total >= 120 ? 'y' : 'n'}">${total >= 120 ? '合格ライン到達 🎉' : `合格まであと ${120 - total}点`}</div></div>
      <table class="bd">${rows}</table>`;
  } else {
    const pct = Math.round(c / n * 100);
    if (S.mode === 'practice') saveBest(S.id, pct);
    head = `<div class="score"><div class="n">${c}<span style="font-size:28px"> / ${n}</span></div><div class="of">正答率 ${pct}%</div></div>`;
  }
  const wrongs = S.qs.map((q, i) => right[i] ? '' : `<div class="wrong"><div class="tag">${partLabel(q.part)}　${S.answers[i] == null ? '未回答' : `あなたの答え：${q.kind === 'judge' ? q.opts[S.answers[i]].html : KEYS[S.answers[i]]}`}　→　正解：${q.kind === 'judge' ? q.opts[q.ans].html : KEYS[q.ans] + ' ' + q.opts[q.ans].html}</div>
    <div class="ex">${q.explain}</div>${q.audio ? `<button class="link" data-re="${i}">🔊 もう一度聞く</button>` : ''}</div>`).join('');
  app.innerHTML = `
    <div class="qhead"><span>${esc(S.title)}</span><span>結果</span></div>
    <section class="qbox">${head}
      <div class="actions" style="justify-content:center">
        <button class="btn" data-nav="#/">ホームへ</button>
        <button class="btn pri" id="again">もう一度</button>
      </div>
    </section>
    ${wrongs ? `<h2>間違えた問題</h2>${wrongs}<p class="lead">間違えた問題はホームの「復習」からもう一度解けます。</p>` : '<p class="lead" style="text-align:center;margin-top:16px">全問正解です！</p>'}`;
  app.querySelectorAll('[data-re]').forEach(b => b.onclick = () => TTS.play(S.qs[+b.dataset.re].audio));
  $('#again').onclick = () => S.mode === 'mock' ? startMock() : S.mode === 'review' ? (getMiss().length ? startReview() : go('#/')) : startPractice(S.id);
  window.scrollTo(0, 0);
}

function renderWords() {
  app.innerHTML = `
    <h1>単語帳（旧HSK1級 150語）</h1>
    <p class="lead">カードをタップすると発音します。意味やピンインを隠して覚えたかチェックできます。</p>
    <div class="tools">
      <input type="search" id="q" placeholder="漢字・ピンイン・日本語で検索" aria-label="単語を検索">
      <button class="btn" id="hj" aria-pressed="false">意味を隠す</button>
      <button class="btn" id="hp" aria-pressed="false">ピンインを隠す</button>
    </div>
    <div class="words" id="list"></div>`;
  const list = $('#list');
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s/g, '');
  const draw = () => {
    const q = norm($('#q').value);
    list.innerHTML = VOCAB.filter(w => !q || norm(w.h + w.p + w.j).includes(q))
      .map(w => `<button class="w" data-h="${esc(w.h)}"><span class="e">${w.e}</span><div class="zh">${esc(w.h)}</div><div class="py">${esc(w.p)}</div><div class="ja">${esc(w.j)}</div></button>`).join('') || '<p class="lead">見つかりませんでした。</p>';
  };
  draw();
  $('#q').oninput = draw;
  list.onclick = e => { const b = e.target.closest('.w'); if (b) TTS.play([{ t: b.dataset.h }]); };
  const tog = (id, cls) => { const b = $(id); b.onclick = () => { const on = list.classList.toggle(cls); b.setAttribute('aria-pressed', on); b.classList.toggle('pri', on); }; };
  tog('#hj', 'hide-ja'); tog('#hp', 'hide-py');
}

function renderSettings() {
  const vs = TTS.voices;
  app.innerHTML = `
    <h1>設定</h1>
    <div class="set">
      <label><span>ピンインを表示<small>リーディングの問題文・選択肢にピンインを付けます（本番のHSK1級も付いています）</small></span><input type="checkbox" id="s-py" ${settings.pinyin ? 'checked' : ''}></label>
      <label><span>読み上げ速度 <b id="rv">${settings.rate.toFixed(2)}</b><small>本番に近いのは 0.8〜0.9 くらい</small></span><input type="range" id="s-rate" min="0.5" max="1.2" step="0.05" value="${settings.rate}"></label>
      <label><span>練習でも2回ずつ流す<small>本番は各問題が2回読まれます（模擬試験は常に2回）</small></span><input type="checkbox" id="s-tw" ${settings.twice ? 'checked' : ''}></label>
      ${TTS.hasFiles ? `<div class="item"><span>音声<small>収録音声（女性：Xiaoxiao／男性：Yunxi）を使用しています</small></span></div>` : `<label><span>音声<small>${vs.length ? `${vs.length}件の中国語音声があります` : '中国語の音声が見つかりません'}</small></span>
        <select id="s-v" ${vs.length ? '' : 'disabled'}><option value="">自動</option>${vs.map(v => `<option ${v.name === settings.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`}
      <div class="item"><span>試しに聞く</span><button class="btn" id="s-test">你好！我是老师。</button></div>
      <div class="item"><span>学習記録を消す<small>ベストスコアと復習リストを削除します</small></span><button class="btn" id="s-reset">リセット</button></div>
    </div>`;
  $('#s-py').onchange = e => { settings.pinyin = e.target.checked; saveSettings(); };
  $('#s-tw').onchange = e => { settings.twice = e.target.checked; saveSettings(); };
  $('#s-rate').oninput = e => { settings.rate = +e.target.value; $('#rv').textContent = settings.rate.toFixed(2); saveSettings(); };
  if ($('#s-v')) $('#s-v').onchange = e => { settings.voice = e.target.value; saveSettings(); };
  $('#s-test').onclick = e => TTS.play([{ t: '你好！我是老师。' }]);
  $('#s-reset').onclick = () => { if (confirm('学習記録をすべて消しますか？')) { LS.set('hsk1_best', {}); LS.set('hsk1_miss', []); alert('消去しました。'); } };
}

TTS.init();
route();
