'use strict';
/* ========== 保存 ========== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
// level: 1 | 2（新HSKの級）。キー名は旧版（HSK1だけだった頃）のまま使い続ける
const settings = Object.assign({ pinyin: true, rate: 0.8, twice: false, voice: '', theme: 'mix', level: 2 }, LS.get('hsk1_settings', {}));
const saveSettings = () => LS.set('hsk1_settings', settings);

// 旧版（旧HSK1級の8部分）の記録を、新しい部分IDに付け替える（1回だけ）
(function migrate() {
  if (LS.get('hsk_migrated', 0) >= 2) return;
  const map = { L1: '1D1', R1: '1D2', L2: '1L1', L3: '1L3', L4: '1L4', R2: '1R1', R3: '1R2', R4: '1R3', mock: 'mock1' };
  const best = LS.get('hsk1_best', {}), nb = {};
  for (const [k, v] of Object.entries(best)) nb[map[k] || k] = v;
  LS.set('hsk1_best', nb);
  LS.set('hsk1_miss', LS.get('hsk1_miss', []).map(x => ({ ...x, part: map[x.part] || x.part })));
  LS.set('hsk_migrated', 2);
})();

/* ========== 小道具 ========== */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = a => a[Math.floor(Math.random() * a.length)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const py = p => settings.pinyin && p ? `<div class="py" lang="zh-Latn-pinyin">${esc(p)}</div>` : '';
const KEYS = 'ABCDEF';
const ICON_PLAY = '<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg><span class="wave" aria-hidden="true"><i></i><i></i><i></i></span>';
const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6"/></svg>';
const ICON_NG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
// 赤ペンの丸（正解）と鉛筆の斜線（選んだ誤答）
const PEN_O = '<svg class="pen" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M56 5C82 4 97 15 96 31C95 48 74 57 48 56C22 55 4 46 4 30C4 15 21 6 46 4.5"/></svg>';
const PEN_X = '<svg class="pen x" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M14 54L86 6"/></svg>';
const NUM = '一二三四';
const symOf = (q, k) => q.kind === 'judge' ? q.opts[k].sym : KEYS[k];
const ALL_WORDS = [...VOCAB, ...VOCAB2, ...EXTRA_WORDS];
const wordOf = h => ALL_WORDS.find(w => w.h === h);

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
  setBtn(btn, on) {
    if (!btn) return;
    btn.classList.toggle('playing', on);
    const l = btn.querySelector('.lbl'); if (l) l.textContent = on ? '止める' : 'もう一度聞く';
    if (btn.id === 'play') btn.setAttribute('aria-label', on ? '再生を止める' : '音声をもう一度聞く');
  },
  async play(lines, times = 1, btn) {
    if (!this.ok && !this.hasFiles) return;
    this.stop();
    const t = this.tok;
    this.setBtn(btn, true);
    for (let r = 0; r < times; r++) {
      for (const l of lines) {
        if (t !== this.tok) return;
        await this.speak(l.t, l.who);
        await sleep(l.who ? 450 : 300);
      }
      if (r < times - 1) await sleep(900);
    }
    if (t === this.tok) this.setBtn(btn, false);
  },
  stop() { this.tok++; if (this.audio) this.audio.pause(); if (this.ok) speechSynthesis.cancel(); document.querySelectorAll('.play.playing').forEach(b => this.setBtn(b, false)); },
};

/* ========== 問題の作り方（形式ごと） ========== */
const zhLine = (zh, cls = 'mid') => `<div lang="zh-Hans" class="zh ${cls}">${esc(zh)}</div>`;
function exLine(zh, p, j, who) {
  return `<div class="ln">${who ? `<b>${who === 'm' ? '男' : '女'}：</b>` : ''}<span lang="zh-Hans" class="zh">${esc(zh)}</span><br>${esc(p)}<br><span class="ja">${esc(j)}</span></div>`;
}
const qLine = (label, it) => `<div class="ln"><b>${label}</b><span lang="zh-Hans" class="zh">${esc(it.q)}</span><br>${esc(it.qp)}<br><span class="ja">${esc(it.qj)}</span></div>`;
function picOpts(a, d) {
  const o = shuffle([a, ...d]);
  return { opts: o.map(e => ({ html: `<span class="pic">${e}</span>`, label: '絵' })), ans: o.indexOf(a) };
}
function textOpts(list, correct) {
  const o = shuffle(list);
  return { opts: o.map(([zh, p]) => ({ html: `<span><span lang="zh-Hans" class="zh">${esc(zh)}</span>${py(p)}</span>`, label: zh })), ans: o.findIndex(x => x[0] === correct) };
}

