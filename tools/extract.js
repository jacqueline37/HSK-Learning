// data.js から音声が必要な文を書き出す（make_audio.py が呼び出す）
// 出力: [{v:'f'|'m', t:'文'}...]  ※ js/app.js の再生キー（声|文）と一致させること
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8');
const ctx = {};
vm.runInNewContext(src + ';this.D={VOCAB,SENT_PIC,DIALOG_PIC,SENT_Q,QA,FILL};', ctx);
const { VOCAB, SENT_PIC, DIALOG_PIC, SENT_Q } = ctx.D;
const out = new Map();
const add = (v, t) => out.set(v + '|' + t, { v, t });
VOCAB.forEach(w => add('f', w.h));
SENT_PIC.forEach(s => add('f', s.s));
DIALOG_PIC.forEach(d => d.d.forEach(l => add(l[0], l[1])));
SENT_Q.forEach(s => { add('f', s.s); add('m', '问：' + s.q); });
add('f', '你好！我是老师。');
process.stdout.write(JSON.stringify([...out.values()]));
