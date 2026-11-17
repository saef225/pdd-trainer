/* Тренажёр билетов ПДД: 40 билетов × 20 вопросов, запись итогов в Google Таблицу */
(function () {
  'use strict';

  const Q = window.PDD_QUESTIONS || [];
  const IMG = 'data/images/';
  const LETTERS = ['1', '2', '3', '4', '5'];
  const $app = document.getElementById('app');
  const key = q => q.t + '-' + q.n;
  const byKey = Object.fromEntries(Q.map(q => [key(q), q]));
  const TOPICS = [...new Set(Q.flatMap(q => q.topic))].sort((a, b) => a.localeCompare(b, 'ru'));

  // ---------- хранилище ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pdd_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pdd_' + k, JSON.stringify(v)); } catch (e) { /* нет места/запрещено */ } },
    del(k) { try { localStorage.removeItem('pdd_' + k); } catch (e) {} }
  };
  let settings = Object.assign({ name: '', auto: true, instant: true }, store.get('settings', {}));
  let session = store.get('session', null);   // текущая попытка (переживает перезагрузку)
  const CFG = Object.assign({ scriptUrl: '' }, window.PDD_CONFIG || {});
  // общая таблица для всех из config.js
  const tableUrl = () => CFG.scriptUrl;

  // ---------- утилиты ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = d => new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDur = s => { s = Math.round(s); const m = Math.floor(s / 60); return m ? `${m} мин ${s % 60} с` : `${s} с`; };
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2600); }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => toast('Скопировано — вставьте в чат'));
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Скопировано — вставьте в чат'); } catch (e) { toast('Не удалось скопировать'); }
    ta.remove(); return Promise.resolve();
  }

  // ---------- статистика ----------
  function ticketStats() { return store.get('tickets', {}); }   // {t: {last, best, errors, date}}
  function wrongSet() { return new Set(store.get('wrong', [])); }

  // ---------- старт попытки ----------
  function start(mode, title, keys, opts = {}) {
    if (session && Object.keys(session.answers).length && !confirm('Есть незавершённая попытка «' + session.title + '». Начать новую и потерять её?')) return;
    session = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      mode, title, keys, ticket: opts.ticket || null,
      answers: {},          // key -> индекс ответа
      cur: 0, started: Date.now()
    };
    saveSession(); renderQuiz();
  }
  const saveSession = () => store.set('session', session);

  const startTicket = t => start('ticket', 'Билет ' + t, Q.filter(q => q.t === t).map(key), { ticket: t });
  const startMarathon = () => {
    const done = new Set(store.get('marathonDone', []));
    let rest = Q.map(key).filter(k => !done.has(k));
    if (!rest.length) {
      if (!confirm('Все 800 вопросов марафона пройдены. Начать марафон заново?')) return;
      store.del('marathonDone'); rest = Q.map(key);
    }
    start('marathon', rest.length === 800 ? 'Марафон: все 800 вопросов' : `Марафон: осталось ${rest.length} из 800`, rest);
  };
  const startRandom = () => { const t = 1 + Math.floor(Math.random() * 40); startTicket(t); };
  const startExam = () => {
    // как на экзамене: 20 вопросов из разных билетов, по одному на позицию
    const keys = []; for (let n = 1; n <= 20; n++) keys.push((1 + Math.floor(Math.random() * 40)) + '-' + n);
    start('exam', 'Экзамен (случайные 20)', keys);
  };
  const startWrong = () => {
    const w = [...wrongSet()].filter(k => byKey[k]);
    if (!w.length) return toast('Ошибок пока нет — сначала пройдите билеты');
    start('wrong', 'Работа над ошибками (' + w.length + ')', shuffle(w));
  };
  const startTopic = topic => start('topic', 'Тема: ' + topic, Q.filter(q => q.topic.includes(topic)).map(key));

  // ---------- главная ----------
  function renderHome() {
    $app._res = null;
    session && Object.keys(session.answers).length === 0 && (session = null, store.del('session'));
    const ts = ticketStats();
    const passed = Object.values(ts).filter(x => x.errors <= 2).length;
    const done = Object.keys(ts).length;
    const w = wrongSet().size;
    const hist = store.get('history', []);
    const queue = store.get('queue', []);

    let html = '';
    if (session) {
      const a = Object.keys(session.answers).length;
      html += `<div class="card row"><div class="grow"><b>Незавершённая попытка:</b> ${esc(session.title)} — отвечено ${a} из ${session.keys.length}</div>
        <button class="primary" data-act="resume">Продолжить</button><button class="ghost" data-act="finish">Завершить и сохранить</button><button class="ghost" data-act="drop">Сбросить</button></div>`;
    }
    if (!tableUrl()) {
      html += `<div class="card" style="border-color:var(--skip)"><b>Google Таблица не подключена.</b> Результаты сохраняются только в этом браузере.</div>`;
    }
    if (queue.length) {
      html += `<div class="card row"><div class="grow">Не отправлено в таблицу: <b>${queue.length}</b> попыт${queue.length === 1 ? 'ка' : 'ки/ок'}</div><button class="ghost" data-act="flush">Отправить сейчас</button></div>`;
    }

    html += `<div class="card"><h1>Привет${settings.name ? ', ' + esc(settings.name) : ''}!</h1>
      <div class="stats">
        <div><b>${done}/40</b>билетов пройдено</div>
        <div><b>${passed}</b>сдано (≤ 2 ошибок)</div>
        <div><b>${w}</b>вопросов в «ошибках»</div>
        <div><b>${hist.length}</b>попыток всего</div>
      </div></div>

      <div class="modes card" style="padding:12px">
        <button class="mode" data-act="exam"><b>Экзамен</b><small>20 случайных вопросов, как в ГИБДД</small></button>
        <button class="mode" data-act="random"><b>Случайный билет</b><small>один из 40 целиком</small></button>
        <button class="mode" data-act="marathon"><b>Марафон</b><small>все 800 вопросов подряд, прогресс сохраняется</small></button>
        <button class="mode" data-act="wrong"><b>Работа над ошибками</b><small>${w ? w + ' вопрос(ов), где вы ошибались' : 'пока пусто'}</small></button>
      </div>

      <div class="card"><h2>Билеты</h2>
        <div class="tickets">${Array.from({ length: 40 }, (_, i) => {
          const t = i + 1, s = ts[t];
          const cls = s ? (s.errors <= 2 ? 'pass' : 'fail') : '';
          return `<button class="tk ${cls}" data-ticket="${t}"><b>${t}</b><small>${s ? (20 - s.errors) + '/20' : '—'}</small></button>`;
        }).join('')}</div>
        <p class="hint">Зелёный — сдан (не больше 2 ошибок), красный — не сдан. Показан последний результат.</p>
      </div>

      <div class="card"><h2>По темам</h2>
        <div class="row"><select id="topicSel" class="grow" style="flex:1">${TOPICS.map(t => `<option>${esc(t)}</option>`).join('')}</select>
        <button class="primary" data-act="topic">Начать</button></div>
      </div>

      <div class="card"><h2>Поиск по всем 800 вопросам</h2>
        <input id="search" type="search" placeholder="Например: обгон, 3.20, пешеходный переход, ремень…">
        <div id="searchRes" class="results-list"></div>
      </div>

      ${hist.length ? `<div class="card"><h2>Последние попытки</h2><div class="results-list">${hist.slice(0, 10).map((h, i) => `
        <div class="item row"><div class="grow"><b>${esc(h.title)}</b> — ${h.correct}/${h.total}
          <span class="${h.passed ? 'verdict pass' : 'verdict fail'}">${h.passed ? 'сдан' : 'не сдан'}</span>
          <div class="hint">${fmtDate(h.date)} · ${h.sent ? 'в таблице ✓' : 'не отправлено'}</div></div>
          <button class="ghost" data-hist="${i}">Открыть</button></div>`).join('')}</div></div>` : ''}`;

    $app.innerHTML = html;
    const s = document.getElementById('search');
    s.addEventListener('input', () => renderSearch(s.value));
  }

  function renderSearch(text) {
    const box = document.getElementById('searchRes');
    const t = text.trim().toLowerCase();
    if (t.length < 2) { box.innerHTML = ''; return; }
    const found = Q.filter(q => (q.q + ' ' + q.a.join(' ') + ' ' + q.tip + ' ' + q.topic.join(' ')).toLowerCase().includes(t));
    const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const hl = s => esc(s).replace(re, m => `<mark>${m}</mark>`);
    box.innerHTML = `<p class="row"><span class="grow muted">Найдено: ${found.length}</span>${found.length ? `<button class="ghost" data-act="searchQuiz">Пройти найденные</button>` : ''}</p>` +
      found.slice(0, 40).map(q => `<div class="item"><span class="tag">Б${q.t} · В${q.n}</span>${q.topic.map(x => `<span class="tag">${esc(x)}</span>`).join('')}
        <div class="q"><b>${hl(q.q)}</b></div>
        <div class="right" style="color:var(--ok)">✓ ${hl(q.a[q.c])}</div>
        <details><summary class="hint">Пояснение</summary><div class="tip">${hl(q.tip)}</div></details></div>`).join('') +
      (found.length > 40 ? `<p class="hint">Показаны первые 40.</p>` : '');
    box._found = found.map(key);
    box._text = text.trim();
  }

  // ---------- вопрос ----------
  function renderQuiz() {
    if (!session) return renderHome();
    const s = session, k = s.keys[s.cur], q = byKey[k];
    const answered = s.answers[k] != null;
    const reveal = answered && settings.instant;
    const nAns = Object.keys(s.answers).length;
    const small = s.keys.length <= 40;

    const nav = small ? `<div class="nav">${s.keys.map((kk, i) => {
      const a = s.answers[kk]; let c = '';
      if (a != null) c = settings.instant ? (a === byKey[kk].c ? 'ok' : 'bad') : 'done';
      return `<button class="${c} ${i === s.cur ? 'cur' : ''}" data-go="${i}">${i + 1}</button>`;
    }).join('')}</div>` : `<div class="progress"><i style="width:${(nAns / s.keys.length * 100).toFixed(1)}%"></i></div>`;

    const errs = settings.instant ? Object.entries(s.answers).filter(([kk, a]) => a !== byKey[kk].c).length : null;

    $app.innerHTML = `<div class="card">
      <div class="qhead"><div><b>${esc(s.title)}</b> <span class="muted">· вопрос ${s.cur + 1} из ${s.keys.length}</span></div>
        <div class="muted">Отвечено ${nAns}${errs != null ? ` · ошибок <b style="color:var(--bad)">${errs}</b>` : ''}</div></div>
      ${nav}
      ${!small ? `<div class="row" style="margin-bottom:10px"><span class="hint">Перейти к №</span><input id="jump" type="number" min="1" max="${s.keys.length}" style="width:90px"><button class="ghost" data-act="jump">→</button>
        <button class="ghost" data-act="nextUnanswered">К первому неотвеченному</button></div>` : ''}
      <div><span class="tag">Билет ${q.t}, вопрос ${q.n}</span>${q.topic.map(x => `<span class="tag">${esc(x)}</span>`).join('')}</div>
      ${q.img ? `<img class="qimg" src="${IMG + q.img}" alt="Иллюстрация к вопросу">` : ''}
      <p class="qtext">${esc(q.q)}</p>
      <div class="answers">${q.a.map((a, i) => {
        let c = '';
        if (reveal) c = i === q.c ? 'correct' : (i === s.answers[k] ? 'wrong' : '');
        else if (answered && i === s.answers[k]) c = 'picked';
        return `<button class="ans ${c}" data-ans="${i}" ${reveal ? 'disabled' : ''}><span class="num">${LETTERS[i]}</span><span>${esc(a)}</span></button>`;
      }).join('')}</div>
      ${reveal ? `<div class="tip"><b>${s.answers[k] === q.c ? '✓ Верно' : '✗ Неверно. Правильный ответ: ' + (q.c + 1)}</b>${esc(q.tip)}</div>` : ''}
      <div class="qfoot">
        <button class="ghost" data-act="prev" ${s.cur === 0 ? 'disabled' : ''}>← Назад</button>
        <button class="primary" data-act="next">${s.cur === s.keys.length - 1 ? 'Завершить' : (answered ? 'Далее →' : 'Пропустить →')}</button>
        <span class="grow"></span>
        <button class="ghost" data-act="toHome">Пауза (на главную)</button>
        <button class="ghost" data-act="finish">Завершить тест</button>
      </div>
      <p class="hint">Клавиши: 1–5 — ответ, Enter/→ — далее, ← — назад.</p>
    </div>`;
    window.scrollTo({ top: 0 });
  }

  function answer(i) {
    const s = session, k = s.keys[s.cur];
    if (settings.instant && s.answers[k] != null) return;
    s.answers[k] = i; saveSession();
    if (settings.instant) return renderQuiz();
    next();
  }
  function next() {
    if (session.cur < session.keys.length - 1) { session.cur++; saveSession(); renderQuiz(); }
    else finish();
  }

  // ---------- итог ----------
  function finish() {
    const s = session; if (!s) return;
    if (!Object.keys(s.answers).length && !confirm('Вы не ответили ни на один вопрос. Всё равно завершить?')) return;
    const isLong = s.mode === 'marathon' || s.keys.length > 40;
    // в длинных режимах неотвеченные не считаем пропущенными, если пользователь остановился сам
    const keys = isLong ? s.keys.filter(k => s.answers[k] != null) : s.keys;
    const items = keys.map(k => {
      const q = byKey[k], a = s.answers[k];
      const status = a == null ? 'пропущен' : (a === q.c ? 'верно' : 'ошибка');
      return { k, t: q.t, n: q.n, status, your: a };
    });
    const correct = items.filter(x => x.status === 'верно').length;
    const wrong = items.filter(x => x.status === 'ошибка').length;
    const skipped = items.filter(x => x.status === 'пропущен').length;
    const total = items.length;
    const passed = (s.mode === 'ticket' || s.mode === 'exam') ? (wrong + skipped) <= 2 : total > 0 && correct / total >= 0.9;
    const res = {
      id: s.id, mode: s.mode, title: s.title, ticket: s.ticket, date: new Date().toISOString(),
      duration: (Date.now() - s.started) / 1000, total, correct, wrong, skipped, passed,
      notCovered: isLong ? s.keys.length - keys.length : 0, items, sent: false
    };

    // статистика
    const ws = wrongSet();
    items.forEach(x => { if (x.status === 'верно') ws.delete(x.k); else ws.add(x.k); });
    store.set('wrong', [...ws]);
    if (s.mode === 'marathon') store.set('marathonDone', [...new Set([...store.get('marathonDone', []), ...keys])]);
    if (s.mode === 'ticket') { const ts = ticketStats(); ts[s.ticket] = { errors: wrong + skipped, date: res.date }; store.set('tickets', ts); }
    const hist = store.get('history', []); hist.unshift(res); store.set('history', hist.slice(0, 100));

    session = null; store.del('session');
    renderResult(res);
    if (tableUrl() && settings.auto) send(res);
  }

  function missesOf(res) { return res.items.filter(x => x.status !== 'верно'); }

  function renderResult(res) {
    const pct = res.total ? Math.round(res.correct / res.total * 100) : 0;
    const misses = missesOf(res);
    $app.innerHTML = `<div class="card">
      <div class="row"><div class="grow"><h1>${esc(res.title)}</h1><div class="muted">${fmtDate(res.date)} · ${fmtDur(res.duration)}</div></div>
        <div style="text-align:right"><div class="score">${res.correct}/${res.total}</div><div class="verdict ${res.passed ? 'pass' : 'fail'}"><b>${res.passed ? 'Сдан' : 'Не сдан'}</b> · ${pct}%</div></div></div>
      <div class="stats" style="margin-top:10px"><div><b style="color:var(--ok)">${res.correct}</b>верно</div><div><b style="color:var(--bad)">${res.wrong}</b>ошибок</div><div><b style="color:var(--skip)">${res.skipped}</b>пропущено</div>
        ${res.notCovered ? `<div><b>${res.notCovered}</b>не дошли</div>` : ''}</div>
      <div class="row" style="margin-top:14px">
        <button class="primary" data-res="send">${res.sent ? 'Отправить ещё раз' : 'Записать в Google Таблицу'}</button>
        <button class="ghost" data-res="copy">Скопировать для чата</button>
        ${misses.length ? `<button class="ghost" data-res="retry">Повторить ошибки (${misses.length})</button>` : ''}
        ${res.ticket ? `<button class="ghost" data-res="again">Пройти билет заново</button>` : ''}
        <button class="ghost" data-act="toHome">На главную</button>
      </div>
      <p class="hint" id="resSent">${res.sent ? 'Записано в таблицу ✓' : (tableUrl() ? '' : 'Таблица не подключена.')}</p>
    </div>
    <div class="card"><h2>${misses.length ? 'Ошибки и пропуски — что повторить' : 'Без ошибок 🎉'}</h2>
      ${misses.map(x => { const q = byKey[x.k]; return `<div class="miss ${x.status === 'пропущен' ? 'skip' : ''}">
        <span class="tag">Билет ${q.t} · вопрос ${q.n}</span>${q.topic.map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        <div class="q">${esc(q.q)}</div>
        ${q.img ? `<img src="${IMG + q.img}" alt="">` : ''}
        <div class="your">${x.status === 'пропущен' ? '— вопрос пропущен' : '✗ Ваш ответ: ' + esc(q.a[x.your])}</div>
        <div class="right">✓ Правильно: ${esc(q.a[q.c])}</div>
        <div class="tip">${esc(q.tip)}</div></div>`; }).join('')}
    </div>
    <div class="card"><h2>Текст для чата</h2><textarea readonly>${esc(chatText(res))}</textarea></div>`;
    $app._res = res;
  }

  function chatText(res) {
    const pct = res.total ? Math.round(res.correct / res.total * 100) : 0;
    const lines = [
      `ПДД · ${res.title}${settings.name ? ' · ' + settings.name : ''} · ${fmtDate(res.date)}`,
      `Итог: ${res.correct}/${res.total} (${pct}%) — ${res.passed ? 'СДАН' : 'НЕ СДАН'}; ошибок ${res.wrong}, пропущено ${res.skipped}, время ${fmtDur(res.duration)}`
    ];
    const m = missesOf(res);
    if (m.length) {
      lines.push('', 'Что повторить:');
      m.forEach((x, i) => {
        const q = byKey[x.k];
        lines.push(`${i + 1}) Б${q.t} В${q.n}${q.topic.length ? ' [' + q.topic.join(', ') + ']' : ''}: ${q.q}`);
        lines.push(x.status === 'пропущен' ? '   Ответ: пропущен' : `   Мой ответ: ${q.a[x.your]}`);
        lines.push(`   Правильно: ${q.a[q.c]}`);
        lines.push(`   Пояснение: ${q.tip}`);
      });
    }
    return lines.join('\n');
  }

  // ---------- Google Таблица ----------
  function payload(res) {
    return {
      type: 'attempt', id: res.id, name: settings.name || 'Без имени', date: res.date, mode: res.mode, title: res.title,
      ticket: res.ticket, total: res.total, correct: res.correct, wrong: res.wrong, skipped: res.skipped,
      percent: res.total ? Math.round(res.correct / res.total * 100) : 0, passed: res.passed, duration: Math.round(res.duration),
      chat: chatText(res),
      mistakes: missesOf(res).map(x => {
        const q = byKey[x.k];
        return { ticket: q.t, num: q.n, topic: q.topic.join(', '), status: x.status, question: q.q,
          your: x.status === 'пропущен' ? '' : q.a[x.your], correct: q.a[q.c], tip: q.tip, image: q.img ? 'да' : '' };
      })
    };
  }

  async function post(body) {
    // Apps Script не отдаёт CORS-заголовки на POST, поэтому no-cors + text/plain (без preflight)
    await fetch(tableUrl(), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
  }

  function markSent(id) {
    const hist = store.get('history', []); const h = hist.find(x => x.id === id); if (h) { h.sent = true; store.set('history', hist); }
    store.set('queue', store.get('queue', []).filter(x => x.id !== id));
  }

  async function send(res) {
    if (!tableUrl()) { toast('Таблица не подключена'); return; }
    setStatus('Отправка…');
    try {
      await post(payload(res));
      res.sent = true; markSent(res.id);
      setStatus('В таблице ✓'); toast('Результат записан в Google Таблицу');
      const el = document.getElementById('resSent'); if (el) el.textContent = 'Записано в таблицу ✓';
    } catch (e) {
      const q = store.get('queue', []); if (!q.some(x => x.id === res.id)) { q.push(payload(res)); store.set('queue', q); }
      setStatus('Нет связи — сохранено в очередь'); toast('Не удалось отправить. Попытка сохранена и уйдёт позже.');
    }
  }

  async function flushQueue() {
    const q = store.get('queue', []); if (!q.length || !tableUrl()) return;
    let ok = 0;
    for (const p of q) { try { await post(p); markSent(p.id); ok++; } catch (e) { break; } }
    if (ok) toast('Отправлено из очереди: ' + ok);
    if (!session) renderHome();
  }

  function setStatus(t) { document.getElementById('sendStatus').textContent = t; }

  // ---------- настройки ----------
  const dlg = document.getElementById('settingsDlg');
  function openSettings() {
    document.getElementById('setName').value = settings.name;
    document.getElementById('setAuto').checked = settings.auto;
    document.getElementById('setInstant').checked = settings.instant;
    dlg.showModal();
  }
  function readSettingsForm() {
    return { name: document.getElementById('setName').value.trim(), auto: document.getElementById('setAuto').checked, instant: document.getElementById('setInstant').checked };
  }
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const f = readSettingsForm();
    if (!f.name && CFG.scriptUrl) { toast('Введите имя — таблица общая для всех'); setTimeout(openSettings, 0); return; }
    settings = f; store.set('settings', settings); toast('Сохранено');
    const onResult = !session && $app._res && document.getElementById('resSent');
    if (onResult) { const r = $app._res; renderResult(r); if (tableUrl() && !r.sent) send(r); else flushQueue(); return; }
    flushQueue();
    session ? renderQuiz() : renderHome();
  });

  // ---------- события ----------
  document.getElementById('homeBtn').addEventListener('click', () => { renderHome(); });
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  $app.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.ticket) return startTicket(+b.dataset.ticket);
    if (b.dataset.ans != null) return answer(+b.dataset.ans);
    if (b.dataset.go != null) { session.cur = +b.dataset.go; saveSession(); return renderQuiz(); }
    if (b.dataset.hist != null) return renderResult(store.get('history', [])[+b.dataset.hist]);
    const r = $app._res;
    switch (b.dataset.res) {
      case 'send': return send(r);
      case 'copy': return copy(chatText(r));
      case 'retry': return start('wrong', 'Повтор ошибок: ' + r.title, missesOf(r).map(x => x.k));
      case 'again': return startTicket(r.ticket);
    }
    switch (b.dataset.act) {
      case 'exam': return startExam();
      case 'random': return startRandom();
      case 'marathon': return startMarathon();
      case 'wrong': return startWrong();
      case 'topic': return startTopic(document.getElementById('topicSel').value);
      case 'searchQuiz': { const box = document.getElementById('searchRes'); return start('search', 'Поиск: «' + box._text + '»', box._found); }
      case 'resume': return renderQuiz();
      case 'finish': return finish();
      case 'drop': if (confirm('Сбросить незавершённую попытку?')) { session = null; store.del('session'); renderHome(); } return;
      case 'flush': return flushQueue();
      case 'prev': session.cur--; saveSession(); return renderQuiz();
      case 'next': return next();
      case 'toHome': return renderHome();
      case 'jump': { const v = +document.getElementById('jump').value; if (v >= 1 && v <= session.keys.length) { session.cur = v - 1; saveSession(); renderQuiz(); } return; }
      case 'nextUnanswered': { const i = session.keys.findIndex(k => session.answers[k] == null); if (i < 0) return toast('Все вопросы отвечены'); session.cur = i; saveSession(); return renderQuiz(); }
    }
  });

  document.addEventListener('keydown', e => {
    if (!session || dlg.open || /input|textarea|select/i.test(e.target.tagName)) return;
    if (!document.querySelector('.answers')) return;
    if (/^[1-5]$/.test(e.key)) { const q = byKey[session.keys[session.cur]]; const i = +e.key - 1; if (i < q.a.length) answer(i); }
    else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' && session.cur > 0) { session.cur--; saveSession(); renderQuiz(); }
  });

  // ---------- запуск ----------
  if (!Q.length) { $app.innerHTML = '<div class="card">Не найден файл data/questions.js</div>'; return; }
  renderHome();
  if (CFG.scriptUrl && !settings.name) { toast('Укажите своё имя — по нему вас найдут в общей таблице'); openSettings(); }
  window.addEventListener('online', flushQueue);
  if (tableUrl()) flushQueue();
})();