// 単語と絵が合っているか ✓✗（旧HSK1級の形式。単語ドリルとして残している）
function genJudge(part, words, h, listen) {
  const w = words.find(x => x.h === h);
  const pics = words.filter(d => d.e);
  const truth = Math.random() < 0.5;
  const shown = truth ? w : pick(pics.filter(d => d.h !== w.h && d.e !== w.e && !(w.g && d.g === w.g)));
  return {
    part, key: h, kind: 'judge',
    audio: listen ? [{ t: w.h }] : null,
    show: `<div class="bigpic">${shown.e}</div>` + (listen ? '' : `${zhLine(w.h, 'big')}${py(w.p)}`),
    opts: [{ html: ICON_OK, label: '正しい', sym: '✓' }, { html: ICON_NG, label: '違う', sym: '✗' }],
    ans: truth ? 0 : 1,
    explain: `<div class="ln"><span lang="zh-Hans" class="zh">${esc(w.h)}</span>　${esc(w.p)}　<span class="ja">${esc(w.j)}</span></div>` +
      (truth ? `<div class="ln ja">絵と合っています。</div>` : `<div class="ln ja">絵は「${esc(shown.h)}（${esc(shown.p)}）＝${esc(shown.j)}」です。</div>`),
  };
}
// 文を聞いて／読んで絵を選ぶ
function genSentPic(part, list, i, listen) {
  const it = list[i];
  return {
    part, key: i, kind: 'pics', ak: !!it.ak,
    audio: listen ? [{ t: it.s }] : null,
    show: listen ? '' : `${zhLine(it.s)}${py(it.p)}`,
    ...picOpts(it.a, it.d),
    explain: exLine(it.s, it.p, it.j),
  };
}
// 会話を聞いて絵を選ぶ
function genDialog(part, list, i) {
  const it = list[i];
  return {
    part, key: i, kind: 'pics', ak: !!it.ak,
    audio: it.d.map(l => ({ t: l[1], who: l[0] })),
    show: '',
    ...picOpts(it.a, it.x),
    explain: it.d.map(l => exLine(l[1], l[2], l[3], l[0])).join(''),
  };
}
// 文と質問：聞く（问）／読む（★）
function genSentQ(part, list, i, listen) {
  const it = list[i];
  return {
    part, key: i, kind: 'text', ak: !!it.ak,
    audio: listen ? [{ t: it.s }, { t: '问：' + it.q, who: 'm' }] : null,
    show: listen ? '' : `<div class="passage">${zhLine(it.s, 'para')}${py(it.p)}</div><div class="star">${zhLine('★ ' + it.q, 'q')}${py(it.qp)}</div>`,
    ...textOpts(it.o, it.o[0][0]),
    explain: exLine(it.s, it.p, it.j) + qLine(listen ? '问：' : '★ ', it),
  };
}
// 会話と質問を聞いて答えを選ぶ（2級）
function genDialogQ(part, list, i) {
  const it = list[i];
  return {
    part, key: i, kind: 'text', ak: !!it.ak,
    audio: [...it.d.map(l => ({ t: l[1], who: l[0] })), { t: '问：' + it.q, who: 'm' }],
    show: '',
    ...textOpts(it.o, it.o[0][0]),
    explain: it.d.map(l => exLine(l[1], l[2], l[3], l[0])).join('') + qLine('问：', it),
  };
}
// 問いと答え：読む／問いかけを聞く（誤答は同じテーマのほかの答えから。人名で正解がわからないように）
function genQA(part, list, i, listen) {
  const it = list[i];
  const others = shuffle(list.filter((x, k) => k !== i && !x.ak === !it.ak)).slice(0, 2);
  return {
    part, key: i, kind: 'text', ak: !!it.ak,
    audio: listen ? [{ t: it.q }] : null,
    show: listen ? '' : `${zhLine(it.q)}${py(it.qp)}`,
    ...textOpts([[it.a, it.ap], ...others.map(x => [x.a, x.ap])], it.a),
    explain: exLine(it.q, it.qp, it.qj) + exLine(it.a, it.ap, it.aj),
  };
}
// 空欄に入る語を選ぶ  o は '語' か ['語','ピンイン']（同じ字で読みが違う語のため）
function genFill(part, list, i) {
  const it = list[i];
  const o = it.o.map(x => typeof x === 'string' ? [x, (wordOf(x) || { p: '' }).p] : x);
  const full = esc(it.s).replace('（　）', `<u>${esc(o[0][0])}</u>`);
  return {
    part, key: i, kind: 'text', ak: !!it.ak,
    audio: null,
    show: zhLine(it.s),
    ...textOpts(o, o[0][0]),
    explain: `<div class="ln"><span lang="zh-Hans" class="zh">${full}</span><br>${esc(it.p)}<br><span class="ja">${esc(it.j)}</span></div>`,
  };
}
// 書写：語のうち1字が一部だけ書かれていて、足りない部分を選ぶ（2級）
// 本番の答案と同じく、1字ずつピンインを付けたマス目で見せる
const POS = { l: '左', r: '右', t: '上', b: '下', o: '外側', i: '内側', ir: '内側' };
function genPart(part, list, i) {
  const it = list[i];
  const all = [...new Set(list.map(x => x.a))].filter(a => a !== it.a);
  const same = shuffle(all.filter(a => list.some(x => x.a === a && x.pos === it.pos)));
  const d = [...same, ...shuffle(all.filter(a => !same.includes(a)))].slice(0, 3);
  const pys = it.wp.split(/\s+/);
  const cells = [...it.w].map((ch, k) => `<span class="kc"><span class="kc-py" lang="zh-Latn-pinyin">${esc(pys[k] || '')}</span>` +
    (ch === it.c
      ? `<span class="kc-box part pos-${it.pos}"><span class="have" lang="zh-Hans">${esc(it.r)}</span><span class="miss" aria-hidden="true">？</span></span>`
      : `<span class="kc-box" lang="zh-Hans">${esc(ch)}</span>`) + '</span>').join('');
  return {
    part, key: i, kind: 'text', cls: 'four rad',
    audio: null,
    show: `<div class="kw" role="img" aria-label="${esc(it.wp)}。${esc(it.c)}の${POS[it.pos]}の部分が欠けています">${cells}</div>
      <div class="kw-ja">${esc(it.wj)}</div>
      <p class="kj-hint">点線の部分（<b>${POS[it.pos]}</b>）に入るものを選んでください</p>`,
    ...textOpts([it.a, ...d].map(a => [a, '']), it.a),
    explain: `<div class="ln"><span lang="zh-Hans" class="zh">${esc(it.r)}</span> ＋ <span lang="zh-Hans" class="zh">${esc(it.a)}</span> ＝ <span lang="zh-Hans" class="zh"><u>${esc(it.c)}</u></span></div>` +
      `<div class="ln"><span lang="zh-Hans" class="zh">${esc(it.w)}</span>　${esc(it.wp)}　<span class="ja">${esc(it.wj)}</span></div>`,
  };
}
// 書写：ピンインを見て（　）に入る漢字を選ぶ（2級）  本番も文全体にピンインが付くので、設定に関係なく表示
function genHanzi(part, list, i) {
  const it = list[i];
  const full = esc(it.s).replace('（　）', `<u>${esc(it.a)}</u>`);
  return {
    part, key: i, kind: 'text', cls: 'four rad', ak: !!it.ak,
    audio: null,
    show: `${zhLine(it.s)}<div class="py" lang="zh-Latn-pinyin">${esc(it.p)}</div>`,
    ...textOpts(it.o.map(c => [c, '']), it.a),
    explain: `<div class="ln"><span lang="zh-Hans" class="zh">${full}</span><br>${esc(it.p)}<br><span class="ja">${esc(it.j)}</span></div>`,
  };
}

