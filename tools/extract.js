// data.js / data2.js から音声が必要な文を書き出す（make_audio.py が呼び出す）
// 出力: [{v:'f'|'m', t:'文'}...]  ※ js/app.js の再生キー（声|文）と一致させること
const fs = require('fs'), vm = require('vm'), path = require('path');
const js = f => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
const ctx = {};
vm.runInNewContext(js('data.js') + js('data2.js') +
  ';this.D={VOCAB,SENT_PIC,DIALOG_PIC,SENT_Q,QA,VOCAB2,SENT_PIC2,DIALOG_PIC2,DIALOG_Q2};', ctx);
const D = ctx.D;
const out = new Map();
const add = (v, t) => out.set(v + '|' + t, { v, t });
[...D.VOCAB, ...D.VOCAB2].forEach(w => add('f', w.h));                 // 単語帳・単語ドリル
[...D.SENT_PIC, ...D.SENT_PIC2].forEach(s => add('f', s.s));           // 絵を選ぶ
[...D.DIALOG_PIC, ...D.DIALOG_PIC2, ...D.DIALOG_Q2].forEach(d => d.d.forEach(l => add(l[0], l[1]))); // 会話
D.SENT_Q.forEach(s => { add('f', s.s); add('m', '问：' + s.q); });   // 1級 質問に答える
D.DIALOG_Q2.forEach(s => add('m', '问：' + s.q));                     // 2級 会話と質問
D.QA.forEach(s => add('f', s.q));                                      // 1級 応答を選ぶ（問いかけを聞く）
add('f', '你好！我是老师。');
process.stdout.write(JSON.stringify([...out.values()]));