/* ========== 級と部分 ========== */
const idx = n => Array.from({ length: n }, (_, i) => i);
// 例文テーマ（設定）  std=ふつう ak=アークナイツ mix=両方
const THEMES = [['std', 'ふつう'], ['ak', 'アークナイツ'], ['mix', '両方']];
const themeOK = x => settings.theme === 'mix' || (settings.theme === 'ak') === !!x.ak;
const SEC = {
  L: { zh: '听力', ja: 'リスニング' },
  R: { zh: '阅读', ja: 'リーディング' },
  W: { zh: '书写', ja: '書写' },
  D: { zh: '单词', ja: '単語ドリル' },
};
// list があるものは例文テーマで絞り込む。words は単語ドリル用
const PARTS = {
  // ---- 新HSK1級（样卷：听力20問・阅读20問） ----
  '1L1': { lv: 1, sec: 'L', no: 1, name: '絵を選ぶ', desc: '文を聞いて、合う絵を選ぶ', inst: '音声を聞いて、内容に合う絵を選んでください。', list: SENT_PIC, gen: k => genSentPic('1L1', SENT_PIC, k, true) },
  '1L2': { lv: 1, sec: 'L', no: 2, name: '応答を選ぶ', desc: '問いかけを聞いて、合う答えを選ぶ', inst: '問いかけを聞いて、答えとして正しいものを選んでください。', list: QA, gen: k => genQA('1L2', QA, k, true) },
  '1L3': { lv: 1, sec: 'L', no: 3, name: '会話と絵', desc: '短い会話を聞いて、合う絵を選ぶ', inst: '会話を聞いて、内容に合う絵を選んでください。', list: DIALOG_PIC, gen: k => genDialog('1L3', DIALOG_PIC, k) },
  '1L4': { lv: 1, sec: 'L', no: 4, name: '質問に答える', desc: '文と質問を聞いて、答えを選ぶ', inst: '文と質問（问）を聞いて、正しい答えを選んでください。', list: SENT_Q, gen: k => genSentQ('1L4', SENT_Q, k, true) },
  '1R1': { lv: 1, sec: 'R', no: 1, name: '文と絵', desc: '文を読んで、合う絵を選ぶ', inst: '文を読んで、内容に合う絵を選んでください。', list: SENT_PIC, gen: k => genSentPic('1R1', SENT_PIC, k, false) },
  '1R2': { lv: 1, sec: 'R', no: 2, name: '問いと答え', desc: '問いに合う答えを選ぶ', inst: '問いに対する答えとして正しいものを選んでください。', list: QA, gen: k => genQA('1R2', QA, k, false) },
  '1R3': { lv: 1, sec: 'R', no: 3, name: '空欄補充', desc: '空欄に入る語を選ぶ', inst: '（　）に入る語を選んでください。', list: FILL, gen: k => genFill('1R3', FILL, k) },
  '1R4': { lv: 1, sec: 'R', no: 4, name: '短文と問い', desc: '短い文を読んで、★の問いに答える', inst: '文を読んで、★の問いの答えを選んでください。', list: SENT_Q, gen: k => genSentQ('1R4', SENT_Q, k, false) },
  '1D1': { lv: 1, sec: 'D', no: 1, name: '単語と絵（聞く）', desc: '単語を聞き、絵と合っていれば ✓', inst: '音声を聞いて、絵と合っていれば ✓、違えば ✗ を選んでください。', words: VOCAB, gen: k => genJudge('1D1', VOCAB, k, true) },
  '1D2': { lv: 1, sec: 'D', no: 2, name: '単語と絵（読む）', desc: '単語を読み、絵と合っていれば ✓', inst: '単語と絵が合っていれば ✓、違えば ✗ を選んでください。', words: VOCAB, gen: k => genJudge('1D2', VOCAB, k, false) },
  // ---- 新HSK2級（样卷：听力25問・阅读25問・书写10問） ----
  '2L1': { lv: 2, sec: 'L', no: 1, name: '絵を選ぶ', desc: '文を聞いて、合う絵を選ぶ', inst: '音声を聞いて、内容に合う絵を選んでください。', list: SENT_PIC2, gen: k => genSentPic('2L1', SENT_PIC2, k, true) },
  '2L2': { lv: 2, sec: 'L', no: 2, name: '会話と絵', desc: '短い会話を聞いて、合う絵を選ぶ', inst: '会話を聞いて、内容に合う絵を選んでください。', list: DIALOG_PIC2, gen: k => genDialog('2L2', DIALOG_PIC2, k) },
  '2L3': { lv: 2, sec: 'L', no: 3, name: '会話と質問', desc: '会話と質問を聞いて、答えを選ぶ', inst: '会話と質問（问）を聞いて、正しい答えを選んでください。', list: DIALOG_Q2, gen: k => genDialogQ('2L3', DIALOG_Q2, k) },
  '2R1': { lv: 2, sec: 'R', no: 1, name: '文と絵', desc: '文を読んで、合う絵を選ぶ', inst: '文を読んで、内容に合う絵を選んでください。', list: SENT_PIC2, gen: k => genSentPic('2R1', SENT_PIC2, k, false) },
  '2R2': { lv: 2, sec: 'R', no: 2, name: '空欄補充', desc: '空欄に入る語を選ぶ', inst: '（　）に入る語を選んでください。', list: FILL2, gen: k => genFill('2R2', FILL2, k) },
  '2R3': { lv: 2, sec: 'R', no: 3, name: '文と応答', desc: '文に合う応答を選ぶ', inst: '文に続く応答として正しいものを選んでください。', list: QA2, gen: k => genQA('2R3', QA2, k, false) },
  '2R4': { lv: 2, sec: 'R', no: 4, name: '短文と問い', desc: '短い文を読んで、★の問いに答える', inst: '文を読んで、★の問いの答えを選んでください。', list: READ2, gen: k => genSentQ('2R4', READ2, k, false) },
  '2W1': { lv: 2, sec: 'W', no: 1, name: '漢字の部分', desc: '一部だけ書かれた字の、足りない部分を選ぶ', inst: 'ピンインと意味を手がかりに、点線の部分に入るものを選んでください。', list: PART2, gen: k => genPart('2W1', PART2, k) },
  '2W2': { lv: 2, sec: 'W', no: 2, name: '漢字を書く', desc: 'ピンインを見て、入る漢字を選ぶ', inst: 'ピンインを見て、（　）に入る漢字を選んでください（本番は手で書きます）。', list: HANZI2, gen: k => genHanzi('2W2', HANZI2, k) },
  '2D1': { lv: 2, sec: 'D', no: 1, name: '単語と絵（聞く）', desc: '2級の単語を聞き、絵と合っていれば ✓', inst: '音声を聞いて、絵と合っていれば ✓、違えば ✗ を選んでください。', words: VOCAB2, gen: k => genJudge('2D1', VOCAB2, k, true) },
  '2D2': { lv: 2, sec: 'D', no: 2, name: '単語と絵（読む）', desc: '2級の単語を読み、絵と合っていれば ✓', inst: '単語と絵が合っていれば ✓、違えば ✗ を選んでください。', words: VOCAB2, gen: k => genJudge('2D2', VOCAB2, k, false) },
};
// 模擬試験は公式样卷と同じ問題数。配点は公式の発表がないため、各セクション100点・合計の6割を合格の目安にしている
const LEVELS = {
  1: {
    name: '1級', words: VOCAB, wordNote: '新HSK1級 300語',
    lead: '新HSK1級（2025年版大纲・300語）の出題形式に沿った練習問題です。各部分は10問ずつ、答えるたびに解説が出ます。',
    secs: ['L', 'R'], drills: ['1D1', '1D2'],
    mock: [['1L1', 5], ['1L2', 5], ['1L3', 5], ['1L4', 5], ['1R1', 5], ['1R2', 5], ['1R3', 5], ['1R4', 5]],
    mockDesc: '本番と同じ40問（リスニング20問・リーディング20問）。音声は各2回流れ、答え合わせは最後にまとめて行います。',
  },
  2: {
    name: '2級', words: VOCAB2, wordNote: '新HSK2級 200語（1級の300語と合わせて500語）',
    lead: '新HSK2級（2025年版大纲・新出200語、累計500語）の出題形式に沿った練習問題です。2級から「書写」が加わります。',
    secs: ['L', 'R', 'W'], drills: ['2D1', '2D2'],
    mock: [['2L1', 5], ['2L2', 10], ['2L3', 10], ['2R1', 5], ['2R2', 5], ['2R3', 10], ['2R4', 5], ['2W1', 5], ['2W2', 5]],
    mockDesc: '本番と同じ60問（リスニング25問・リーディング25問・書写10問）。音声は各2回流れ、答え合わせは最後にまとめて行います。',
  },
};
for (const L of Object.values(LEVELS)) { L.max = L.secs.length * 100; L.pass = L.max * 0.6; }
const LV = () => LEVELS[settings.level] || LEVELS[2];
const partsOf = (lv, sec) => Object.keys(PARTS).filter(id => PARTS[id].lv === lv && (!sec || PARTS[id].sec === sec));
const partLabel = id => { const P = PARTS[id]; return P.sec === 'D' ? `${SEC.D.ja} ${P.no}` : `${SEC[P.sec].ja} 第${P.no}部分`; };
// テーマに合う問題を先に、足りなければほかのテーマで補って n 問選ぶ
function pickKeys(id, n) {
  const P = PARTS[id];
  if (P.words) return shuffle(P.words.filter(w => w.e).map(w => w.h)).slice(0, n);
  const all = idx(P.list.length);
  return [...shuffle(all.filter(i => themeOK(P.list[i]))), ...shuffle(all.filter(i => !themeOK(P.list[i])))].slice(0, n);
}

/* ========== 記録 ========== */
const getBest = () => LS.get('hsk1_best', {});
function saveBest(id, pct) { const b = getBest(); if (!(id in b) || pct > b[id]) { b[id] = pct; LS.set('hsk1_best', b); } }
const getMiss = () => LS.get('hsk1_miss', []);
const missOf = lv => getMiss().filter(x => PARTS[x.part] && PARTS[x.part].lv === lv);
function markMiss(q, wrong) {
  let m = getMiss().filter(x => !(x.part === q.part && x.key === q.key));
  if (wrong) m.unshift({ part: q.part, key: q.key });
  LS.set('hsk1_miss', m.slice(0, 400));
}

/* ========== セッション ========== */
let S = null; // {mode, lv, title, qs, i, answers[]}
function startPractice(id, n = 10) {
  S = { mode: 'practice', id, lv: PARTS[id].lv, title: `${LEVELS[PARTS[id].lv].name} ${partLabel(id)}：${PARTS[id].name}`, qs: pickKeys(id, n).map(k => PARTS[id].gen(k)), i: 0, answers: [] };
  go('#/quiz');
}
function startMock() {
  const L = LV(), qs = [];
  for (const [id, n] of L.mock) pickKeys(id, n).forEach(k => qs.push(PARTS[id].gen(k)));
  S = { mode: 'mock', id: 'mock' + settings.level, lv: settings.level, title: `${L.name} 模擬試験（${qs.length}問）`, qs, i: 0, answers: [] };
  go('#/quiz');
}
function startReview() {
  const m = missOf(settings.level);
  if (!m.length) return;
  const items = shuffle(m).slice(0, 15).filter(x => PARTS[x.part].words ? PARTS[x.part].words.some(w => w.h === x.key) : x.key < PARTS[x.part].list.length);
  if (!items.length) return;
  S = { mode: 'review', id: 'review', lv: settings.level, title: `${LV().name} 間違えた問題の復習`, qs: items.map(x => PARTS[x.part].gen(x.key)), i: 0, answers: [] };
  go('#/quiz');
}

/* ========== 画面 ========== */
const app = $('#app');
function go(hash) { if (location.hash !== hash) history.pushState(null, '', hash); route(); }
function route() {
  TTS.stop();
  const h = location.hash || '#/';
  document.querySelectorAll('.top nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href') === h));
  syncLevel();
  if (h === '#/quiz' && S) return S.done ? renderResult() : renderQ();
  window.scrollTo(0, 0);
  if (h === '#/words') return renderWords();
  if (h === '#/settings') return renderSettings();
  if (h === '#/quiz' || h === '#/result') history.replaceState(null, '', '#/');
  renderHome();
}
window.addEventListener('popstate', route);
document.addEventListener('click', e => {
  const a = e.target.closest('[data-nav]');
  if (a) { e.preventDefault(); go(a.dataset.nav); }
  const lv = e.target.closest('[data-lv]');
  if (lv) setLevel(+lv.dataset.lv);
});
// 級の切り替え（ヘッダー）
function syncLevel() {
  document.querySelectorAll('[data-lv]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.lv === settings.level)));
  document.title = `新HSK${LV().name} 練習ドリル`;
}
function setLevel(lv) {
  if (lv === settings.level || !LEVELS[lv]) return;
  if (S && !S.done && location.hash === '#/quiz' && S.mode === 'mock' && !confirm('模擬試験を中断して級を切り替えますか？')) return;
  settings.level = lv; saveSettings();
  if (location.hash === '#/quiz') { S = null; go('#/'); } else route();
}

// 満点 max のゲージ（合格目安に赤ペンの線）
function gauge(score, max, pass) {
  const w = score == null ? 0 : score / max * 100, p = pass / max * 100;
  return `<div class="gauge" role="img" aria-label="${score == null ? '記録なし' : `${score}点（合格の目安は${pass}点）`}"><i style="width:${w}%"></i><span class="pass-line" style="left:${p}%"></span></div>
    <div class="gauge-scale" aria-hidden="true"><span style="left:0">0</span><span class="p" style="left:${p}%">合格 ${pass}</span><span style="left:100%">${max}</span></div>`;
}
function renderHome() {
  const L = LV(), lv = settings.level, b = getBest(), best = b['mock' + lv];
  const miss = missOf(lv).length;
  const row = id => {
    const P = PARTS[id], s = b[id];
    return `<li><button class="part" data-part="${id}" aria-label="${partLabel(id)} ${P.name}　${s == null ? '未挑戦' : `ベスト${s}%`}">
      <span class="no" lang="zh-Hans" aria-hidden="true">${NUM[P.no - 1]}</span>
      <span><span class="t">${P.name}</span><span class="d">${P.desc}</span></span>
      <span class="best">${s == null ? '—' : `<b>${s}</b>%`}</span></button></li>`;
  };
  const sec = (s, ids) => `<section><h2 class="sec-head"><span lang="zh-Hans" class="zh">${SEC[s].zh}</span><span>${SEC[s].ja}</span></h2>
    <ul class="parts">${ids.map(row).join('')}</ul></section>`;
  app.innerHTML = `
    <div class="home-head">
      <p class="lv-eyebrow">新HSK（HSK 3.0）</p>
      <h1>HSK${L.name} リスニング・リーディング${lv === 2 ? '・書写' : ''}対策</h1>
      <p class="lead">${L.lead}</p>
    </div>
    <div id="voiceWarn"></div>
    <section class="exam" aria-labelledby="exam-t">
      <div>
        <h2 class="exam-title" id="exam-t"><span lang="zh-Hans" class="zh">模拟考试</span>模擬試験</h2>
        <p>${L.mockDesc}</p>
        <button class="btn pri" id="mock">模擬試験をはじめる</button>
      </div>
      <div>
        <div class="gauge-label"><span>ベストスコア</span>${best == null ? '<span>まだ受けていません</span>' : `<span><b>${best}</b> / ${L.max}点</span>`}</div>
        ${gauge(best, L.max, L.pass)}
      </div>
    </section>
    <fieldset class="theme" aria-describedby="theme-d">
      <legend>例文</legend>
      ${THEMES.map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${settings.theme === v ? 'checked' : ''}><span class="box" aria-hidden="true"></span>${l}</label>`).join('')}
      <span class="d" id="theme-d">単語ドリル${lv === 2 ? '・書写' : ''}は共通です</span>
    </fieldset>
    <div class="sections${L.secs.length > 2 ? ' three' : ''}">
      ${L.secs.map(s => sec(s, partsOf(lv, s))).join('')}
    </div>
    <div class="sections drills">${sec('D', L.drills)}</div>
    <div class="more">
      <button class="tile" id="review" ${miss ? '' : 'disabled'}><div class="t">間違えた問題を復習</div><div class="d">${miss ? `${miss}問あります。最大15問を出題します` : '間違えた問題はここにたまります'}</div></button>
      <button class="tile" data-nav="#/words"><div class="t">単語帳（${L.words.length}語）</div><div class="d">${esc(L.wordNote)}。タップで発音を確認</div></button>
    </div>
    <p class="note">配点は公式の発表がないため、模擬試験は各セクション100点・合計の6割（${L.pass}点）を合格の目安にしています。</p>`;
  app.querySelectorAll('[data-part]').forEach(el => el.onclick = () => startPractice(el.dataset.part));
  app.querySelectorAll('[name=theme]').forEach(r => r.onchange = () => { settings.theme = r.value; saveSettings(); });
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
  const optClass = q.cls || (q.kind === 'pics' ? 'pics' : q.kind === 'judge' ? 'judge' : q.opts.length > 3 ? 'four' : '');
  const times = S.mode === 'mock' || settings.twice ? 2 : 1;
  const seg = S.qs.map((_, i) => `<i class="${i < S.i ? 'done' : i === S.i ? 'cur' : ''}"></i>`).join('');
  app.innerHTML = `
    <div class="qhead"><span>${esc(S.title)}</span><b>${S.i + 1} / ${n}</b></div>
    <div class="seg${n > 40 ? ' thin' : ''}" aria-hidden="true">${seg}</div>
    <section class="qbox">
      <p class="inst"><b>${partLabel(q.part)}</b>${P.inst}${q.ak ? '<span class="ak-tag">アークナイツ</span>' : ''}</p>
      <div class="stage">
        ${q.audio ? `<button class="play" id="play" aria-label="音声をもう一度聞く">${ICON_PLAY}<span class="lbl">もう一度聞く</span></button>` : ''}
        ${q.show}
      </div>
      <div class="opts ${optClass}" role="group" aria-label="選択肢">
        ${q.opts.map((o, k) => `<button class="opt" data-k="${k}" aria-label="${q.kind === 'judge' ? '' : KEYS[k] + ' '}${esc(o.label)}">${q.kind === 'judge' ? '' : `<span class="k">${KEYS[k]}</span>`}${o.html}</button>`).join('')}
      </div>
      <div id="fb" aria-live="polite"></div>
      <div class="actions">
        <button class="link" id="quit">やめる</button>
        <button class="btn pri" id="next" ${S.mode === 'mock' ? 'disabled' : 'hidden'}>${S.i + 1 < n ? '次へ' : '結果を見る'}</button>
      </div>
      <p class="keys">キー操作：<kbd>${q.kind === 'judge' ? '1' : 'A'}</kbd>〜<kbd>${q.kind === 'judge' ? '2' : KEYS[q.opts.length - 1]}</kbd> で解答${q.audio ? '、<kbd>R</kbd> でもう一度聞く' : ''}、<kbd>Enter</kbd> で次へ</p>
    </section>`;
  const playBtn = $('#play');
  if (playBtn) {
    playBtn.onclick = () => playBtn.classList.contains('playing') ? TTS.stop() : TTS.play(q.audio, 1, playBtn);
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
  btns.forEach((b, j) => {
    b.disabled = true;
    if (j === q.ans) { b.classList.add('ok'); b.insertAdjacentHTML('beforeend', PEN_O); }
    else if (j === k) { b.classList.add('ng'); b.insertAdjacentHTML('beforeend', PEN_X); }
  });
  $('#fb').innerHTML = `<div class="fb ${right ? 'ok' : 'ng'}"><div class="res">${right ? '正解' : `不正解。正解は ${symOf(q, q.ans)}`}</div><div class="ex">${q.explain}</div></div>`;
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
    const L = LEVELS[S.lv];
    const pts = L.secs.map(s => {
      const ix = S.qs.map((q, i) => PARTS[q.part].sec === s ? i : -1).filter(i => i >= 0);
      return Math.round(ix.filter(i => right[i]).length / ix.length * 100);
    });
    const total = pts.reduce((a, b) => a + b, 0);
    saveBest(S.id, total);
    const rows = L.mock.map(([id]) => {
      const ix = S.qs.map((q, i) => q.part === id ? i : -1).filter(i => i >= 0);
      return `<tr><td>${partLabel(id)}　${PARTS[id].name}</td><td>${ix.filter(i => right[i]).length} / ${ix.length}</td></tr>`;
    }).join('');
    head = `<div class="score"><div class="n">${total}<small> / ${L.max}</small></div><div class="of">${L.secs.map((s, i) => `${SEC[s].ja} ${pts[i]}点`).join('、')}</div>
      <div class="verdict ${total >= L.pass ? 'y' : 'n'}">${total >= L.pass ? '合格ライン到達' : `合格の目安まであと ${L.pass - total}点`}</div>
      <div class="gauge-wrap">${gauge(total, L.max, L.pass)}</div></div>
      <table class="bd">${rows}</table>`;
  } else {
    const pct = Math.round(c / n * 100);
    if (S.mode === 'practice') saveBest(S.id, pct);
    head = `<div class="score"><div class="n">${c}<small> / ${n}</small></div><div class="of">正答率 ${pct}%</div></div>`;
  }
  const wrongs = S.qs.map((q, i) => right[i] ? '' : `<div class="wrong"><div class="tag">${partLabel(q.part)}　${S.answers[i] == null ? '未回答' : `あなたの答え ${symOf(q, S.answers[i])}`}　正解 ${q.kind === 'judge' ? symOf(q, q.ans) : KEYS[q.ans] + ' ' + q.opts[q.ans].html}</div>
    <div class="ex">${q.explain}</div>${q.audio ? `<button class="link" data-re="${i}">もう一度聞く</button>` : ''}</div>`).join('');
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
  $('#again').onclick = () => S.mode === 'mock' ? startMock() : S.mode === 'review' ? (missOf(S.lv).length ? startReview() : go('#/')) : startPractice(S.id);
  window.scrollTo(0, 0);
}

function renderWords() {
  const L = LV();
  app.innerHTML = `
    <h1>単語帳（${esc(L.wordNote)}）</h1>
    <p class="lead">カードをタップすると発音します。意味やピンインを隠して覚えたかチェックできます。${settings.level === 2 ? '1級の語は、上の「1級」に切り替えると表示されます。' : ''}</p>
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
    list.innerHTML = L.words.filter(w => !q || norm(w.h + w.p + w.j).includes(q))
      .map(w => `<button class="w" data-h="${esc(w.h)}"><span class="e">${w.e}</span><div lang="zh-Hans" class="zh">${esc(w.h)}</div><div class="py" lang="zh-Latn-pinyin">${esc(w.p)}</div><div class="ja">${esc(w.j)}</div></button>`).join('') || '<p class="lead">見つかりませんでした。</p>';
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
      <label><span>ピンインを表示<small>リーディングの問題文・選択肢にピンインを付けます（本番のHSK1・2級も付いています）</small></span><input type="checkbox" id="s-py" ${settings.pinyin ? 'checked' : ''}></label>
      <label><span>読み上げ速度 <b id="rv">${settings.rate.toFixed(2)}</b><small>本番に近いのは 0.8〜0.9 くらい</small></span><input type="range" id="s-rate" min="0.5" max="1.2" step="0.05" value="${settings.rate}"></label>
      <label><span>例文のテーマ<small>アークナイツ（明日方舟）のキャラクターが出てくる例文を混ぜられます。単語帳・単語ドリル・書写は共通です</small></span>
        <select id="s-th">${THEMES.map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label><span>練習でも2回ずつ流す<small>本番は各問題が2回読まれます（模擬試験は常に2回）</small></span><input type="checkbox" id="s-tw" ${settings.twice ? 'checked' : ''}></label>
      ${TTS.hasFiles ? `<div class="item"><span>音声<small>収録音声（女性：Xiaoxiao／男性：Yunxi）を使用しています</small></span></div>` : `<label><span>音声<small>${vs.length ? `${vs.length}件の中国語音声があります` : '中国語の音声が見つかりません'}</small></span>
        <select id="s-v" ${vs.length ? '' : 'disabled'}><option value="">自動</option>${vs.map(v => `<option ${v.name === settings.voice ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>`}
      <div class="item"><span>試しに聞く</span><button class="btn" id="s-test">你好！我是老师。</button></div>
      <div class="item"><span>学習記録を消す<small>1級・2級のベストスコアと復習リストを削除します</small></span><button class="btn" id="s-reset">リセット</button></div>
    </div>`;
  $('#s-py').onchange = e => { settings.pinyin = e.target.checked; saveSettings(); };
  $('#s-th').onchange = e => { settings.theme = e.target.value; saveSettings(); };
  $('#s-tw').onchange = e => { settings.twice = e.target.checked; saveSettings(); };
  $('#s-rate').oninput = e => { settings.rate = +e.target.value; $('#rv').textContent = settings.rate.toFixed(2); saveSettings(); };
  if ($('#s-v')) $('#s-v').onchange = e => { settings.voice = e.target.value; saveSettings(); };
  $('#s-test').onclick = e => TTS.play([{ t: '你好！我是老师。' }]);
  $('#s-reset').onclick = () => { if (confirm('学習記録をすべて消しますか？')) { LS.set('hsk1_best', {}); LS.set('hsk1_miss', []); alert('消去しました。'); } };
}

/* ========== キー操作（問題画面） ========== */
document.addEventListener('keydown', e => {
  if (location.hash !== '#/quiz' || !S || S.done || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const q = S.qs[S.i], key = e.key.toLowerCase();
  let k = '123456'.indexOf(key);
  if (k < 0 && q.kind !== 'judge') k = 'abcdef'.indexOf(key);
  if (k >= 0 && k < q.opts.length) { e.preventDefault(); const b = app.querySelectorAll('.opt')[k]; if (b && !b.disabled) choose(k); return; }
  if (key === 'r' && $('#play')) { e.preventDefault(); $('#play').click(); return; }
  if (key === 'enter' && e.target.tagName !== 'BUTTON') {
    const nb = $('#next'); if (nb && !nb.hidden && !nb.disabled) { e.preventDefault(); next(); }
  }
});

TTS.init();
route();
